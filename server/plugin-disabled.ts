/**
 * 插件的**全局**停用表（`<dataDir>/plugin-disabled.json`）。
 *
 * 为什么是全局而不是每客户端：插件是在这台机器上装的一份 Node 代码，它的 AI 工具、HTTP
 * 路由、定时任务、事件订阅全都是进程级的。如果"停用"只按浏览器记，A 浏览器关掉的插件在
 * B 浏览器里还在跑 —— 那就不叫停用了。所以停用状态落在这里，谁改都写同一份。
 *
 * 设置面板的「界面插件」开关仍然读写每个客户端设置里的 `disabledPlugins`（前端靠它隐藏
 * 视图/条目），保存时顺带写这份全局表；服务端以这份为准决定激不激活。
 * 与目录授权表（plugin-dom.json）同口径：坏文件当空表、变更才落盘。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ID_RE = /^[A-Za-z0-9_-]+$/;

export class PluginDisabledStore {
	private readonly file: string;
	private cache: string[] | null = null;

	constructor(dataDir: string) {
		this.file = join(dataDir, "plugin-disabled.json");
	}

	read(): string[] {
		if (this.cache) return [...this.cache];
		try {
			const raw = JSON.parse(readFileSync(this.file, "utf8")) as { ids?: unknown };
			const ids = Array.isArray(raw?.ids)
				? raw.ids.filter((x): x is string => typeof x === "string" && ID_RE.test(x))
				: [];
			this.cache = [...new Set(ids)];
		} catch {
			this.cache = [];
		}
		return [...this.cache];
	}

	write(ids: readonly string[]): string[] {
		const next = [...new Set(ids.filter((x) => typeof x === "string" && ID_RE.test(x)))];
		const before = this.read();
		const same = before.length === next.length && before.every((x, i) => x === next[i]);
		this.cache = next;
		if (same) return next;
		if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.tmp`;
		writeFileSync(tmp, `${JSON.stringify({ ids: next }, null, 0)}\n`, "utf8");
		renameSync(tmp, this.file);
		return next;
	}
}
