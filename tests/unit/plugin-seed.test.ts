/**
 * 内置插件同步：每次启动把出厂副本覆盖到 `<dataDir>/plugins/`（保留插件自己的 `data/`）。
 * 规则只有一条 —— 插件随应用版本，不做标记/版本比较/改没改过的判断。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBundledPlugins } from "../../server/plugin-seed.js";

let dir: string;
let src: string;

/** 造一个假的"出厂副本"：manifest + index + client + 两个不该被同步过去的目录。 */
function makeBundled(version = "0.1.0"): void {
	src = join(dir, "src");
	const p = join(src, "memory");
	mkdirSync(join(p, "client"), { recursive: true });
	mkdirSync(join(p, "test"), { recursive: true });
	mkdirSync(join(p, "eval"), { recursive: true });
	writeFileSync(join(p, "manifest.json"), JSON.stringify({ id: "memory", name: "记忆", version }));
	writeFileSync(join(p, "index.mjs"), "export default { activate() {} };\n");
	writeFileSync(join(p, "client", "entry.mjs"), "export default { mount() {} };\n");
	writeFileSync(join(p, "test", "x.test.mjs"), "//");
	writeFileSync(join(p, "eval", "run.mjs"), "//");
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "plugin-seed-"));
	makeBundled();
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const dataDir = () => join(dir, "data");
const dest = () => join(dataDir(), "plugins", "memory");
const silent = () => {};

describe("syncBundledPlugins", () => {
	it("首次启动装一份，且不带 test/eval，也不写停用表", () => {
		const r = syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.synced).toEqual(["memory"]);
		expect(existsSync(join(dest(), "manifest.json"))).toBe(true);
		expect(existsSync(join(dest(), "client", "entry.mjs"))).toBe(true);
		expect(existsSync(join(dest(), "test"))).toBe(false);
		expect(existsSync(join(dest(), "eval"))).toBe(false);
		expect(existsSync(join(dataDir(), "plugin-disabled.json"))).toBe(false);
	});

	it("每次启动都覆盖：出厂版本更高 → 代码跟着变，data/ 保留", () => {
		syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		mkdirSync(join(dest(), "data"), { recursive: true });
		writeFileSync(join(dest(), "data", "memories.jsonl"), '{"id":"kept"}\n');

		makeBundled("0.2.0");
		writeFileSync(join(src, "memory", "client", "entry.mjs"), "new-client\n");
		const r = syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });

		expect(r.synced).toEqual(["memory"]);
		expect(JSON.parse(readFileSync(join(dest(), "manifest.json"), "utf8")).version).toBe("0.2.0");
		expect(readFileSync(join(dest(), "client", "entry.mjs"), "utf8")).toBe("new-client\n");
		expect(readFileSync(join(dest(), "data", "memories.jsonl"), "utf8")).toBe('{"id":"kept"}\n');
	});

	it("本地改过的副本也会被覆盖（插件是应用的一部分，不保留本地魔改）", () => {
		syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		writeFileSync(join(dest(), "index.mjs"), "// 本地魔改\n");
		const r = syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.synced).toEqual(["memory"]);
		expect(readFileSync(join(dest(), "index.mjs"), "utf8")).toBe("export default { activate() {} };\n");
	});

	it("用户删掉目录 → 下次启动装回来", () => {
		syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		rmSync(dest(), { recursive: true, force: true });
		const r = syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.synced).toEqual(["memory"]);
		expect(existsSync(join(dest(), "manifest.json"))).toBe(true);
	});

	it("出厂副本缺失 → 跳过并记日志，不抛", () => {
		const logs: string[] = [];
		const r = syncBundledPlugins(dataDir(), { sourceDir: join(dir, "nope"), log: (text) => logs.push(text) });
		expect(r.synced).toEqual([]);
		expect(r.skipped[0]).toMatch(/包里没有出厂副本/);
		expect(logs).toEqual([]);
	});

	it("顺手清掉已废弃的 plugin-seeded.json", () => {
		mkdirSync(dataDir(), { recursive: true });
		writeFileSync(join(dataDir(), "plugin-seeded.json"), JSON.stringify({ ids: ["memory"] }));
		syncBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(existsSync(join(dataDir(), "plugin-seeded.json"))).toBe(false);
	});
});
