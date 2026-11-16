/**
 * 内置插件播种：把随包发行的插件拷进 `<dataDir>/plugins/`，并随应用升级更新它们的代码。
 *
 * 为什么需要：插件源码有两份位置——仓库/安装包里是"出厂副本"，真正被扫描的是
 * `<dataDir>/plugins/<id>/`。新用户装完直接打开，数据目录里什么都没有，所以这里在
 * **首次启动**时把出厂副本拷过去。
 *
 * 判定顺序（`plugin-seeded.json` 记 ids / versions / hashes）：
 *   1. 目录不存在 + 标记里有该 id → 跳过（用户删过 / 卸载过，不塞回来）
 *   2. 目录不存在 + 数据目录已在用（`client-state.json` 存在）→ 只写标记（升级不塞新插件）
 *   3. 目录不存在 + 出厂副本在 → 拷一份（记版本 + 代码 hash）
 *   4. 目录存在 + 标记里没有该 id → 用户自己装的，不动
 *   5. 目录存在 + 标记里有该 id → 这是内置副本：
 *        a. 本地代码被改过（hash 与播种时不一致）→ 不动
 *        b. 出厂副本版本更新 → **只换代码、保留 `data/`**（内置插件随应用升级）
 *        c. 否则不动
 *
 * 为什么要有 5b：内置插件是随安装包发的，如果只在首次安装时拷一次，之后应用升级
 * 用户永远停在上旧界面上（0.0.9 → 0.0.10 真发生过）。代码更新只覆盖出厂文件，
 * 插件自己的数据目录 `data/` 与用户手改过的副本都保留。
 *
 * 默认**启用**（装完即用）：不写停用表。想关掉用 设置 →「界面插件」的开关，
 * 想彻底删掉用同一行的「卸载」（卸载后这里会记住，不再装回来）。
 *
 * 出厂副本的位置按模块相对路径解析，开发和成品两边都成立：
 *   开发：app/server/plugin-seed.ts   → app/plugins/memory
 *   成品：dist/server/plugin-seed.js  → dist/plugins/memory
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** 随包发行、首次启动自动安装（默认启用）的插件 id。 */
export const BUNDLED_PLUGIN_IDS = ["memory"] as const;

/** 拷插件时不要带过去的东西：测试、评测脚本、以及插件自己的数据目录。 */
const SKIP_DIRS = new Set(["test", "eval", "data", "node_modules"]);

const MARKER_FILE = "plugin-seeded.json";

interface SeedMarker {
	/** 播种过 / 考虑过的 id（命中即"不再自动安装"）。 */
	ids: string[];
	/** 最近一次播种/更新写入的版本（id → manifest.version），用于判断要不要换代码。 */
	versions: Record<string, string>;
	/** 播种/更新完成时的代码 hash（id → hash）。与当前不一致 = 用户改过，不覆盖。 */
	hashes: Record<string, string>;
}

function strMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function readMarker(dataDir: string): SeedMarker {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, MARKER_FILE), "utf8")) as {
			ids?: unknown;
			versions?: unknown;
			hashes?: unknown;
		};
		const ids = Array.isArray(raw?.ids) ? raw.ids.filter((x): x is string => typeof x === "string") : [];
		return { ids, versions: strMap(raw?.versions), hashes: strMap(raw?.hashes) };
	} catch {
		return { ids: [], versions: {}, hashes: {} };
	}
}

function writeMarker(dataDir: string, marker: SeedMarker): void {
	const file = join(dataDir, MARKER_FILE);
	try {
		mkdirSync(dataDir, { recursive: true });
		const tmp = `${file}.tmp`;
		const body = {
			ids: [...new Set(marker.ids)],
			...(Object.keys(marker.versions).length ? { versions: marker.versions } : {}),
			...(Object.keys(marker.hashes).length ? { hashes: marker.hashes } : {}),
		};
		writeFileSync(tmp, `${JSON.stringify(body, null, 0)}\n`, "utf8");
		renameSync(tmp, file);
	} catch {
		/* 标记写不下去最多下次再试，不阻断启动 */
	}
}

/** 出厂副本目录（可能不存在：源码里跑、或打包时没带上）。 */
export function bundledPluginsDir(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
}

/** 插件目录里"代码"部分的相对路径（不含 data/test/eval/node_modules，排序稳定）。 */
function codeFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, prefix: string): void => {
		let names: string[];
		try {
			names = readdirSync(dir).sort();
		} catch {
			return;
		}
		for (const name of names) {
			if (!prefix && SKIP_DIRS.has(name)) continue;
			const abs = join(dir, name);
			const rel = prefix ? `${prefix}/${name}` : name;
			let isDir = false;
			try {
				isDir = statSync(abs).isDirectory();
			} catch {
				continue;
			}
			if (isDir) walk(abs, rel);
			else out.push(rel);
		}
	};
	walk(root, "");
	return out;
}

/** 代码 hash：相对路径 + 内容。用于识别"用户自己改过"的副本。 */
export function pluginCodeHash(dir: string): string {
	const hash = createHash("sha256");
	for (const rel of codeFiles(dir)) {
		hash.update(rel);
		hash.update("\u0000");
		try {
			hash.update(readFileSync(join(dir, rel)));
		} catch {
			/* 读不了的文件按空内容计入，不影响"变没变"的判断 */
		}
		hash.update("\u0000");
	}
	return hash.digest("hex");
}

/** `1.2.3` 比较（非数字段按 0）。只用于"出厂副本是不是更新了"。 */
function compareVersions(a: string, b: string): number {
	const parse = (v: string): number[] =>
		String(v ?? "")
			.split(".")
			.map((part) => Number.parseInt(part, 10) || 0);
	const left = parse(a);
	const right = parse(b);
	for (let i = 0; i < 3; i += 1) {
		const x = left[i] ?? 0;
		const y = right[i] ?? 0;
		if (x !== y) return x > y ? 1 : -1;
	}
	return 0;
}

function manifestVersion(dir: string): string {
	try {
		const parsed = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { version?: unknown };
		return typeof parsed.version === "string" ? parsed.version : "";
	} catch {
		return "";
	}
}

/** 把出厂副本的**代码**拷到目标目录（保留目标里已有的 `data/` 等运行期文件）。
 *  只覆盖、不删除：新版本里删掉的文件会留在目标目录里，但不被任何入口引用（无害）。 */
function copyPluginCode(src: string, dest: string): void {
	cpSync(src, dest, {
		recursive: true,
		force: true,
		filter: (path) => {
			const rel = relative(src, path);
			if (!rel) return true;
			// 两种分隔符都认：relative() 在 Windows 上返回反斜杠
			const first = rel.split(String.fromCharCode(92)).join("/").split("/")[0];
			return !SKIP_DIRS.has(first);
		},
	});
}

export interface SeedResult {
	installed: string[];
	/** 版本升级时被换掉代码的内置插件（形如 `memory 0.1.1 → 0.2.0`）。 */
	updated: string[];
	skipped: string[];
	/** 兼容旧字段：不再有"默认停用"，恒为空数组。 */
	disabled: string[];
}

/** 记住某个 id「已经播种过」（卸载后调用，避免下次启动又装回来）。
 *  由 `plugins_uninstall` 通道调用（设置 →「界面插件」每行的垃圾桶）。 */
export function markSeeded(dataDir: string, id: string): void {
	const marker = readMarker(dataDir);
	if (marker.ids.includes(id)) return;
	const versions = Object.fromEntries(Object.entries(marker.versions).filter(([key]) => key !== id));
	const hashes = Object.fromEntries(Object.entries(marker.hashes).filter(([key]) => key !== id));
	writeMarker(dataDir, { ids: [...marker.ids, id], versions, hashes });
}

/** 忘记「已播种」标记（「重新安装」时用）。 */
export function forgetSeeded(dataDir: string, id: string): void {
	const marker = readMarker(dataDir);
	if (!marker.ids.includes(id)) return;
	writeMarker(dataDir, {
		ids: marker.ids.filter((x) => x !== id),
		versions: Object.fromEntries(Object.entries(marker.versions).filter(([key]) => key !== id)),
		hashes: Object.fromEntries(Object.entries(marker.hashes).filter(([key]) => key !== id)),
	});
}

/**
 * 首次启动播种 + 升级换代码。幂等：重复调用只有版本变化时才产生副作用。
 * 任何失败都只记日志、不抛（插件装不上不该让整个服务起不来）。
 */
export function seedBundledPlugins(
	dataDir: string,
	opts: { sourceDir?: string; log?: (text: string) => void } = {},
): SeedResult {
	const log = opts.log ?? ((text: string) => console.log(text));
	const srcRoot = opts.sourceDir ?? bundledPluginsDir();
	const pluginsDir = join(dataDir, "plugins");
	const result: SeedResult = { installed: [], updated: [], skipped: [], disabled: [] };
	const marker = readMarker(dataDir);

	// 升级不塞新插件：只有"第一次装"才自动装。判据是数据目录里还没有 client-state.json
	// （那是第一次连接时写的）。老用户升级上来看到的是自己原来的插件集，不多不少。
	const inUse = existsSync(join(dataDir, "client-state.json"));

	for (const id of BUNDLED_PLUGIN_IDS) {
		const src = join(srcRoot, id);
		const dest = join(pluginsDir, id);
		const hasBundled = existsSync(join(src, "manifest.json"));
		const hasInstalled = existsSync(join(dest, "manifest.json"));

		// ---- 没装：首次安装 / 升级不塞 / 用户删过 ----
		if (!hasInstalled) {
			if (marker.ids.includes(id)) {
				result.skipped.push(`${id}（用户删过，不再塞回）`);
				continue;
			}
			if (inUse) {
				// 升级路径：记一笔"已经考虑过它"，以后也不装。
				result.skipped.push(`${id}（升级安装，不自动塞新插件）`);
				marker.ids = [...marker.ids, id];
				writeMarker(dataDir, marker);
				continue;
			}
			if (!hasBundled) {
				result.skipped.push(`${id}（包里没有出厂副本）`);
				continue;
			}
			try {
				mkdirSync(pluginsDir, { recursive: true });
				copyPluginCode(src, dest);
				const version = manifestVersion(src);
				marker.ids = [...marker.ids, id];
				marker.versions[id] = version;
				marker.hashes[id] = pluginCodeHash(dest);
				writeMarker(dataDir, marker);
				result.installed.push(id);
			} catch (err) {
				log(`[plugin-seed] 安装内置插件 ${id} 失败：${err instanceof Error ? err.message : String(err)}`);
			}
			continue;
		}

		// ---- 已装：只维护"我们自己播种的那一份" ----
		if (!marker.ids.includes(id)) {
			result.skipped.push(`${id}（已存在，不是内置播种的副本）`);
			continue;
		}
		if (!hasBundled) {
			result.skipped.push(`${id}（已存在，包里没有出厂副本）`);
			continue;
		}
		const installedVersion = manifestVersion(dest);
		const bundledVersion = manifestVersion(src);
		const seededHash = marker.hashes[id];
		if (seededHash && seededHash !== pluginCodeHash(dest)) {
			result.skipped.push(`${id}（本地改过，不覆盖）`);
			continue;
		}
		if (compareVersions(bundledVersion, installedVersion) <= 0) {
			result.skipped.push(`${id}（已是最新 ${installedVersion || "?"}）`);
			// 老标记（没有 version/hash，比如 0.0.9/0.0.10 播种的）顺手补齐，下次能判断改没改。
			const changed = marker.versions[id] !== installedVersion || marker.hashes[id] !== pluginCodeHash(dest);
			if (changed && installedVersion) {
				marker.versions[id] = installedVersion;
				marker.hashes[id] = pluginCodeHash(dest);
				writeMarker(dataDir, marker);
			}
			continue;
		}
		try {
			copyPluginCode(src, dest);
			marker.versions[id] = bundledVersion;
			marker.hashes[id] = pluginCodeHash(dest);
			writeMarker(dataDir, marker);
			result.updated.push(`${id} ${installedVersion || "?"} → ${bundledVersion}`);
		} catch (err) {
			log(`[plugin-seed] 更新内置插件 ${id} 失败（保留旧版本）：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (result.installed.length) {
		log(`[plugin-seed] 已内置安装 ${result.installed.join(", ")}（默认启用；设置 → 界面插件 里可关闭或卸载）`);
	}
	if (result.updated.length) {
		log(`[plugin-seed] 内置插件已随应用升级：${result.updated.join(", ")}`);
	}
	return result;
}
