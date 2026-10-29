#!/usr/bin/env node
/**
 * Regenerates the built-in themes as PURE PALETTE files (since the 布局与主题
 * 解耦 refactor):
 *
 *   themes/vs-code-dark.css  — VS Code 黑（深色）
 *   themes/vs-code-light.css — VS Code 白（浅色）
 *
 * THEMING MODEL: web/src/styles.css is the SINGLE layout file — it defines the
 * whole UI layout plus the default (dark) palette as :root CSS variables
 * (including the derived color vars like --tooltip-bg/--code-bg/--notice-*).
 * A theme is just a :root override of those variables — NO layout code ships
 * in theme files anymore, so layout changes never need to touch themes.
 *
 * The frontend (web/src/theme.ts applyTheme) injects <link>/themes/<id>.css
 * AFTER the bundled styles.css, so its :root variables win the cascade.
 *
 * Run whenever styles.css or a palette changes:
 *
 *   node make-light-theme.mjs
 *
 * User themes (<dataDir>/themes/<id>.css) follow the same model: just write
 * :root { ...vars... } (or drop a full standalone stylesheet if you must).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = join(here, "web", "src", "styles.css");

const css = readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n");

// --- 1) parse the :root variable list (name → default value) from styles.css
// A theme only overrides the entries it wants; the generator emits the FULL
// list so styles.css adding a new variable automatically flows into every
// builtin theme (default value), keeping them in sync forever.
const rootBlock = css.match(/:root \{[^}]*\}/);
if (!rootBlock) throw new Error("make-light-theme: :root block not found in styles.css");
const defaults = new Map();
for (const line of rootBlock[0].split("\n")) {
	const m = line.match(/^\s*(--[a-z0-9-]+):\s*(.*?);\s*$/);
	if (m) defaults.set(m[1], m[2]);
}

/** Emit a theme file: full :root (defaults + overrides) + optional tail. */
const emitTheme = (name, overrides = {}, tail = "", nameEn = "", group = "") => {
	const lines = ["/* theme-name: " + name + " */"];
	if (nameEn) lines.push("/* theme-name-en: " + nameEn + " */");
	if (group) lines.push("/* theme-group: " + group + " */");
	lines.push(":root {");
	// color-scheme: themes default to light unless told otherwise.
	lines.push("\tcolor-scheme: " + (overrides["color-scheme"] ?? "light") + ";");
	for (const [k, v] of defaults) {
		lines.push(`\t${k}: ${overrides[k] ?? v};`);
	}
	lines.push("}", "");
	return lines.join("\n") + tail;
};

const writeTheme = (name, file, body) => writeFileSync(join(here, "themes", file), body, "utf8");

// --- 2) palettes -----------------------------------------------------------
// 只列与默认深色不同的变量；emitTheme 会用 styles.css 的 :root 默认值补全。
// Workbench 色值对齐微软官方 Dark Modern / Light Modern：
// extensions/theme-defaults/themes/{dark,light}_modern.json（microsoft/vscode）。
const VSCODE_DARK = {
	"color-scheme": "dark",
	"--bg": "#1f1f1f",
	"--bg-elev": "#181818",
	"--bg-elev2": "#2b2b2b",
	"--border": "#2b2b2b",
	"--border-soft": "#232323",
	"--text": "#cccccc",
	"--text-dim": "#9d9d9d",
	"--text-faint": "#7a7a7a",
	"--accent": "#0078d4",
	"--accent-soft": "rgba(0, 120, 212, 0.18)",
	"--green": "#2ea043",
	"--green-soft": "rgba(46, 160, 67, 0.15)",
	"--red": "#f85149",
	"--red-soft": "rgba(248, 81, 73, 0.15)",
	"--amber": "#cca700",
	"--blue": "#569cd6",
	"--blue-soft": "rgba(86, 156, 214, 0.14)",
	"--term-bg": "#1f1f1f",
	"--term-fg": "#cccccc",
	"--term-cursor": "#aeafad",
	"--term-cursor-accent": "#1f1f1f",
	"--term-selection": "rgba(38, 79, 120, 0.6)",
	"--term-black": "#000000",
	"--term-red": "#cd3131",
	"--term-green": "#0dbc79",
	"--term-yellow": "#e5e510",
	"--term-blue": "#2472c8",
	"--term-magenta": "#bc3fbc",
	"--term-cyan": "#11a8cd",
	"--term-white": "#e5e5e5",
	"--term-bright-black": "#666666",
	"--term-bright-red": "#f14c4c",
	"--term-bright-green": "#23d18b",
	"--term-bright-yellow": "#f5f543",
	"--term-bright-blue": "#3b8eea",
	"--term-bright-magenta": "#d670d6",
	"--term-bright-cyan": "#29b8db",
	"--term-bright-white": "#e5e5e5",
	"--tooltip-bg": "#202020",
	"--code-bg": "#2b2b2b",
	"--code-text": "#d0d0d0",
	"--err-text": "#f85149",
	"--red-text": "#f85149",
	"--amber-text": "#cca700",
	"--info-blue": "#4daafc",
	"--link": "#4daafc",
	"--link-hover": "#6cb6ff",
	"--link-soft": "#4daafc",
	"--md-strong": "#ffffff",
	"--skill-blue": "#569cd6",
	"--plugin-purple": "#c586c0",
	"--auth-green": "#2ea043",
	"--scroll-thumb": "#4a4a4a",
	"--scroll-thumb-hover": "#6b6b6b",
	"--notice-err-bg": "#3a1e20",
	"--notice-warn-bg": "#37301a",
	"--notice-info-bg": "#16293f",
	"--notice-err-border": "#f85149",
	"--notice-warn-border": "#cca700",
	"--notice-info-border": "#0078d4",
	"--send-blue": "#0078d4",
	"--send-blue-hover": "#026ec1",
	"--stop-red": "#f85149",
	"--stop-red-hover": "#e03c34",
	"--brand-grad-a": "#0078d4",
	"--brand-grad-b": "#4daafc",
	"--on-amber": "#1f1f1f",
	"--search-active-fg": "#1f1f1f",
	"--control-fg": "#cccccc",
	"--control-bg": "#2b2b2b",
	"--control-border": "#3c3c3c",
	"--wallpaper-panel-alpha": "100%",
	"--topbar-bg": "color-mix(in srgb, #181818 var(--window-opacity, 100%), transparent)",
	"--statusbar-bg": "color-mix(in srgb, #181818 var(--window-opacity, 100%), transparent)",
	"--panel-bg": "color-mix(in srgb, #181818 var(--window-opacity, 100%), transparent)",
	"--card-bg": "color-mix(in srgb, #202020 var(--window-opacity, 100%), transparent)",
	"--chip-bg": "color-mix(in srgb, #2b2b2b var(--window-opacity, 100%), transparent)",
	"--msgs-bg": "color-mix(in srgb, #1f1f1f var(--window-opacity, 100%), transparent)",
	"--inputbox-bg": "color-mix(in srgb, #313131 var(--window-opacity, 100%), transparent)",
	"--input-border": "#3c3c3c",
	"--chat-tabs-bg": "#181818",
	"--chat-tab-bg": "#181818",
	"--chat-tab-active-bg": "#1f1f1f",
	"--chat-tab-hover-bg": "#1f1f1f",
	"--menu-bg": "#1f1f1f",
};

const hljsVSCodeDark = `
/* ---- syntax highlighting (VS Code Dark+) ---- */
.hljs {
	color: #cccccc;
	background: #2b2b2b;
}
.hljs-doctag,
.hljs-keyword,
.hljs-meta .hljs-keyword,
.hljs-template-tag,
.hljs-template-variable,
.hljs-variable.language_ {
	color: #569cd6;
}
.hljs-title,
.hljs-title.function_ {
	color: #dcdcaa;
}
.hljs-title.class_,
.hljs-title.class_.inherited__,
.hljs-built_in,
.hljs-symbol,
.hljs-type {
	color: #4ec9b0;
}
.hljs-attr,
.hljs-attribute,
.hljs-variable,
.hljs-selector-attr,
.hljs-selector-class,
.hljs-selector-id {
	color: #9cdcfe;
}
.hljs-literal {
	color: #569cd6;
}
.hljs-number {
	color: #b5cea8;
}
.hljs-string,
.hljs-regexp,
.hljs-meta .hljs-string {
	color: #ce9178;
}
.hljs-comment,
.hljs-code,
.hljs-formula,
.hljs-quote {
	color: #6a9955;
}
.hljs-name,
.hljs-selector-tag,
.hljs-section {
	color: #569cd6;
}
.hljs-meta {
	color: #569cd6;
}
.hljs-bullet {
	color: #6796e6;
}
.hljs-subst,
.hljs-operator,
.hljs-punctuation {
	color: #d4d4d4;
}
.hljs-emphasis {
	color: #c586c0;
	font-style: italic;
}
.hljs-strong {
	color: #569cd6;
	font-weight: 700;
}
.hljs-addition {
	color: #b5cea8;
	background: rgba(46, 160, 67, 0.15);
}
.hljs-deletion {
	color: #ce9178;
	background: rgba(248, 81, 73, 0.15);
}
`;

// --- VS Code 白（Light Modern：编辑器 #FFFFFF / 铬件 #F8F8F8 / 强调蓝 #005FB8）-
// 只抄 VS Code 默认浅色主题的实际取色：编辑器纯白、侧栏/标题栏/状态栏 #F8F8F8、
// 边框 #E5E5E5、输入框 #FFFFFF、链接 #005FB8、错误 #CD3131。
const VSCODE_LIGHT = {
	"color-scheme": "light",
	"--bg": "#ffffff",
	"--bg-elev": "#f8f8f8",
	"--bg-elev2": "#f2f2f2",
	"--border": "#e5e5e5",
	"--border-soft": "#e5e5e5",
	"--text": "#3b3b3b",
	"--text-dim": "#616161",
	"--text-faint": "#767676",
	"--accent": "#005fb8",
	"--accent-soft": "rgba(0, 95, 184, 0.12)",
	"--green": "#2ea043",
	"--green-soft": "rgba(46, 160, 67, 0.12)",
	"--red": "#f85149",
	"--red-soft": "rgba(248, 81, 73, 0.1)",
	"--amber": "#bf8803",
	"--blue": "#0451a5",
	"--blue-soft": "rgba(4, 81, 165, 0.12)",
	"--term-bg": "#ffffff",
	"--term-fg": "#3b3b3b",
	"--term-cursor": "#005fb8",
	"--term-cursor-accent": "#ffffff",
	"--term-selection": "rgba(173, 214, 255, 0.6)",
	"--term-black": "#000000",
	"--term-red": "#cd3131",
	"--term-green": "#00bc00",
	"--term-yellow": "#949800",
	"--term-blue": "#0451a5",
	"--term-magenta": "#bc05bc",
	"--term-cyan": "#0598bc",
	"--term-white": "#555555",
	"--term-bright-black": "#666666",
	"--term-bright-red": "#cd3131",
	"--term-bright-green": "#14ce14",
	"--term-bright-yellow": "#b5ba00",
	"--term-bright-blue": "#0451a5",
	"--term-bright-magenta": "#bc05bc",
	"--term-bright-cyan": "#0598bc",
	"--term-bright-white": "#a5a5a5",
	"--tooltip-bg": "#f8f8f8",
	"--code-bg": "#f8f8f8",
	"--code-text": "#3b3b3b",
	"--err-text": "#f85149",
	"--red-text": "#f85149",
	"--amber-text": "#bf8803",
	"--info-blue": "#005fb8",
	"--link": "#005fb8",
	"--link-hover": "#0258a8",
	"--link-soft": "#005fb8",
	"--md-strong": "#1f1f1f",
	"--skill-blue": "#005fb8",
	"--plugin-purple": "#af00db",
	"--auth-green": "#2ea043",
	"--scroll-thumb": "#c9c9c9",
	"--scroll-thumb-hover": "#a8a8a8",
	"--notice-err-bg": "#fbeaea",
	"--notice-warn-bg": "#faf3df",
	"--notice-info-bg": "#e9f1fb",
	"--notice-err-border": "#cd3131",
	"--notice-warn-border": "#bf8803",
	"--notice-info-border": "#005fb8",
	"--send-blue": "#005fb8",
	"--send-blue-hover": "#0258a8",
	"--stop-red": "#cd3131",
	"--stop-red-hover": "#b02626",
	"--brand-grad-a": "#0078d4",
	"--brand-grad-b": "#005fb8",
	"--on-amber": "#1f1f1f",
	"--search-active-fg": "#1f1f1f",
	"--bg-elev3": "rgba(0, 0, 0, 0.02)",
	"--sunken-bg": "rgba(0, 0, 0, 0.03)",
	"--glow-015": "rgba(0, 0, 0, 0.02)",
	"--glow-025": "rgba(0, 0, 0, 0.02)",
	"--glow-03": "rgba(0, 0, 0, 0.02)",
	"--glow-04": "rgba(0, 0, 0, 0.03)",
	"--glow-05": "rgba(0, 0, 0, 0.03)",
	"--glow-12": "rgba(0, 0, 0, 0.08)",
	"--glow-18": "rgba(0, 0, 0, 0.12)",
	"--glow-22": "rgba(0, 0, 0, 0.15)",
	"--glow-38": "rgba(0, 0, 0, 0.25)",
	"--control-fg": "#3b3b3b",
	"--control-bg": "#f8f8f8",
	"--control-border": "#cecece",
	"--wallpaper-panel-alpha": "100%",
	"--topbar-bg": "color-mix(in srgb, #f8f8f8 var(--window-opacity, 100%), transparent)",
	"--statusbar-bg": "color-mix(in srgb, #f8f8f8 var(--window-opacity, 100%), transparent)",
	"--panel-bg": "color-mix(in srgb, #f8f8f8 var(--window-opacity, 100%), transparent)",
	"--card-bg": "color-mix(in srgb, #f8f8f8 var(--window-opacity, 100%), transparent)",
	"--chip-bg": "color-mix(in srgb, #f2f2f2 var(--window-opacity, 100%), transparent)",
	"--msgs-bg": "color-mix(in srgb, #ffffff var(--window-opacity, 100%), transparent)",
	"--inputbox-bg": "color-mix(in srgb, #ffffff var(--window-opacity, 100%), transparent)",
	"--input-border": "#cecece",
	"--chat-tabs-bg": "#f8f8f8",
	"--chat-tab-bg": "#f8f8f8",
	"--chat-tab-active-bg": "#ffffff",
	"--chat-tab-hover-bg": "#ffffff",
	"--menu-bg": "#ffffff",
};

const hljsVSCodeLight = `
/* ---- syntax highlighting (VS Code Light+) ---- */
.hljs {
	color: #3b3b3b;
	background: #f8f8f8;
}
.hljs-doctag,
.hljs-keyword,
.hljs-meta .hljs-keyword,
.hljs-template-tag,
.hljs-template-variable,
.hljs-variable.language_ {
	color: #0000ff;
}
.hljs-title,
.hljs-title.function_ {
	color: #795e26;
}
.hljs-title.class_,
.hljs-title.class_.inherited__,
.hljs-built_in,
.hljs-symbol,
.hljs-type {
	color: #267f99;
}
.hljs-attr,
.hljs-attribute,
.hljs-variable,
.hljs-selector-attr,
.hljs-selector-id {
	color: #001080;
}
.hljs-literal {
	color: #0000ff;
}
.hljs-number {
	color: #098658;
}
.hljs-string,
.hljs-regexp,
.hljs-meta .hljs-string {
	color: #a31515;
}
.hljs-comment,
.hljs-code,
.hljs-formula,
.hljs-quote {
	color: #008000;
}
.hljs-name,
.hljs-selector-tag,
.hljs-selector-class,
.hljs-section {
	color: #800000;
}
.hljs-meta {
	color: #0451a5;
}
.hljs-bullet {
	color: #0451a5;
}
.hljs-subst,
.hljs-operator,
.hljs-punctuation {
	color: #000000;
}
.hljs-emphasis {
	color: #800080;
	font-style: italic;
}
.hljs-strong {
	color: #000080;
	font-weight: 700;
}
.hljs-addition {
	color: #098658;
	background: #e7f5ea;
}
.hljs-deletion {
	color: #a31515;
	background: #fbe9e9;
}
`;

// --- 3) emit ----------------------------------------------------------------
// 只保留 VS Code 黑/白（其余内置主题已删除；用户主题仍可从数据目录加载）
writeTheme(
	"VS Code 黑",
	"vs-code-dark.css",
	emitTheme("VS Code 黑", VSCODE_DARK, hljsVSCodeDark, "VS Code Dark", "classic"),
);
writeTheme(
	"VS Code 白",
	"vs-code-light.css",
	emitTheme("VS Code 白", VSCODE_LIGHT, hljsVSCodeLight, "VS Code Light", "classic"),
);

console.log("themes regenerated: vs-code-dark / vs-code-light");
