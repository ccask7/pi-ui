/**
 * 面板透明度设置单测（见 web/src/panel-opacity.ts）。
 * 只测 normalize —— localStorage / DOM 操作在 node 环境不可用，
 * load/save/apply 都有 try/catch 或调用方保证，不在单测范围内。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_OPACITY, normalizePanelOpacity } from "../../web/src/panel-opacity.js";

describe("normalizePanelOpacity", () => {
	it("合法数字原样保留（取整）", () => {
		expect(normalizePanelOpacity(0)).toBe(0);
		expect(normalizePanelOpacity(62)).toBe(62);
		expect(normalizePanelOpacity(100)).toBe(100);
		expect(normalizePanelOpacity(62.4)).toBe(62);
		expect(normalizePanelOpacity(62.6)).toBe(63);
	});

	it("超出 0–100 夹紧", () => {
		expect(normalizePanelOpacity(-10)).toBe(0);
		expect(normalizePanelOpacity(300)).toBe(100);
		expect(normalizePanelOpacity(-0.4)).toBe(0);
	});

	it("非数字回退默认（100 = 实色）", () => {
		expect(normalizePanelOpacity(null)).toBe(DEFAULT_PANEL_OPACITY);
		expect(normalizePanelOpacity(undefined)).toBe(DEFAULT_PANEL_OPACITY);
		expect(normalizePanelOpacity("62")).toBe(DEFAULT_PANEL_OPACITY);
		expect(normalizePanelOpacity(Number.NaN)).toBe(DEFAULT_PANEL_OPACITY);
		expect(normalizePanelOpacity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PANEL_OPACITY);
		expect(normalizePanelOpacity({})).toBe(DEFAULT_PANEL_OPACITY);
	});

	it("默认值是不透明（100）", () => {
		expect(DEFAULT_PANEL_OPACITY).toBe(100);
	});
});
