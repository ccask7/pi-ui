/**
 * 内置插件播种：把随包发行的插件拷进 `<dataDir>/plugins/`。
 *
 * 为什么需要：插件源码有两份位置——仓库/安装包里是"出厂副本"，真正被扫描的是
 * `<dataDir>/plugins/<id>/`。新用户装完直接打开，数据目录里什么都没有，所以这里在
 * **首次启动**时把出厂副本拷过去。
 *
 * 四条不变量（顺序即判定顺序）：
 *   1. 目标已存在 → 什么都不做（用户可能自己改过；升级也交给他自己换，不偷偷覆盖）
 *   2. 播种标记里已有该 id → 什么都不做（用户删过/卸载过，不塞回来）
 *   3. 这是**升级**而不是新装（数据目录里已有 `client-state.json`）→ 不装，只写标记
 *   4. 都没有 → 拷一份 + 写标记
 *
 * 默认**启用**（装完即用）：不写停用表。想关掉用 设置 →「界面插件」的开关，
 * 想彻底删掉用同一行的「卸载」（卸载后这里会记住，不再装回来）。
 *
 * 出厂副本的位置按模块相对路径解析，开发和成品两边都成立：
 *   开发：app/server/plugin-seed.ts   → app/plugins/memory
 *   成品：dist/server/plugin-seed.js  → dist/plugins/memory
 */
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** 随包发行、首次启动自动安装（默认启用）的插件 id。 */
export const BUNDLED_PLUGIN_IDS = ["memory"] as const;

/** 拷插件时不要带过去的东西：测试、评测脚本、以及老版本遗留的数据目录。 */
const SKIP_DIRS = new Set(["test", "eval", "data", "node_modules"]);

const MARKER_FILE = "plugin-seeded.json";

interface SeedMarker {
	ids: string[];
}

function readMarker(dataDir: string): SeedMarker {
	try {
		const raw = JSON.parse(readFileSync(join(dataDir, MARKER_FILE), "utf8")) as { ids?: unknown };
		const ids = Array.isArray(raw?.ids) ? raw.ids.filter((x): x is string => typeof x === "string") : [];
		return { ids };
	} catch {
		return { ids: [] };
	}
}

function writeMarker(dataDir: string, marker: SeedMarker): void {
	const file = join(dataDir, MARKER_FILE);
	try {
		mkdirSync(dataDir, { recursive: true });
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, `${JSON.stringify({ ids: [...new Set(marker.ids)] }, null, 0)}\n`, "utf8");
		renameSync(tmp, file);
	} catch {
		/* 标记写不下去最多下次再试，不阻断启动 */
	}
}

/** 出厂副本目录（可能不存在：源码里跑、或打包时没带上）。 */
export function bundledPluginsDir(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
}

export interface SeedResult {
	installed: string[];
	skipped: string[];
	/** 兼容旧字段：不再有"默认停用"，恒为空数组。 */
	disabled: string[];
}

/** 记住某个 id「已经播种过」（卸载后调用，避免下次启动又装回来）。
 *  目前由 `plugins_uninstall` 通道调用（界面上没有卸载按钮，只有开关）。 */
export function markSeeded(dataDir: string, id: string): void {
	const marker = readMarker(dataDir);
	if (marker.ids.includes(id)) return;
	writeMarker(dataDir, { ids: [...marker.ids, id] });
}

/** 忘记「已播种」标记（「重新安装」时用）。 */
export function forgetSeeded(dataDir: string, id: string): void {
	const marker = readMarker(dataDir);
	if (!marker.ids.includes(id)) return;
	writeMarker(dataDir, { ids: marker.ids.filter((x) => x !== id) });
}

/**
 * 首次启动播种。幂等：重复调用只有第一次会产生副作用。
 * 任何失败都只记日志、不抛（插件装不上不该让整个服务起不来）。
 */
export function seedBundledPlugins(
	dataDir: string,
	opts: { sourceDir?: string; log?: (text: string) => void } = {},
): SeedResult {
	const log = opts.log ?? ((text: string) => console.log(text));
	const srcRoot = opts.sourceDir ?? bundledPluginsDir();
	const pluginsDir = join(dataDir, "plugins");
	const result: SeedResult = { installed: [], skipped: [], disabled: [] };
	const marker = readMarker(dataDir);

	// 升级不塞新插件：只有"第一次装"才自动装。判据是数据目录里还没有 client-state.json
	// （那是第一次连接时写的）。老用户升级上来看到的是自己原来的插件集，不多不少。
	const inUse = existsSync(join(dataDir, "client-state.json"));

	// 第一遍只做判定：哪些该装。
	const toInstall: string[] = [];
	for (const id of BUNDLED_PLUGIN_IDS) {
		if (existsSync(join(pluginsDir, id, "manifest.json"))) {
			result.skipped.push(`${id}（已存在）`);
			continue;
		}
		if (marker.ids.includes(id)) {
			result.skipped.push(`${id}（用户删过，不再塞回）`);
			continue;
		}
		if (inUse) {
			// 升级路径：记一笔"已经考虑过它"，以后也不装。
			result.skipped.push(`${id}（升级安装，不自动塞新插件）`);
			marker.ids = [...marker.ids, id];
			writeMarker(dataDir, { ids: marker.ids });
			continue;
		}
		if (!existsSync(join(srcRoot, id, "manifest.json"))) {
			result.skipped.push(`${id}（包里没有出厂副本）`);
			continue;
		}
		toInstall.push(id);
	}
	if (!toInstall.length) return result;

	for (const id of toInstall) {
		const src = join(srcRoot, id);
		const dest = join(pluginsDir, id);
		try {
			mkdirSync(pluginsDir, { recursive: true });
			cpSync(src, dest, {
				recursive: true,
				filter: (path) => {
					const rel = relative(src, path);
					if (!rel) return true;
					// 两种分隔符都认：relative() 在 Windows 上返回反斜杠
					const first = rel.split(String.fromCharCode(92)).join("/").split("/")[0];
					return !SKIP_DIRS.has(first);
				},
			});
			writeMarker(dataDir, { ids: [...marker.ids, id] });
			marker.ids = [...marker.ids, id];
			result.installed.push(id);
		} catch (err) {
			log(`[plugin-seed] 安装内置插件 ${id} 失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (result.installed.length) {
		log(`[plugin-seed] 已内置安装 ${result.installed.join(", ")}（默认启用；设置 → 界面插件 里可关闭或卸载）`);
	}
	return result;
}
