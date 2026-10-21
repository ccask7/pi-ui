/**
 * desktop preload — 业务全部走 HTTP/WS，不走 IPC，避免和 web/ 现有协议分叉。
 * 仅有的两个 IPC 是壳层欢迎页（welcome.html）的控制面：server 未起之前，
 * 「选目录 / 启动」只能走壳。（上游此处还有 electron-updater 的更新通道，
 * 本 fork 已随自更新功能一起裁掉，见 desktop/main.ts 头部注释。）
 */
import { contextBridge, ipcRenderer } from "electron";

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
});
