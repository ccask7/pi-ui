/**
 * desktop preload — 业务全部走 HTTP/WS，不走 IPC，避免和 web/ 现有协议分叉。
 * 仅有的两个 IPC 是壳层欢迎页（welcome.html）的控制面：server 未起之前，
 * 「选目录 / 启动」只能走壳。（上游此处还有 electron-updater 的更新通道，
 * 本 fork 已随自更新功能一起裁掉，见 desktop/main.ts 头部注释。）
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
	getWindowTransparent: (): Promise<{ transparent: boolean }> =>
		ipcRenderer.invoke("desktop:get-window-transparent"),
	/** 写「窗口透明」开关：主进程会重建窗口（transparent 是构造期选项）。 */
	setWindowTransparent: (on: boolean): Promise<{ transparent: boolean }> =>
		ipcRenderer.invoke("desktop:set-window-transparent", on),
});
