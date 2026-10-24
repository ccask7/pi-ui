/**
 * 整体不透明度设置单测（见 web/src/window-opacity.ts）。
 * 只测纯函数与缺省值 —— localStorage / DOM 在 node 环境不可用，
 * load/save/apply 都带 try/catch，不在单测范围内。
 */
import { describe, expect, it } from "vitest";
import {
	DEFAULT_WINDOW_OPACITY,
	WINDOW_OPACITY_VAR,
	normalizeWindowOpacity,
} from "../../web/src/window-opacity.js";

describe("normalizeWindowOpacity", () => {
	it("合法数字原样保留（取整）", () => {
		expect(normalizeWindowOpacity(0)).toBe(0);
		expect(normalizeWindowOpacity(80)).toBe(80);
		expect(normalizeWindowOpacity(100)).toBe(100);
		expect(normalizeWindowOpacity(62.4)).toBe(62);
		expect(normalizeWindowOpacity(62.6)).toBe(63);
	});

	it("超出 0–100 夹紧", () => {
		expect(normalizeWindowOpacity(-10)).toBe(0);
		expect(normalizeWindowOpacity(300)).toBe(100);
		expect(normalizeWindowOpacity(-0.4)).toBe(0);
	});

	it("非数字回退默认", () => {
		expect(normalizeWindowOpacity(null)).toBe(DEFAULT_WINDOW_OPACITY);
		expect(normalizeWindowOpacity(undefined)).toBe(DEFAULT_WINDOW_OPACITY);
		expect(normalizeWindowOpacity("80")).toBe(DEFAULT_WINDOW_OPACITY);
		expect(normalizeWindowOpacity(Number.NaN)).toBe(DEFAULT_WINDOW_OPACITY);
		expect(normalizeWindowOpacity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WINDOW_OPACITY);
		expect(normalizeWindowOpacity({})).toBe(DEFAULT_WINDOW_OPACITY);
	});

	// 缺省必须是实心（100）：窗口级透明是显式开启的功能，不能一升级就把所有人的
	// 窗口变半透明；用户自己拖滑杆才算「我要透」。
	it("缺省值是实心窗口（100）", () => {
		expect(DEFAULT_WINDOW_OPACITY).toBe(100);
	});

	it("变量名与 styles.css / theme.ts 的约定一致", () => {
		expect(WINDOW_OPACITY_VAR).toBe("--window-opacity");
	});
});
