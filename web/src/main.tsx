import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LanguageProvider } from "./i18n";
import "./styles.css";
import "highlight.js/styles/github-dark.css";
import { applyTheme, loadTheme, THEME_CHANGE_EVENT } from "./theme";
import { isDesktopShell, syncTitlebarOverlay } from "./desktop";
import { WINDOW_OPACITY_CHANGE_EVENT, applyWindowOpacity } from "./window-opacity";
import { initAuthToken } from "./auth-token";
import { installScrollbarGutterVar } from "./scrollbar-gutter";
import { appBase } from "./base-url";

// 吸收地址栏 ?token=（PI_WEB_TOKEN 鉴权入口）并持久化，须在首次请求前执行
initAuthToken();

// Apply the persisted theme before first render so there's no flash of the
// wrong palette. The full stylesheet swap happens via an injected <link>.
applyTheme(loadTheme());
// 整体不透明度（styles.css 的 --window-opacity）同样要在首帧前到位，
// 否则半透明窗口会先闪一帧实心底色。
applyWindowOpacity();
// 桌面壳（Electron WCO）：顶栏兼任标题栏——挂根 class（styles.css 里有对应的
// 拖拽 / 右侧让位规则），主题切换时同步右上角系统按钮条颜色。浏览器全跳过。
if (isDesktopShell()) {
	document.documentElement.classList.add("desktop-shell");
	window.addEventListener(THEME_CHANGE_EVENT, () => setTimeout(syncTitlebarOverlay, 0));
	// 整体不透明度变化：窗口透明时按钮条要跟着交给系统画（见 desktop.ts），
	// 不透明时颜色又得跟着顶栏重算。
	window.addEventListener(WINDOW_OPACITY_CHANGE_EVENT, () => setTimeout(syncTitlebarOverlay, 0));
	// 初次同步：顶栏渲染与主题 <link> 加载都是异步的，排三次保险（幂等，重复调无副作用）。
	requestAnimationFrame(syncTitlebarOverlay);
	setTimeout(syncTitlebarOverlay, 300);
	setTimeout(syncTitlebarOverlay, 1500);
}
// 首帧前实测滚动条宽（scrollbar-gutter 预留 gutter 的宽度）→ 宽屏消息列与
// 输入列的对齐补偿变量 --msgs-gutter，见 scrollbar-gutter.ts。
installScrollbarGutterVar();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<LanguageProvider>
			<App />
		</LanguageProvider>
	</StrictMode>,
);

// PWA: register the service worker only in production builds so the Vite dev
// server (live reload / HMR) is never intercepted or cached. The scope is
// derived from the page URL (appBase), so sub-path deployments like /pi/ get
// a worker scoped to the app root instead of the site root.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	// Register after load so it never blocks first paint.
	window.addEventListener("load", () => {
		const base = appBase();
		navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((err) => {
			console.warn("Service worker registration failed:", err);
		});
	});
}
