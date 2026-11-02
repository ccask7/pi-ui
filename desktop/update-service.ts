import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";

export const UPDATE_API_URL = "https://api.github.com/repos/ccask7/pi-ui/releases/latest";
const DOWNLOAD_PREFIX = "https://github.com/ccask7/pi-ui/releases/download/";
const DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

export interface UpdateRelease {
	version: string;
	notes: string;
	pageUrl: string;
	assetUrl: string;
	assetName: string;
}

export function compareVersions(a: string, b: string): number {
	const parse = (value: string) => {
		const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
		if (!match) throw new Error(`Invalid version: ${value}`);
		return { numbers: match.slice(1, 4).map(Number), prerelease: match[4] };
	};
	const left = parse(a);
	const right = parse(b);
	for (let i = 0; i < 3; i++) {
		if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] > right.numbers[i] ? 1 : -1;
	}
	if (left.prerelease === right.prerelease) return 0;
	if (!left.prerelease) return 1;
	if (!right.prerelease) return -1;
	return left.prerelease.localeCompare(right.prerelease);
}

export function parseLatestRelease(value: unknown): UpdateRelease {
	const release = value as {
		tag_name?: unknown;
		name?: unknown;
		body?: unknown;
		html_url?: unknown;
		prerelease?: unknown;
		draft?: unknown;
		assets?: unknown;
	};
	if (release.draft === true || release.prerelease === true) throw new Error("Latest release is not a stable release");
	const tag =
		typeof release.tag_name === "string" ? release.tag_name : typeof release.name === "string" ? release.name : "";
	const version = tag.replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Release has an invalid stable version");
	const pageUrl = `https://github.com/ccask7/pi-ui/releases/tag/v${version}`;
	const assetName = `pi-ccui-${version}-setup.exe`;
	const assets = Array.isArray(release.assets) ? release.assets : [];
	const asset = assets.find((item) => (item as { name?: unknown })?.name === assetName) as
		{ browser_download_url?: unknown } | undefined;
	const assetUrl = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : "";
	if (!assetUrl.startsWith(`${DOWNLOAD_PREFIX}v${version}/${assetName}`)) {
		throw new Error(`Release asset not found: ${assetName}`);
	}
	return {
		version,
		notes: typeof release.body === "string" ? release.body : "",
		pageUrl,
		assetUrl,
		assetName,
	};
}

export async function checkForUpdate(
	currentVersion: string,
	fetcher: typeof fetch = fetch,
): Promise<UpdateRelease | null> {
	const response = await fetcher(UPDATE_API_URL, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "Cc-Desktop-Updater" },
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`GitHub release check failed: HTTP ${response.status}`);
	const release = parseLatestRelease(await response.json());
	return compareVersions(release.version, currentVersion) > 0 ? release : null;
}

export async function downloadReleaseAsset(
	release: UpdateRelease,
	destination: string,
	onProgress: (percent: number | null) => void,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const expected = `${DOWNLOAD_PREFIX}v${release.version}/${release.assetName}`;
	if (release.assetUrl !== expected || !/^pi-ccui-\d+\.\d+\.\d+-setup\.exe$/.test(release.assetName)) {
		throw new Error("Untrusted update asset URL");
	}
	const response = await fetcher(release.assetUrl, {
		headers: { "User-Agent": "Cc-Desktop-Updater" },
		redirect: "follow",
		signal,
	});
	const finalHost = new URL(response.url || release.assetUrl).hostname;
	if (!response.ok || !response.body || !DOWNLOAD_HOSTS.has(finalHost)) {
		throw new Error(`Update download failed: HTTP ${response.status}`);
	}
	const total = Number(response.headers.get("content-length")) || 0;
	let received = 0;
	onProgress(null);
	await mkdir(dirname(destination), { recursive: true });
	const partial = `${destination}.partial`;
	await rm(partial, { force: true });
	const output = createWriteStream(partial, { flags: "wx" });
	try {
		const reader = response.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!output.write(value)) await once(output, "drain");
			received += value.byteLength;
			onProgress(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null);
		}
		output.end();
		await once(output, "finish");
		if (received === 0) throw new Error("Downloaded update is empty");
		await rename(partial, destination);
		onProgress(100);
	} catch (error) {
		output.destroy();
		await rm(partial, { force: true }).catch(() => {});
		throw error;
	}
}
