/**
 * 内置插件同步：把随包发行的插件拷进 `<dataDir>/plugins/`。
 *
 * 规则只有一条：**每次启动都把出厂副本覆盖到数据目录**（插件自己的 `data/` 不在覆盖范围内）。
 * 插件是应用的一部分——装的是哪个版本的应用，用的就是哪个版本的插件；没有播种标记、
 * 版本比较、"用户改过没"这些分支。想停用它用 设置 →「界面插件」的开关；删掉目录
 * 也会在下次启动时回来（内置插件不可卸载）。
 *
 * 老版本留下的 `plugin-seeded.json`（那时用标记 + 版本 + hash 决定装不装）已无用，顺手删掉。
 *
 * 出厂副本的位置按模块相对路径解析，开发和成品两边都成立：
 *   开发：app/server/plugin-seed.ts   → app/plugins/memory
 *   成品：dist/server/plugin-seed.js  → dist/plugins/memory
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** 随包发行、每次启动同步到数据目录的插件 id。 */
export const BUNDLED_PLUGIN_IDS = ["memory"] as const;

/** 同步时不要带过去的东西：测试、评测脚本、插件自己的数据目录。 */
const SKIP_DIRS = new Set(["test", "eval", "data", "node_modules"]);

/** 已废弃的播种标记文件名（0.0.9–0.0.11 用过）。 */
const LEGACY_MARKER = "plugin-seeded.json";

/** 出厂副本目录（可能不存在：源码里跑、或打包时没带上）。 */
export function bundledPluginsDir(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
}

/** 把出厂副本的代码拷到目标目录（保留目标里已有的 `data/` 等运行期文件）。
 *  只覆盖、不删除：上一版有、这一版删掉的文件会留在目标目录里，但不被任何入口引用（无害）。 */
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

export interface BundledSyncResult {
	/** 已同步（安装或更新）的插件 id。 */
	synced: string[];
	/** 跳过（出厂副本缺失、拷贝失败）的 id + 原因。 */
	skipped: string[];
}

/**
 * 启动时同步内置插件。幂等：内容没变也照拷（几百 KB，代价可忽略，换来"永远跟包一致"）。
 * 任何失败都只记日志、不抛（插件装不上不该让整个服务起不来）。
 */
export function syncBundledPlugins(
	dataDir: string,
	opts: { sourceDir?: string; log?: (text: string) => void } = {},
): BundledSyncResult {
	const log = opts.log ?? ((text: string) => console.log(text));
	const srcRoot = opts.sourceDir ?? bundledPluginsDir();
	const pluginsDir = join(dataDir, "plugins");
	const result: BundledSyncResult = { synced: [], skipped: [] };

	for (const id of BUNDLED_PLUGIN_IDS) {
		const src = join(srcRoot, id);
		const dest = join(pluginsDir, id);
		if (!existsSync(join(src, "manifest.json"))) {
			result.skipped.push(`${id}（包里没有出厂副本）`);
			continue;
		}
		try {
			mkdirSync(pluginsDir, { recursive: true });
			copyPluginCode(src, dest);
			result.synced.push(id);
		} catch (err) {
			result.skipped.push(`${id}（同步失败：${err instanceof Error ? err.message : String(err)}）`);
			log(`[plugin-seed] 同步内置插件 ${id} 失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// 老标记文件清掉：它只属于已废弃的"标记决定装不装"逻辑。
	try {
		rmSync(join(dataDir, LEGACY_MARKER), { force: true });
	} catch {
		/* 删不掉不影响使用 */
	}

	if (result.synced.length) {
		log(`[plugin-seed] 内置插件已同步：${result.synced.join(", ")}（随应用版本，可在 设置 → 界面插件 里停用）`);
	}
	return result;
}
