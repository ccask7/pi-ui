/// <reference lib="dom" />
/** 界面正文字体：本地偏好，即时生效；代码与终端继续使用 --mono。 */
import { useSyncExternalStore } from "react";
import { appUrl } from "./base-url";

export type InterfaceFont = "system" | "sarasa-ui-sc";
export const INTERFACE_FONT_KEY = "ccui:interface-font";

let cached: InterfaceFont | null = null;
const listeners = new Set<() => void>();

export function loadInterfaceFont(): InterfaceFont {
	try {
		return localStorage.getItem(INTERFACE_FONT_KEY) === "sarasa-ui-sc" ? "sarasa-ui-sc" : "system";
	} catch {
		return "system";
	}
}

function snapshot(): InterfaceFont {
	if (cached === null) cached = loadInterfaceFont();
	return cached;
}

/** 字体样式表的 <link> id：只在选中更纱黑体时才注入，避免所有人白付一份 99KB CSS。 */
const LINK_ID = "ccui-interface-font";

function syncFontStylesheet(font: InterfaceFont): void {
	const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;
	if (font !== "sarasa-ui-sc") {
		existing?.remove();
		return;
	}
	if (existing) return;
	const link = document.createElement("link");
	link.id = LINK_ID;
	link.rel = "stylesheet";
	// appUrl：子路径反代（/pi/）下也能取到；CSS 里的 woff2 是相对路径，跟着走。
	link.href = appUrl("/fonts/sarasa-ui-sc/SarasaUiSC-Regular.css");
	document.head.appendChild(link);
}

export function applyInterfaceFont(): void {
	const font = snapshot();
	document.documentElement.dataset.interfaceFont = font;
	syncFontStylesheet(font);
}

export function saveInterfaceFont(value: InterfaceFont): void {
	cached = value === "sarasa-ui-sc" ? "sarasa-ui-sc" : "system";
	try {
		localStorage.setItem(INTERFACE_FONT_KEY, cached);
	} catch {
		/* 本地存储不可用时仍在当前页面生效 */
	}
	applyInterfaceFont();
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useInterfaceFont(): InterfaceFont {
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}
