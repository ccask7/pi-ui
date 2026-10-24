/**
 * Theme switching — themes are pure `:root` palette overrides served by the
 * backend (/themes/<id>.css). The whole layout (with the default dark
 * palette as :root variables) lives in the bundled styles.css; a theme file
 * only re-declares the :root CSS variables it wants to override.
 *
 * The bundled default (dark) is always present; picking another theme injects
 * a <link rel="stylesheet"> AFTER the bundled styles.css, so its :root
 * variables win the cascade. Selecting the default removes the link. Choice
 * persists in localStorage per browser.
 */
import { useCallback, useEffect, useState } from "react";
import { withToken } from "./auth-token";
import { appUrl } from "./base-url";

export interface ThemeInfo {
	id: string;
	name: string;
	builtin: boolean;
	nameEn?: string;
	group?: "classic" | "builtin";
	scheme?: "dark" | "light";
}

const STORAGE_KEY = "ccui:theme";
/** id of the bundled default theme (no extra link loaded). */
const DEFAULT_THEME_ID = "dark";
const LINK_ID = "theme-stylesheet";
/** Broadcast when the active theme changes (after the <link> has loaded). */
export const THEME_CHANGE_EVENT = "ccui:theme-change";

export function loadTheme(): string | null {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved && saved !== DEFAULT_THEME_ID) return saved;
	} catch {
		// localStorage unavailable — fall through to the default.
	}
	return null;
}

export function saveTheme(id: string | null): void {
	try {
		if (id) localStorage.setItem(STORAGE_KEY, id);
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore storage errors
	}
}

/** Inject/replace the theme <link>. null = bundled default (dark). */
export function applyTheme(id: string | null): void {
	let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
	if (!id) {
		link?.remove();
		window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
		return;
	}
	if (!link) {
		link = document.createElement("link");
		link.id = LINK_ID;
		link.rel = "stylesheet";
		document.head.appendChild(link);
	}
	link.href = appUrl(`/themes/${encodeURIComponent(id)}.css`);
	// The xterm canvas needs to re-theme once the new stylesheet has applied
	// (its colors are read from the CSS variables via buildTermTheme).
	link.onload = () => window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}

export async function fetchThemes(): Promise<ThemeInfo[]> {
	try {
		const res = await fetch(withToken(appUrl("/api/themes")));
		if (!res.ok) return [];
		const data = (await res.json()) as { themes?: ThemeInfo[] };
		return Array.isArray(data.themes) ? data.themes : [];
	} catch {
		return [];
	}
}

/** React hook: theme list + current selection + setter (persists + applies). */
export function useTheme() {
	const [themes, setThemes] = useState<ThemeInfo[]>([]);
	const [theme, setTheme] = useState<string | null>(() => loadTheme());

	useEffect(() => {
		let cancelled = false;
		fetchThemes().then((list) => {
			if (!cancelled) setThemes(list);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	/** 按需重拉列表：挂载那次若撞上服务端重启（升级/更新）会扑空，而平时不再拉，
	 *  不补一次就永远只剩默认深色。下拉打开时调一次即可（React 18 下已卸载的
	 *  setState 是空操作，无需守卫）。 */
	const reloadThemes = useCallback(() => {
		fetchThemes().then(setThemes);
	}, []);

	useEffect(() => {
		applyTheme(theme);
		saveTheme(theme);
	}, [theme]);

	const switchTheme = (id: string | null) => setTheme(id === DEFAULT_THEME_ID ? null : id);

	return { themes, theme, switchTheme, reloadThemes };
}

/**
 * 把 CSS 颜色（hex/rgb/color-mix 计算结果）+ 窗口 alpha 组成 xterm 认识的
 * `rgba()`：xterm 自己的颜色解析器不认 `color-mix()`，所以这里借一个探针元素
 * 让浏览器把 `--term-bg` 解析成 rgb() 三元组，再补 alpha。
 */
function termBackground(alpha: number): string {
	// 必须解析成 rgb()/rgba()：xterm 自己解析颜色，不认 `var(--term-bg)`。
	const probe = document.createElement("span");
	probe.style.color = "var(--term-bg)";
	probe.style.display = "none";
	document.body.appendChild(probe);
	const rgb = getComputedStyle(probe).color;
	probe.remove();
	const nums = rgb.match(/[\d.]+/g);
	if (!nums || nums.length < 3) return alpha >= 1 ? "rgb(11, 13, 18)" : "transparent";
	const [r, g, b] = nums.slice(0, 3).map((n) => Math.round(Number(n)));
	if (alpha >= 1) return `rgb(${r}, ${g}, ${b})`;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS variable → xterm theme. Reads the --term-* palette from the *currently
 * applied* stylesheet (the injected theme <link>), so the terminal canvas
 * follows the active theme automatically. Defaults mirror the dark theme.
 * 底色额外乘「整体不透明度」（--window-opacity）：窗口调透明后终端画布也得透，
 * 否则整块终端视图是唯一不跟手的区域（转成 rgba + allowTransparency）。 */
export function buildTermTheme(): Record<string, string> {
	const cs = getComputedStyle(document.documentElement);
	const v = (name: string, fallback: string) => {
		const val = cs.getPropertyValue(name).trim();
		return val || fallback;
	};
	const rawAlpha = cs.getPropertyValue("--window-opacity").trim();
	const alpha = rawAlpha.endsWith("%") ? Number(rawAlpha.slice(0, -1)) / 100 : Number(rawAlpha);
	const bgAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
	return {
		background: termBackground(bgAlpha),
		foreground: v("--term-fg", "#e6e8ef"),
		cursor: v("--term-cursor", "#8b5cf6"),
		cursorAccent: v("--term-cursor-accent", "#0b0d12"),
		selectionBackground: v("--term-selection", "rgba(139, 92, 246, 0.35)"),
		black: v("--term-black", "#1a1d26"),
		red: v("--term-red", "#f87171"),
		green: v("--term-green", "#34d399"),
		yellow: v("--term-yellow", "#fbbf24"),
		blue: v("--term-blue", "#60a5fa"),
		magenta: v("--term-magenta", "#c084fc"),
		cyan: v("--term-cyan", "#22d3ee"),
		white: v("--term-white", "#e6e8ef"),
		brightBlack: v("--term-bright-black", "#6b7284"),
		brightRed: v("--term-bright-red", "#f87171"),
		brightGreen: v("--term-bright-green", "#34d399"),
		brightYellow: v("--term-bright-yellow", "#fbbf24"),
		brightBlue: v("--term-bright-blue", "#60a5fa"),
		brightMagenta: v("--term-bright-magenta", "#c084fc"),
		brightCyan: v("--term-bright-cyan", "#22d3ee"),
		brightWhite: v("--term-bright-white", "#ffffff"),
	};
}
