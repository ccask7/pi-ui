import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	checkForUpdate,
	compareVersions,
	downloadReleaseAsset,
	parseLatestRelease,
} from "../../desktop/update-service.js";

const release = {
	tag_name: "v0.1.0",
	body: "Bug fixes",
	prerelease: false,
	draft: false,
	assets: [
		{
			name: "pi-ccui-0.1.0-setup.exe",
			browser_download_url: "https://github.com/ccask7/pi-ui/releases/download/v0.1.0/pi-ccui-0.1.0-setup.exe",
		},
	],
};

describe("桌面手动更新服务", () => {
	it("正确比较数字版本，而不是按字符串比较", () => {
		expect(compareVersions("v0.0.10", "0.0.9")).toBe(1);
		expect(compareVersions("0.1.0", "v0.1.0")).toBe(0);
		expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
	});

	it("只在用户调用的检查中请求固定 API，并返回较新的稳定版", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(release), { status: 200 }));
		expect(fetcher).not.toHaveBeenCalled();
		const result = await checkForUpdate("0.0.9", fetcher as typeof fetch);
		expect(result?.version).toBe("0.1.0");
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher.mock.calls[0][0]).toBe("https://api.github.com/repos/ccask7/pi-ui/releases/latest");
	});

	it("当前版本相同或更新时不提示升级", async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(release), { status: 200 }));
		expect(await checkForUpdate("0.1.0", fetcher as typeof fetch)).toBeNull();
		expect(await checkForUpdate("0.2.0", fetcher as typeof fetch)).toBeNull();
	});

	it("缺少匹配安装包时拒绝该 Release", () => {
		expect(() => parseLatestRelease({ ...release, assets: [] })).toThrow("Release asset not found");
		expect(() => parseLatestRelease({ ...release, prerelease: true })).toThrow("stable release");
	});

	it("模拟下载时写入安装包并报告进度", async () => {
		const directory = await mkdtemp(join(tmpdir(), "cc-update-test-"));
		try {
			const bytes = new TextEncoder().encode("MZ-test-installer");
			const fetcher = vi.fn<typeof fetch>(
				async () => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } }),
			);
			const destination = join(directory, "setup.exe");
			const progress: (number | null)[] = [];
			await downloadReleaseAsset(
				parseLatestRelease(release),
				destination,
				(value) => progress.push(value),
				undefined,
				fetcher,
			);
			expect(await readFile(destination, "utf8")).toBe("MZ-test-installer");
			expect(progress.at(0)).toBeNull();
			expect(progress.at(-1)).toBe(100);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("下载前拒绝任意非本仓库地址", async () => {
		const fetcher = vi.fn();
		await expect(
			downloadReleaseAsset(
				{ ...parseLatestRelease(release), assetUrl: "https://example.com/setup.exe" },
				"unused.exe",
				() => {},
				undefined,
				fetcher as unknown as typeof fetch,
			),
		).rejects.toThrow("Untrusted update asset URL");
		expect(fetcher).not.toHaveBeenCalled();
	});
});
