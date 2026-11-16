/**
 * 内置插件播种：首次启动拷到 <dataDir>/plugins/、默认启用、删了/卸载了不塞回。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetSeeded, markSeeded, seedBundledPlugins } from "../../server/plugin-seed.js";

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

	it("默认启用：不写停用表（装完即用，关闭走开关）", () => {
		mkdirSync(dataDir(), { recursive: true });
		writeFileSync(join(dataDir(), "plugin-disabled.json"), JSON.stringify({ ids: ["notes"] }));
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual(["memory"]);
		expect(r.disabled).toEqual([]);
		const ids = JSON.parse(readFileSync(join(dataDir(), "plugin-disabled.json"), "utf8")).ids;
		expect(ids).toEqual(["notes"]); // 只保留用户自己关掉的，不新增
	});

	it("重复调用幂等（不会重复装、不会重复改停用表）", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		const again = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(again.installed).toEqual([]);
		expect(again.skipped[0]).toMatch(/已是最新/);
		expect(again.disabled).toEqual([]);
	});

	it("升级安装（数据目录已在使用）不自动塞新插件，并记下不再考虑", () => {
		mkdirSync(dataDir(), { recursive: true });
		writeFileSync(join(dataDir(), "client-state.json"), "{}");
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual([]);
		expect(r.skipped[0]).toMatch(/升级安装/);
		expect(existsSync(dest())).toBe(false);
		// 之后再启动也不会装：标记里已经记过
		const again = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(again.installed).toEqual([]);
		expect(again.skipped[0]).toMatch(/用户删过/);
	});

	it("用户删掉之后不再塞回来", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		rmSync(dest(), { recursive: true, force: true });
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual([]);
		expect(r.skipped[0]).toMatch(/用户删过/);
		expect(existsSync(dest())).toBe(false);
	});

	it("内置副本版本更高 → 换代码、保留 data/（用户升级后看到新界面）", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		// 插件写出来的数据：升级时必须留着
		mkdirSync(join(dest(), "data"), { recursive: true });
		writeFileSync(join(dest(), "data", "memories.jsonl"), '{"id":"kept"}\n');
		// 出厂副本升到 0.2.0，客户端也换了
		writeFileSync(
			join(src, "memory", "manifest.json"),
			JSON.stringify({ id: "memory", name: "记忆", version: "0.2.0" }),
		);
		writeFileSync(join(src, "memory", "client", "entry.mjs"), "new-client\n");

		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.updated).toEqual(["memory 0.1.0 → 0.2.0"]);
		expect(readFileSync(join(dest(), "client", "entry.mjs"), "utf8")).toBe("new-client\n");
		expect(JSON.parse(readFileSync(join(dest(), "manifest.json"), "utf8")).version).toBe("0.2.0");
		expect(readFileSync(join(dest(), "data", "memories.jsonl"), "utf8")).toBe('{"id":"kept"}\n');
		// 再跑一次：已经是最新，不重复覆盖
		const again = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(again.updated).toEqual([]);
		expect(again.skipped[0]).toMatch(/已是最新 0.2.0/);
	});

	it("本地改过代码就不覆盖（哪怕出厂版本更高）", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		writeFileSync(join(dest(), "index.mjs"), "// 用户自己改的\n");
		writeFileSync(
			join(src, "memory", "manifest.json"),
			JSON.stringify({ id: "memory", name: "记忆", version: "0.3.0" }),
		);
		writeFileSync(join(src, "memory", "client", "entry.mjs"), "new-client\n");

		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.updated).toEqual([]);
		expect(r.skipped[0]).toMatch(/本地改过/);
		expect(readFileSync(join(dest(), "index.mjs"), "utf8")).toBe("// 用户自己改的\n");
		expect(readFileSync(join(dest(), "client", "entry.mjs"), "utf8")).toBe("export default { mount() {} };\n");
	});

	it("老标记（只有 ids，0.0.9/0.0.10 播种的）在版本更高时也会换代码", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		writeFileSync(join(dataDir(), "plugin-seeded.json"), JSON.stringify({ ids: ["memory"] }));
		writeFileSync(join(dest(), "client", "entry.mjs"), "old-client\n");
		writeFileSync(
			join(src, "memory", "manifest.json"),
			JSON.stringify({ id: "memory", name: "记忆", version: "0.2.0" }),
		);
		writeFileSync(join(src, "memory", "client", "entry.mjs"), "new-client\n");

		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.updated).toEqual(["memory 0.1.0 → 0.2.0"]);
		expect(readFileSync(join(dest(), "client", "entry.mjs"), "utf8")).toBe("new-client\n");
	});

	it("用户自己改过（目录已存在）就不覆盖", () => {
		mkdirSync(dest(), { recursive: true });
		writeFileSync(join(dest(), "manifest.json"), JSON.stringify({ id: "memory", version: "9.9.9" }));
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual([]);
		expect(JSON.parse(readFileSync(join(dest(), "manifest.json"), "utf8")).version).toBe("9.9.9");
	});

	it("卸载后再启动不会装回来（markSeeded 生效）", () => {
		seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		rmSync(dest(), { recursive: true, force: true });
		markSeeded(dataDir(), "memory");
		const r = seedBundledPlugins(dataDir(), { sourceDir: src, log: silent });
		expect(r.installed).toEqual([]);
		expect(existsSync(dest())).toBe(false);
	});

	it("forgetSeeded 后可以重新装（「重新安装」路径）", () => {
		markSeeded(dataDir(), "memory");
		expect(seedBundledPlugins(dataDir(), { sourceDir: src, log: silent }).installed).toEqual([]);
		forgetSeeded(dataDir(), "memory");
		expect(seedBundledPlugins(dataDir(), { sourceDir: src, log: silent }).installed).toEqual(["memory"]);
	});

	it("包里没有出厂副本时安静跳过（源码运行/裁剪包）", () => {
		const r = seedBundledPlugins(dataDir(), { sourceDir: join(dir, "nope"), log: silent });
		expect(r.installed).toEqual([]);
		expect(r.skipped[0]).toMatch(/包里没有/);
	});
});
