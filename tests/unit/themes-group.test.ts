import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { listThemes, resolveThemeFile } from "../../server/themes.js";

const BUILTIN_DIR = join(__dirname, "../../themes");
const USER_DIR = join(__dirname, "../../tests/fixtures/non-existent");

/**
 * 内置主题已裁剪为 3 个文件：vs-code-dark / vs-code-light（classic 分组）+
 * dark-teal（builtin 分组）；默认深色内嵌在 styles.css，无文件。
 * 用户主题（<dataDir>/themes）不受影响。
 */
describe("主题清单（裁剪后）", () => {
	it("listThemes 只扫出保留的 3 套主题", () => {
		const themes = listThemes(BUILTIN_DIR, USER_DIR);
		const ids = themes.map((t) => t.id).sort();
		expect(ids).toEqual(["dark-teal", "vs-code-dark", "vs-code-light"]);
	});

	it("分组与显示名正确", () => {
		const themes = listThemes(BUILTIN_DIR, USER_DIR);
		const byId = new Map(themes.map((t) => [t.id, t]));
		expect(byId.get("vs-code-dark")?.group).toBe("classic");
		expect(byId.get("vs-code-light")?.group).toBe("classic");
		expect(byId.get("dark-teal")?.group).toBe("builtin");
		expect(byId.get("vs-code-dark")?.name).toBe("VS Code 黑");
		expect(byId.get("vs-code-light")?.name).toBe("VS Code 白");
		expect(byId.get("dark-teal")?.name).toBe("暗青");
		expect(byId.get("vs-code-dark")?.builtin).toBe(true);
	});

	it("resolveThemeFile 能解析保留主题的 css 路径", () => {
		for (const id of ["vs-code-dark", "vs-code-light", "dark-teal"]) {
			const file = resolveThemeFile(BUILTIN_DIR, USER_DIR, id);
			expect(file).toBeTruthy();
			expect(file).toContain(`${id}.css`);
		}
	});

	it("解析 color-scheme 标注浅色/深色", () => {
		const themes = listThemes(BUILTIN_DIR, USER_DIR);
		const byId = new Map(themes.map((t) => [t.id, t]));
		expect(byId.get("vs-code-light")?.scheme).toBe("light");
		expect(byId.get("vs-code-dark")?.scheme).toBe("dark");
		expect(byId.get("dark-teal")?.scheme).toBe("dark");
	});

	it("保留主题文件是合法 :root 覆盖（含调色板变量）", () => {
		for (const id of ["vs-code-dark", "vs-code-light", "dark-teal"]) {
			const css = readFileSync(join(BUILTIN_DIR, `${id}.css`), "utf8");
			expect(css).toContain(":root {");
			expect(css).toContain("--bg:");
			expect(css).toContain("--accent:");
		}
	});
});
