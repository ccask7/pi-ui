/**
 * desktop preload — 业务全部走 HTTP/WS，不走 IPC，避免和 web/ 现有协议分叉。
 * 仅有的两个 IPC 是壳层欢迎页（welcome.html）的控制面：server 未起之前，
 * 「选目录 / 启动」只能走壳。更新使用独立的手动 IPC：渲染进程不能传入
 * 下载地址或执行路径，主进程仅使用固定仓库 Release 中缓存的安装包。
 *
 * 文件名必须是 .cts（tsc 产出 preload.cjs，CommonJS）：sandbox:true 的渲染进程
 * 里 preload 只支持 CJS；仓库 "type": "module" 下的 .js 会被当 ESM，静默加载失败
 * ——表现为页面里 window.piDesktop 是 undefined（主界面一直靠 UA 兜底判断桌面壳，
 * 所以这个坑直到欢迎页第一次真正调 IPC 才暴露）。
 */
import electron = require("electron");

const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld("piDesktop", {
	isDesktop: true as const,
	versions: {
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		node: process.versions.node,
	} as const,
	/** 欢迎页：弹系统目录选择框；取消返回 null。 */
	pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("desktop:pick-directory"),
	/** 欢迎页：用选定目录起 server 并把窗口切到主界面；返回 null=成功，字符串=给用户看的错误。 */
	start: (cwd: string): Promise<string | null> => ipcRenderer.invoke("desktop:start", cwd),
	/** 主题切换后同步标题栏按钮条（WCO）颜色与高度；颜色只收不透明 hex6，高度是顶栏实测像素。 */
	setTitleBarOverlay: (color: string, symbolColor: string, height?: number): Promise<void> =>
		ipcRenderer.invoke("desktop:titlebar-overlay", color, symbolColor, height),
	/** 读「窗口透明」开关的权威值（主进程 window-prefs.json）。 */
	getWindowTransparent: (): Promise<{ transparent: boolean }> => ipcRenderer.invoke("desktop:get-window-transparent"),
	/** 写「窗口透明」开关：主进程会重建窗口（transparent 是构造期选项）。 */
	setWindowTransparent: (on: boolean): Promise<{ transparent: boolean }> =>
		ipcRenderer.invoke("desktop:set-window-transparent", on),
	/** 手动更新：检查与下载是两个独立 IPC，均只由设置页的用户操作触发。 */
	updater: {
		getInfo: (): Promise<{ supported: boolean; currentVersion: string }> => ipcRenderer.invoke("desktop:update-info"),
		check: (): Promise<unknown> => ipcRenderer.invoke("desktop:update-check"),
		download: (): Promise<{ status: "ready" | "cancelled" | "error"; message?: string }> =>
			ipcRenderer.invoke("desktop:update-download"),
		cancel: (): Promise<void> => ipcRenderer.invoke("desktop:update-cancel"),
		install: (): Promise<string | null> => ipcRenderer.invoke("desktop:update-install"),
		onProgress: (listener: (percent: number | null) => void): (() => void) => {
			const handler = (_event: unknown, percent: number | null) => listener(percent);
			ipcRenderer.on("desktop:update-progress", handler);
			return () => ipcRenderer.removeListener("desktop:update-progress", handler);
		},
	},
});
