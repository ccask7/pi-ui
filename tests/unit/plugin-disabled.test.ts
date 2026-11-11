/**
 * 「界面插件」停用语义（P0 记忆插件带来的宿主小改）：
 * 停用 = 插件**不激活**（AI 工具/路由/订阅/定时器全撤），重新打开 = 重新激活；
 * 数据在磁盘上不受影响；名单落在全局表 `<dataDir>/plugin-disabled.json` 而不是每个浏览器。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginManager } from "../../server/plugins.js";
import { PluginDisabledStore } from "../../server/plugin-disabled.js";

let dir: string;
let mgr: PluginManager;

const TOOL_PLUGIN = `
export default {
	activate(host) {
		host.registerAgentTool({
			name: "demo_tool",
			label: "demo",
			description: "demo",
			parameters: { type: "object", properties: {} },
			execute() { return "ok"; },
		});
		host.route("GET", "/demo", (_req, res) => res.json({ ok: true }));
		return () => {};
	},
};`;

function makePlugin(id: string): void {
	const pdir = join(dir, "plugins", id);
	mkdirSync(pdir, { recursive: true });
	writeFileSync(
		join(pdir, "manifest.json"),
		JSON.stringify({ name: id, apiVersion: 2, permissions: ["tools", "http"] }),
	);
	writeFileSync(join(pdir, "index.mjs"), TOOL_PLUGIN);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "plugin-disabled-"));
	mgr = new PluginManager(dir, dir);
});

afterEach(() => {
	mgr.dispose();
	rmSync(dir, { recursive: true, force: true });
});

describe("PluginDisabledStore", () => {
	it("读写往返 + 过滤非法 id + 内容没变不重写", () => {
		const store = new PluginDisabledStore(dir);
		expect(store.read()).toEqual([]);
		expect(store.write(["memory", "bad id", "../x", "notes"])).toEqual(["memory", "notes"]);
		const file = join(dir, "plugin-disabled.json");
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ids: ["memory", "notes"] });
		const before = readFileSync(file, "utf8");
		store.write(["memory", "notes"]);
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(new PluginDisabledStore(dir).read()).toEqual(["memory", "notes"]);
	});
});

describe("停用 = 不激活", () => {
	it("停用后工具与路由都没了，重新启用后回来（数据不动）", async () => {
		makePlugin("memory");
		await mgr.ensureLoaded();
		expect(mgr.getAgentTools().some((t) => t.name === "demo_tool")).toBe(true);

		mgr.setDisabled(["memory"]);
		await mgr.reload();
		expect(mgr.getAgentTools().some((t) => t.name === "demo_tool")).toBe(false);
		expect(JSON.parse(readFileSync(join(dir, "plugin-disabled.json"), "utf8")).ids).toEqual(["memory"]);

		mgr.setDisabled([]);
		await mgr.reload();
		expect(mgr.getAgentTools().some((t) => t.name === "demo_tool")).toBe(true);
	});

	it("启动时按全局表决定激不激活（重启后仍停用）", async () => {
		makePlugin("memory");
		writeFileSync(join(dir, "plugin-disabled.json"), JSON.stringify({ ids: ["memory"] }));
		const fresh = new PluginManager(dir, dir);
		try {
			const list = await fresh.ensureLoaded();
			expect(fresh.getAgentTools().some((t) => t.name === "demo_tool")).toBe(false);
			// 清单里仍然要在（否则设置面板里没法重新打开）
			expect(list.find((p) => p.id === "memory")).toBeTruthy();
		} finally {
			fresh.dispose();
		}
	});

	it("停用表坏掉当空表，不影响其它插件", async () => {
		makePlugin("memory");
		writeFileSync(join(dir, "plugin-disabled.json"), "{ not json");
		const fresh = new PluginManager(dir, dir);
		try {
			await fresh.ensureLoaded();
			expect(fresh.getAgentTools().some((t) => t.name === "demo_tool")).toBe(true);
			expect(existsSync(join(dir, "plugins", "memory", "index.mjs"))).toBe(true);
		} finally {
			fresh.dispose();
		}
	});
});
