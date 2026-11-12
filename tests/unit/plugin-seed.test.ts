/**
 * 内置插件播种：首次启动拷到 <dataDir>/plugins/、默认停用、删了不塞回。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedBundledPlugins } from "../../server/plugin-seed.js";

let dir: string;
let src: string;

/** 造一个假的"出厂副本"：manifest + index + client + 两个不该被拷过去的目录。 */
function makeBundled(): void {
	src = join(dir, "src");
	const p = join(src, "memory");
	mkdirSync(join(p, "client"), { recursive: true });
	mkdirSync(join(p, "test"), { recursive: true });
	mkdirSync(join(p, "eval"), { recursive: true });
	writeFileSync(join(p, "manifest.json"), JSON.stringify({ id: "memory", name: "记忆", version: "0.1.0" }));
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

describe("seedBundledPlugins", () => {
	it("首次启动拷一份，且不带 test/eval", () => {
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual(["memory"]);
		expect(existsSync(join(dest(), "manifest.json"))).toBe(true);
		expect(existsSync(join(dest(), "client", "entry.mjs"))).toBe(true);
		expect(existsSync(join(dest(), "test"))).toBe(false);
		expect(existsSync(join(dest(), "eval"))).toBe(false);
	});

	it("默认停用：写进全局停用表，且保留用户已有的停用项", () => {
		mkdirSync(dataDir(), { recursive: true });
		writeFileSync(join(dataDir(), "plugin-disabled.json"), JSON.stringify({ ids: ["notes"] }));
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.disabled).toEqual(["memory"]);
		const ids = JSON.parse(readFileSync(join(dataDir(), "plugin-disabled.json"), "utf8")).ids;
		expect(ids.sort()).toEqual(["memory", "notes"]);
	});

	it("重复调用幂等（不会重复装、不会重复改停用表）", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		const again = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(again.installed).toEqual([]);
		expect(again.skipped[0]).toMatch(/已存在/);
		expect(again.disabled).toEqual([]);
	});

	it("用户删掉之后不再塞回来", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		rmSync(dest(), { recursive: true, force: true });
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual([]);
		expect(r.skipped[0]).toMatch(/用户删过/);
		expect(existsSync(dest())).toBe(false);
	});

	it("用户自己改过（目录已存在）就不覆盖", () => {
		mkdirSync(dest(), { recursive: true });
		writeFileSync(join(dest(), "manifest.json"), JSON.stringify({ id: "memory", version: "9.9.9" }));
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual([]);
		expect(JSON.parse(readFileSync(join(dest(), "manifest.json"), "utf8")).version).toBe("9.9.9");
	});

	it("包里没有出厂副本时安静跳过（源码运行/裁剪包）", () => {
		const r = seedBundledPlugins(dataDir(), { sourceDir: join(dir, "nope"), log: silent });
		expect(r.installed).toEqual([]);
		expect(r.skipped[0]).toMatch(/包里没有/);
	});
});
