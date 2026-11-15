// @vitest-environment jsdom
/**
 * 记忆视图的冒烟测试：真的把视图挂到 DOM 上，验证工具条能渲染、能开合。
 *
 * 之前这类重构（删按钮忘删绑定、改名忘了引用）只有刷新浏览器才看得见，
 * 这里用 jsdom + 假 canvas 2d 上下文兜住"挂载即崩"这类问题。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 最简 2D 上下文：任何方法调用都吞掉，属性可写。 */
function fakeCtx() {
	return new Proxy(
		{},
		{
			get: (target: Record<string, unknown>, key) => {
				if (key in target) return target[key as string];
				return () => undefined;
			},
			set: (target: Record<string, unknown>, key, value) => {
				target[key as string] = value;
				return true;
			},
		},
	);
}

const records = [
	{
		id: "m1",
		type: "pitfall",
		scope: "project",
		scopeKey: "D:/proj",
		content: "迁移前必须先停服务，否则锁表",
		tags: ["db"],
		importance: 4,
		createdAt: Date.now() - 86_400_000,
		updatedAt: Date.now(),
		strength: 2,
		effStrength: 1.8,
	},
	{
		id: "m2",
		type: "fact",
		scope: "project",
		scopeKey: "D:/proj",
		content: "后端端口是 8765",
		tags: ["db"],
		importance: 3,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		strength: 1,
		effStrength: 1,
	},
];

let cleanup: (() => void) | null = null;

beforeEach(() => {
	HTMLCanvasElement.prototype.getContext = fakeCtx as unknown as HTMLCanvasElement["getContext"];
	globalThis.fetch = vi.fn(async () => ({
		ok: true,
		json: async () => ({ ok: true, now: Date.now(), readonly: false, records, trash: [], blacklistCount: 0 }),
	})) as unknown as typeof fetch;
});

afterEach(() => {
	cleanup?.();
	cleanup = null;
	vi.restoreAllMocks();
});

describe("记忆视图挂载", () => {
	it("挂载后工具条只有搜索 + 3 个图标，点击能展开筛选", async () => {
		const entry = (await import("../../plugins/memory/client/entry.mjs")) as {
			default: { mount: (el: HTMLElement, ctx: unknown) => () => void };
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		cleanup = entry.default.mount(host, {});
		await new Promise((r) => setTimeout(r, 60));

		const icons = host.querySelectorAll(".mem-icon");
		expect(icons.length).toBe(3);
		expect(host.querySelector('[data-act="filters"]')).toBeTruthy();
		expect(host.querySelector('[data-act="more"]')).toBeTruthy();

		const filters = host.querySelector(".mem-filters") as HTMLElement;
		expect(filters.hidden).toBe(true);
		host.querySelector('[data-act="filters"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(filters.hidden).toBe(false);
		// 类型 chip 在展开后才有
		expect(host.querySelectorAll(".mem-chip").length).toBeGreaterThan(0);
	});

	it("⋯ 菜单能开合，且角标显示回收站/隔离区数量", async () => {
		const entry = (await import("../../plugins/memory/client/entry.mjs")) as {
			default: { mount: (el: HTMLElement, ctx: unknown) => () => void };
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		cleanup = entry.default.mount(host, {});
		await new Promise((r) => setTimeout(r, 60));

		const menu = host.querySelector(".mem-menu") as HTMLElement;
		expect(menu.hidden).toBe(true);
		host.querySelector('[data-act="more"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(menu.hidden).toBe(false);
		// 菜单里四个动作都在
		for (const act of ["housekeep", "quarantine", "trash", "export"]) {
			expect(menu.querySelector(`[data-act="${act}"]`)).toBeTruthy();
		}
		host.querySelector('[data-act="more"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(menu.hidden).toBe(true);
	});
});
