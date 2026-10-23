/**
 * pi-ccui desktop shell (Electron, sidecar 模式) —— 移植自上游 pi-web-ui 的 desktop/。
 *
 * 设计：不碰 server/ 现有逻辑。主进程用 ELECTRON_RUN_AS_NODE 把
 * Electron 二进制当纯 Node 用，起一个 `dist/server/index.js` 子进程
 * （127.0.0.1 + 随机空闲口），等 /api/health 就绪后 BrowserWindow
 * 直接 load 该地址。前端继续走 appUrl("/ws") + location.host，
 * protocol.ts 零改动——和浏览器访问远端 server 是同一条路。
 *
 * 与上游的差异（fork 决策）：
 *   - 裁掉了 electron-updater 自动更新（本 fork 已删自更新功能，也没有
 *     自己的 release 通道；publish 配置若指向上游 repo 会把 fork 覆盖成上游版本）。
 *   - productName / appId 改为 pi-ccui 系（见 electron-builder.yml）。
 *
 * 运行前先 `npm run build`（需要 dist/server + web/dist）。
 * 开发联调：PI_WEB_DESKTOP_URL=http://localhost:5173 可让窗口指到 vite。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAllowedExternalUrl } from "./external-url.js";

const here = dirname(fileURLToPath(import.meta.url));
/** 开发：dist/desktop → dist/server；打包后：asar 关闭，app 目录即根布局（dist/server + web/dist + themes）。 */
function resolveServerEntry(): string {
	if (app.isPackaged) {
		return join(app.getAppPath(), "dist", "server", "index.js");
	}
	return join(here, "..", "server", "index.js");
}

function resolveWebDir(): string | null {
	// 打包后静态资源由 server 自己从 web/dist 提供（与 npm 包一致），此处仅 dev 兜底检查。
	const devWeb = join(here, "..", "..", "web", "dist", "index.html");
	if (!app.isPackaged && !existsSync(join(here, "..", "server", "index.js"))) {
		console.error("✖ 找不到 dist/server/index.js，请先跑 `npm run build`");
		process.exit(1);
	}
	return devWeb;
}

/** 取一个系统分配的空闲 TCP 口（桌面模式不用固定 8787，避免和网页版冲突）。 */
function pickFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.once("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const addr = s.address();
			s.close(() => {
				if (addr && typeof addr === "object") resolve(addr.port);
				else reject(new Error("pickFreePort: bad address"));
			});
		});
	});
}

/** 该端口现在能不能绑（能绑 = 空闲）。 */
function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const s = createServer();
		s.once("error", () => resolve(false));
		s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
	});
}

/** 首选端口：**必须固定**。窗口 origin 是 http://127.0.0.1:<port>，而 localStorage
 * 按 origin 隔离 —— 每次随机端口意味着主题、面板宽度、面板折叠、不透明度、各种
 * 「记住上次选择」全部在新进程里失踪。端口被占（另一个 ccui 在跑 / 用户自己占了）
 * 才退回随机口，那种情况下界面记忆会重置一次。 */
const PREFERRED_PORT = 34567;

/**
 * 端口：优先 `PI_WEB_PORT`（显式指定），其次固定首选口，最后才随机。
 * `PI_WEB_PORT` 被占用不能硬绑 —— 从 ccui 自己的终端跑 `desktop:dev` 会继承
 * 网页版的 8787，硬用只会让 sidecar 一启动就 EADDRINUSE 崩掉。
 */
async function resolvePort(): Promise<number> {
	const want = Number(process.env.PI_WEB_PORT ?? 0);
	if (want > 0) {
		if (await isPortFree(want)) return want;
		console.warn(`[desktop] PI_WEB_PORT=${want} 已被占用，改用首选/随机空闲口（不影响在跑的那个 server）`);
	}
	if (await isPortFree(PREFERRED_PORT)) return PREFERRED_PORT;
	console.warn(
		`[desktop] 首选端口 ${PREFERRED_PORT} 被占用，本次改用随机空闲口 —— 界面记忆（主题/面板等）会重置一次`,
	);
	return pickFreePort();
}

/** /api/health 轮询：server 就绪后再建窗口，避免白屏。 */
async function waitForHealth(url: string, timeoutMs = 20_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const res = await fetch(`${url}/api/health`);
			if (res.ok) return;
		} catch {
			/* 还没起来 */
		}
		if (Date.now() > deadline) throw new Error(`server 未在 ${timeoutMs}ms 内就绪：${url}`);
		await new Promise((r) => setTimeout(r, 200));
	}
}

let serverProc: ChildProcess | null = null;
let mainWin: BrowserWindow | null = null;
let serverHealthy = false;
let intentionalKill = false; // boot 失败时主动杀 sidecar，不让 exit 监听把 app 带走
/** 应用 origin（loadApp 时确定）；欢迎页阶段为 null。 */
let appOrigin: string | null = null;

console.log("[desktop] main started, waiting for app ready…");

function resolveDataDir(): string {
	return process.env.PI_WEB_DATA_DIR ?? join(app.getPath("userData"), "data");
}

/** 目录仍存在的真实目录才作数（记录里的项目可能已被删/移走）。 */
function isUsableDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/**
 * 从 <dataDir>/client-state.json 恢复上次项目（VS Code 的 restoreWindows 思路）：
 * 合并所有 client 的 projects，按 lastUsed 倒序，跳过用户从最近列表移除的
 * （removedProjects 墓碑）、已不存在的目录、以及用户主目录——home 只是
 * 取消选择框后的临时兜底，不算「上次项目」，否则取消一次就永远 sticky。
 * 只读不写——写入仍归 server 管（UI 里 set_cwd 时它更新同一份文件，闭环）。
 * 文件不存在/损坏一律回退 null，绝不让启动挂在这。
 */
function readLastProject(dataDir: string): string | null {
	try {
		const raw = readFileSync(join(dataDir, "client-state.json"), "utf8");
		const all = JSON.parse(raw) as Record<
			string,
			{ projects?: { path: string; lastUsed: number }[]; removedProjects?: string[] }
		>;
		const removed = new Set<string>();
		const candidates: { path: string; lastUsed: number }[] = [];
		for (const state of Object.values(all)) {
			if (!state || typeof state !== "object") continue;
			for (const r of state.removedProjects ?? []) removed.add(r);
			for (const p of state.projects ?? []) {
				if (typeof p?.path === "string" && typeof p?.lastUsed === "number") candidates.push(p);
			}
		}
		candidates.sort((a, b) => b.lastUsed - a.lastUsed);
		const home = resolve(homedir()).toLowerCase();
		for (const c of candidates) {
			if (resolve(c.path).toLowerCase() === home) continue; // 主目录不作恢复目标
			if (removed.has(c.path)) continue;
			if (isUsableDir(c.path)) return c.path;
			console.warn(`[desktop] 上次项目已不存在，跳过：${c.path}`);
		}
	} catch {
		/* 没有记录/读失败：当首次启动处理 */
	}
	return null;
}

/**
 * 启动 cwd 的优先级：PI_WEB_CWD 显式指定 > client-state.json 里最近用过的项目。
 * 都没有（首次启动/记录全失效）→ 返回 null：由欢迎页（welcome.html）接管，
 * 用户在应用内选好目录后才起 server——不再弹启动期系统对话框，也不再回退 home
 * （home 一旦当选就会被 server 写回「最近项目」永远 sticky，且工作区太大不安全）。
 */
function resolveStartupCwd(dataDir: string): string | null {
	const explicit = process.env.PI_WEB_CWD;
	if (explicit) return explicit;
	const last = readLastProject(dataDir);
	if (last) console.log(`[desktop] 恢复上次项目：${last}`);
	return last;
}

async function startServerSidecar(cwd: string): Promise<string> {
	const entry = resolveServerEntry();
	resolveWebDir();
	console.log(`[desktop] server entry: ${entry}`);
	const port = await resolvePort();
	const dataDir = resolveDataDir();
	console.log(`[desktop] spawning server on 127.0.0.1:${port} (data: ${dataDir}, cwd: ${cwd})`);
	// ELECTRON_RUN_AS_NODE=1：让 Electron 二进制退化成纯 Node 跑 server，
	// 无需额外捆一个 node，也不用改 server/index.ts。
	// --import：可选的「优先用全局 pi SDK」钩子（默认关；见 server/resolve-global-sdk.ts）。
	// dist 可能是旧构建（没这个文件）—— 只有存在才注入，别让桌面版起不来。
	// 桌面版通常没有祖先 node_modules，所以它实际上总是回落自带那份。
	// Windows 坑：--import 的绝对路径必须转成 file:// URL，否则 ESM loader 把
	// 盘符当协议（ERR_UNSUPPORTED_ESM_URL_SCHEME, protocol 'd:'），server 起不来。
	const sdkHook = join(dirname(entry), "resolve-global-sdk.js");
	serverProc = spawn(
		process.execPath,
		[
			...(existsSync(sdkHook) ? ["--import", pathToFileURL(sdkHook).href] : []),
			entry,
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
		],
		{
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				PI_WEB_HOST: "127.0.0.1",
				PI_WEB_PORT: String(port),
				PI_WEB_CWD: cwd,
				PI_WEB_DATA_DIR: dataDir,
			},
			stdio: "inherit",
			windowsHide: true,
		},
	);
	serverProc.on("error", (err) => {
		console.error(`[desktop] server spawn 失败：${err.message}`);
		if (!serverHealthy && !intentionalKill) app.quit();
	});
	serverProc.on("exit", (code, signal) => {
		console.error(`[desktop] server 提前退出（code=${code} signal=${signal}），请看上方 server 日志`);
		if (!serverHealthy && !intentionalKill) app.quit();
	});
	const url = `http://127.0.0.1:${port}`;
	await waitForHealth(url);
	serverHealthy = true;
	console.log(`[desktop] server 就绪：${url}`);
	return url;
}

async function createWindow(): Promise<void> {
	mainWin = new BrowserWindow({
		width: 1280,
		height: 860,
		autoHideMenuBar: true,
		// WCO（VS Code 同款）：系统只留右上角 min/max/close 覆盖条，标题栏交给网页
		// （顶栏 CSS app-region: drag，见 styles.css 的 html.desktop-shell 段）。
		// 初始配色对 welcome.html 的深色底；进主界面后由 syncTitlebarOverlay 跟随主题。
		// 高度先给个默认值（welcome.html 阶段顶栏还没渲染），进主界面后
		// syncTitlebarOverlay 会把实测的顶栏高度传进来（当前 35 = 控件 26 + 上下 4 + 边框 1）。
		titleBarStyle: "hidden",
		titleBarOverlay: { color: "#1a1b1e", symbolColor: "#e4e4e7", height: 35 },
		webPreferences: {
			preload: join(here, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	// 外链丢给系统浏览器，别在应用窗口里导航走。
	mainWin.webContents.setWindowOpenHandler(({ url: u }) => {
		if (!isAllowedExternalUrl(u)) {
			console.warn(`[desktop] 已拦截非 allowlist 外链（新窗口）：${u}`);
			return { action: "deny" };
		}
		void shell.openExternal(u);
		return { action: "deny" };
	});
	// 同帧导航守卫：setWindowOpenHandler 只拦新窗口请求（window.open /
	// target="_blank"），而对话正文里的裸 href 与 JS 主动跳转（location.href/assign）
	// 走的是同帧导航 —— 默认会被允许，直接把应用窗口带走（无地址栏、无后退键，只能重启）。
	// 应用自身 origin（重载/前端路由）放行，其余一律转系统浏览器。
	mainWin.webContents.on("will-navigate", (e, target) => {
		let u: URL;
		try {
			u = new URL(target);
		} catch {
			return; // 非法 URL：交给 Electron 处理
		}
		if (appOrigin && u.origin === appOrigin) return; // 应用自身 origin（重载/前端路由）放行
		if (u.protocol === "file:") return; // 欢迎页（本地 file://）
		e.preventDefault();
		if (!isAllowedExternalUrl(target)) {
			console.warn(`[desktop] 已拦截非 allowlist 外链（同帧导航）：${target}`);
			return;
		}
		console.log(`[desktop] will-navigate 拦截，已用系统浏览器打开：${target}`);
		void shell.openExternal(target);
	});
	mainWin.on("closed", () => {
		mainWin = null;
	});
}

/** 把窗口切到真 UI（确定 appOrigin，供导航守卫放行应用内跳转）。 */
async function loadApp(url: string): Promise<void> {
	if (!mainWin) throw new Error("窗口已关闭");
	appOrigin = new URL(url).origin;
	console.log(`[desktop] opening window: ${url}`);
	await mainWin.loadURL(url);
}

/** 起 server 并把窗口切到真 UI；失败时清掉半拉的 sidecar，让欢迎页可以重试。 */
async function boot(cwd: string): Promise<void> {
	try {
		const url = await startServerSidecar(cwd);
		await loadApp(url);
	} catch (err) {
		if (!serverHealthy && serverProc) {
			intentionalKill = true;
			serverProc.kill();
			serverProc = null;
		}
		throw err;
	}
}

// 欢迎页 IPC（窗口先行模式下 server 还没起，这是壳层唯一的控制面）。
// defaultPath 必须显式传：Electron 43+ 不传会强制落 Downloads/Home，
// 覆盖系统对话框自己记忆的最近目录（electron#52454）。
ipcMain.handle("desktop:pick-directory", async () => {
	if (!mainWin) return null;
	const r = await dialog.showOpenDialog(mainWin, {
		title: "选择项目目录",
		defaultPath: homedir(),
		properties: ["openDirectory", "createDirectory"],
	});
	return r.canceled ? null : (r.filePaths[0] ?? null);
});

// 主题切换后同步 WCO 按钮条（颜色只收不透明 hex6，overlay 不吃 alpha；高度由渲染端
// 实测顶栏盒子得出，CSS 改高度自动跟上）。高度缺省/非法时沿用当前值。
let lastOverlay = "";
ipcMain.handle("desktop:titlebar-overlay", (_e, color: unknown, symbolColor: unknown, height: unknown) => {
	if (typeof color !== "string" || typeof symbolColor !== "string") return;
	if (!/^#[0-9a-fA-F]{6}$/.test(color) || !/^#[0-9a-fA-F]{6}$/.test(symbolColor)) return;
	const h =
		typeof height === "number" && Number.isFinite(height) && height >= 20 && height <= 120
			? Math.round(height)
			: undefined;
	const key = `${color}/${symbolColor}/${h ?? ""}`;
	if (key === lastOverlay) return; // 初次会排三次重试，同样的值不必重复设
	lastOverlay = key;
	console.log(`[desktop] 标题栏按钮条：${color} / ${symbolColor} / ${h ?? "高度不变"}px`);
	mainWin?.setTitleBarOverlay({ color, symbolColor, ...(h ? { height: h } : {}) });
});

// 返回 null = 成功（窗口已切到真 UI）；返回字符串 = 给用户看的错误。
ipcMain.handle("desktop:start", async (_e, cwd: unknown) => {
	if (typeof cwd !== "string" || !isUsableDir(cwd)) return "目录无效或不存在";
	if (serverProc) return "server 已在运行";
	try {
		await boot(cwd);
		return null;
	} catch (err) {
		return (err as Error).message;
	}
});

// 单实例：第二个实例聚焦已有窗口（和网页版多标签页各走独立 clientId 不冲突）。
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (mainWin) {
			if (mainWin.isMinimized()) mainWin.restore();
			mainWin.focus();
		}
	});
}

// ⚠️ 绝对不要在 ESM 主进程顶层 `await app.whenReady()`（Electron 44 实测死锁）：
// Electron 要等入口模块求值完成才发 ready 事件，顶层 await ready = 互相死等——
// 进程挂在 "waiting for app ready…"，窗口永远不开（改成 .then 回调里 await 即可）。
void app.whenReady().then(async () => {
	console.log("[desktop] app ready");
	try {
		await createWindow();
		// dev 联调：指向已跑起来的 vite(:5173)，前提是另起 dev:server
		const override = process.env.PI_WEB_DESKTOP_URL;
		if (override) {
			await loadApp(override);
			return;
		}
		const cwd = resolveStartupCwd(resolveDataDir());
		if (cwd) {
			await boot(cwd);
			return;
		}
		// 新用户/无历史项目：不急着起 server，欢迎页里选好目录再起
		console.log("[desktop] 无历史项目，显示欢迎页（server 待选择项目目录后启动）");
		await mainWin!.loadFile(join(here, "welcome.html"));
	} catch (err) {
		console.error("✖ 桌面版启动失败：", err);
		app.quit();
	}
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	// macOS 点 dock 时窗口已关：server sidecar 还在，本骨架暂不重建窗口，退出重进即可。
	if (BrowserWindow.getAllWindows().length === 0) app.quit();
});
app.on("will-quit", () => {
	serverProc?.kill();
	serverProc = null;
});
