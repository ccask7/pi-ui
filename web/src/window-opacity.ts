/// <reference lib="dom" />
/**
 * 整体不透明度（窗口级透明，对齐 Windows Terminal 的 `opacity` 设置）。
 *
 * 与「面板透明率」（styles.css 里容器色的 `--wallpaper-panel-alpha`，固定 62%）
 * 是两件事：
 *   - `--wallpaper-panel-alpha`：容器色占比，管「卡片/消息区相对面板底板再透一层」的层次；
 *   - `--window-opacity`（本模块）：**整扇窗口**的 alpha。桌面壳里窗口本身是
 *     `transparent: true`，把它调小就连桌面都透出来（Terminal 的 80% 就是这个）；
 *     网页版没有桌面可透，透的是浏览器自己的底色。
 *
 * 值为百分比：100 = 实心（缺省），0 = 全透。应用的层有三处（见 styles.css）：
 *   body 底色 `color-mix(in srgb, var(--bg) var(--window-opacity), transparent)`、
 *   壁纸层 `body.has-wallpaper::before { opacity: var(--window-opacity) }`（图跟着透）、
 *   终端视图容器与 xterm 主题底色（buildTermTheme 里按同一变量算 rgba）。
 *
 * 兜底开关「窗口透明」（`ccui:window-transparent`，缺省开）：关掉时本模块永远按
 * 100% 应用（观感回到实心窗口），并让桌面壳下次启动用非透明窗口（Win10 上透明窗口
 * 拖拽缩放的抖动就没了）——壳侧读自己那份 window-prefs.json，见 desktop/main.ts。
 */
import { useSyncExternalStore } from "react";
import { isDesktopShell } from "./desktop";

export const WINDOW_OPACITY_KEY = "ccui:window-opacity";
export const WINDOW_TRANSPARENT_KEY = "ccui:window-transparent";
/** styles.css / buildTermTheme 共用的窗口 alpha 变量（百分比）。 */
export const WINDOW_OPACITY_VAR = "--window-opacity";
export const DEFAULT_WINDOW_OPACITY = 100;
/** 保存后广播（桌面壳据此重算 WCO 按钮条配色）。 */
export const WINDOW_OPACITY_CHANGE_EVENT = "ccui:window-opacity-change";

/** 规整设置值：非数字回退默认，超出 0–100 夹紧、取整。 */
export function normalizeWindowOpacity(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_WINDOW_OPACITY;
	return Math.min(100, Math.max(0, Math.round(raw)));
}

/** 读取持久化的整体不透明度（localStorage 不可用 / 数据损坏时回退默认）。 */
export function loadWindowOpacity(): number {
	try {
		const raw = localStorage.getItem(WINDOW_OPACITY_KEY);
		if (raw === null) return DEFAULT_WINDOW_OPACITY;
		return normalizeWindowOpacity(Number(raw));
	} catch {
		return DEFAULT_WINDOW_OPACITY;
	}
}

/** 读取「窗口透明」兜底开关（缺省开；只有显式存过 "0" 才算关）。 */
export function loadWindowTransparent(): boolean {
	try {
		return localStorage.getItem(WINDOW_TRANSPARENT_KEY) !== "0";
	} catch {
		return true;
	}
}

/** 实际生效的 alpha：开关关掉时强制 100（观感 = 实心窗口）。 */
export function effectiveWindowOpacity(): number {
	return loadWindowTransparent() ? loadWindowOpacity() : DEFAULT_WINDOW_OPACITY;
}

/**
 * 应用当前值到 :root。内联变量优先于主题 <link> 里的同名声明，
 * 所以主题自带的 `--window-opacity`（若有）会被用户设置覆盖。
 */
export function applyWindowOpacity(): void {
	document.documentElement.style.setProperty(WINDOW_OPACITY_VAR, `${effectiveWindowOpacity()}%`);
}

/** 保存并广播（localStorage 不可写时静默忽略，内存值仍即时生效）。 */
export function saveWindowOpacity(value: number): void {
	const norm = normalizeWindowOpacity(value);
	cachedOpacity = norm;
	try {
		localStorage.setItem(WINDOW_OPACITY_KEY, String(norm));
	} catch {
		/* ignore */
	}
	applyWindowOpacity();
	for (const l of listeners) l();
	window.dispatchEvent(new CustomEvent(WINDOW_OPACITY_CHANGE_EVENT));
}

/**
 * 保存「窗口透明」开关：
 *  - 写 localStorage 并重算 CSS（关掉即时变实心）；
 *  - 桌面壳再通知主进程：下次启动用/不用透明窗口（重建窗口由用户下次启动承担，
 *    这里不改当前窗口的 transparent —— Electron 不支持运行时翻转）。
 */
export function saveWindowTransparent(enabled: boolean): void {
	cachedTransparent = enabled;
	try {
		localStorage.setItem(WINDOW_TRANSPARENT_KEY, enabled ? "1" : "0");
	} catch {
		/* ignore */
	}
	applyWindowOpacity();
	for (const l of listeners) l();
	window.dispatchEvent(new CustomEvent(WINDOW_OPACITY_CHANGE_EVENT));
	if (isDesktopShell()) {
		const api = (window as unknown as { piDesktop?: { setWindowTransparent?: (on: boolean) => Promise<unknown> } })
			.piDesktop;
		void api?.setWindowTransparent?.(enabled);
	}
}

// ---- 订阅：单例 listener 集合（与 wallpaper.ts / chat-width-settings.ts 同模式）--

let cachedOpacity: number | null = null;
let cachedTransparent: boolean | null = null;
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
	listeners.add(onStoreChange);
	return () => {
		listeners.delete(onStoreChange);
	};
}

function getOpacitySnapshot(): number {
	if (cachedOpacity === null) cachedOpacity = loadWindowOpacity();
	return cachedOpacity;
}

function getTransparentSnapshot(): boolean {
	if (cachedTransparent === null) cachedTransparent = loadWindowTransparent();
	return cachedTransparent;
}

/** 当前整体不透明度（设置面板拖动后即时生效，无需刷新）。 */
export function useWindowOpacity(): number {
	return useSyncExternalStore(subscribe, getOpacitySnapshot, getOpacitySnapshot);
}

/** 当前「窗口透明」开关状态。 */
export function useWindowTransparent(): boolean {
	return useSyncExternalStore(subscribe, getTransparentSnapshot, getTransparentSnapshot);
}
