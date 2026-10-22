/// <reference lib="dom" />
/**
 * 面板透明度设置（纯前端 localStorage，不经过 server）。
 *
 * styles.css 里所有容器表面的背景都写成
 *   `color-mix(in srgb, 容器色 var(--wallpaper-panel-alpha), transparent)`
 * （--topbar-bg / --statusbar-bg / --panel-bg / --card-bg / --chip-bg /
 *  --msgs-bg / --inputbox-bg 共用同一个变量），所以「透明度」只需覆盖这一个
 * 变量，不用改动任何组件样式。
 *
 * 语义：值 = 容器色占比 0–100 → 100 = 实色（不透图）、0 = 全透明。
 * 单独生效、不跟随主题（内联变量优先于主题 <link>，换主题也不丢）；
 * 没有背景图时看不出差别（背后就是 body 实色底）。
 *
 * normalize 为纯函数，可单测（tests/unit/panel-opacity.test.ts）。
 */
import { useSyncExternalStore } from "react";

export const PANEL_OPACITY_KEY = "ccui:panel-opacity";
/** styles.css 里所有容器表面共用的透图率变量。 */
export const PANEL_OPACITY_VAR = "--wallpaper-panel-alpha";
export const DEFAULT_PANEL_OPACITY = 100;
/** 保存后广播（桌面壳据此重新同步标题栏按钮条配色）。 */
export const PANEL_OPACITY_CHANGE_EVENT = "ccui:panel-opacity-change";

/** 规整设置值：非数字回退默认，超出 0–100 夹紧、取整。 */
export function normalizePanelOpacity(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_PANEL_OPACITY;
	return Math.min(100, Math.max(0, Math.round(raw)));
}

/** 读取持久化的透明度（localStorage 不可用 / 数据损坏时回退默认）。 */
export function loadPanelOpacity(): number {
	try {
		const raw = localStorage.getItem(PANEL_OPACITY_KEY);
		if (raw === null) return DEFAULT_PANEL_OPACITY;
		return normalizePanelOpacity(Number(raw));
	} catch {
		return DEFAULT_PANEL_OPACITY;
	}
}

/**
 * 应用当前值到 :root。内联变量优先于主题 <link> 里的同名 :root 声明，
 * 所以主题自带的值（如 62%）会被用户设置覆盖——这是「单独设置」的语义。
 */
export function applyPanelOpacity(): void {
	const value = cached ?? loadPanelOpacity();
	document.documentElement.style.setProperty(PANEL_OPACITY_VAR, `${value}%`);
}

/** 保存并广播（localStorage 不可写时静默忽略，内存值仍即时生效）。 */
export function savePanelOpacity(value: number): void {
	const norm = normalizePanelOpacity(value);
	cached = norm;
	try {
		localStorage.setItem(PANEL_OPACITY_KEY, String(norm));
	} catch {
		/* ignore */
	}
	applyPanelOpacity();
	for (const l of listeners) l();
	window.dispatchEvent(new CustomEvent(PANEL_OPACITY_CHANGE_EVENT));
}

// ---- 订阅：单例 listener 集合（与 wallpaper.ts / chat-width-settings.ts 同模式）--

let cached: number | null = null;
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
	listeners.add(onStoreChange);
	return () => {
		listeners.delete(onStoreChange);
	};
}

function getSnapshot(): number {
	if (cached === null) cached = loadPanelOpacity();
	return cached;
}

/** 当前面板不透明度（设置面板拖动后即时生效，无需刷新）。 */
export function usePanelOpacity(): number {
	return useSyncExternalStore(subscribe, getSnapshot);
}
