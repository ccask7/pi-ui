/**
 * 插件卸载：删除 `<dataDir>/plugins/<id>/` 整目录（含插件自己的数据）+ 反激活 + 从停用表移除。
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginManager } from "../../server/plugins.js";

/** 造一个最小插件目录（manifest + 空入口 + 自己的数据目录）。 */
function makePlugin(dataDir: string, id: string, withData = true): string {
	const dir = join(dataDir, "plugins", id);
	mkdirSync(join(dir, "client"), { recursive: true });
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify({ id, name: id, version: "0.0.1", apiVersion: 2, permissions: [], ui: { items: [] } }),
	);
	writeFileSync(join(dir, "index.mjs"), "export default { activate() {}, deactivate() {} };\n");
	if (withData) {
		mkdirSync(join(dir, "data"), { recursive: true });
		writeFileSync(join(dir, "data", "memories.jsonl"), '{"id":"x"}\n');
	}
	return dir;
}

const tmp = () => mkdtempSync(join(tmpdir(), "plugin-uninstall-"));

describe("PluginManager.uninstall", () => {
	it("删掉整个插件目录（含 data/）并从清单里消失", async () => {
		const dataDir = tmp();
		const dir = makePlugin(dataDir, "memory");
		const mgr = new PluginManager(dataDir, dataDir);
		await mgr.ensureLoaded(() => "zh");
		expect(existsSync(join(dir, "data", "memories.jsonl"))).toBe(true);

		const r = await mgr.uninstall("memory");
		expect(r.ok).toBe(true);
		expect(existsSync(dir)).toBe(false);

		const list = await mgr.ensureLoaded(() => "zh");
		expect(list.find((p) => p.id === "memory")).toBeUndefined();
		mgr.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("顺带把 id 从停用表里摘掉（卸载后不该留垃圾项）", async () => {
		const dataDir = tmp();
		makePlugin(dataDir, "memory");
		const mgr = new PluginManager(dataDir, dataDir);
		mgr.setDisabled(["memory", "other"]);
		await mgr.ensureLoaded(() => "zh");
		await mgr.uninstall("memory");
		expect(mgr.disabledIds()).toEqual(["other"]);
		mgr.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("连同它拿过的目录 / 网络 / 模型 / DOM 授权与设置覆盖一起清掉", async () => {
		const dataDir = tmp();
		makePlugin(dataDir, "memory");
		writeFileSync(
			join(dataDir, "plugin-grants.json"),
			JSON.stringify({ grants: { memory: ["/tmp/shared"], other: ["/tmp/k"] } }),
		);
		writeFileSync(
			join(dataDir, "plugin-permissions.json"),
			JSON.stringify({ grants: [{ pluginId: "memory", family: "net", hosts: ["api.example.com"] }] }),
		);
		writeFileSync(join(dataDir, "plugin-dom.json"), JSON.stringify({ granted: ["memory", "other"] }));
		mkdirSync(join(dataDir, "plugin-overrides"), { recursive: true });
		writeFileSync(join(dataDir, "plugin-overrides", "memory.json"), JSON.stringify({ autoRemember: false }));

		const mgr = new PluginManager(dataDir, dataDir);
		await mgr.ensureLoaded(() => "zh");
		const r = await mgr.uninstall("memory");
		expect(r.ok).toBe(true);

		const grants = JSON.parse(readFileSync(join(dataDir, "plugin-grants.json"), "utf8")) as {
			grants: Record<string, string[]>;
		};
		expect(grants.grants.memory).toBeUndefined();
		expect(grants.grants.other).toHaveLength(1);
		expect(grants.grants.other[0]?.endsWith("k")).toBe(true);
		expect(readFileSync(join(dataDir, "plugin-permissions.json"), "utf8")).not.toContain("memory");
		expect(existsSync(join(dataDir, "plugin-overrides", "memory.json"))).toBe(false);
		mgr.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("内置插件拒绝卸载（随应用安装/更新，删了也会回来）", async () => {
		const dataDir = tmp();
		makePlugin(dataDir, "memory");
		const mgr = new PluginManager(dataDir, dataDir, ["memory"]);
		await mgr.ensureLoaded(() => "zh");
		const r = await mgr.uninstall("memory");
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/内置插件/);
		expect(existsSync(join(dataDir, "plugins", "memory", "index.mjs"))).toBe(true);
		// 清单里带 bundled 标记（前端据此隐藏卸载按钮）
		const [info] = await mgr.ensureLoaded(() => "zh");
		expect(info.bundled).toBe(true);
		mgr.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it("目录不存在 / 非法 id 直接拒绝，不抛", async () => {
		const dataDir = tmp();
		const mgr = new PluginManager(dataDir, dataDir);
		await mgr.ensureLoaded(() => "zh");
		expect((await mgr.uninstall("nope")).ok).toBe(false);
		expect((await mgr.uninstall("../evil")).ok).toBe(false);
		mgr.dispose();
		rmSync(dataDir, { recursive: true, force: true });
	});
});
