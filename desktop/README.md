# 桌面版（Electron sidecar）

移植自上游 pi-web-ui 的 `desktop/`，网页版零改动。桌面壳只是"本地 server + 本地窗口"的组合：

```
Electron 主进程 (desktop/main.ts)
  └─ spawn(ELECTRON_RUN_AS_NODE) → node dist/server/index.js --host 127.0.0.1 --port <随机>
  └─ BrowserWindow → http://127.0.0.1:<随机>/
```

前端继续走 `appUrl("/ws")` + `location.host`，`server/protocol.ts` 不动。

## 与上游的差异（本 fork）

- **裁掉了 electron-updater 自动更新**：本 fork 已删自更新功能，也没有自己的 release 通道
  （`electron-builder.yml` 不设 `publish`——指向上游 repo 会把 fork 覆盖成上游版本）。
  preload 暴露 `window.piDesktop = { isDesktop, versions, pickDirectory, start }`
  ——后两个是欢迎页（welcome.html）的 IPC 控制面，server 未起之前选目录/启动只能走壳。
  注意 preload 必须是 CJS（源码为 `preload.cts`）：sandbox 渲染进程不载 ESM preload，
  静默失败表现为 `window.piDesktop` undefined。
- 只出 Windows NSIS 包（mac/linux target 已删，需要时参照上游 yml 加回）。
- 修了一个 Windows 坑：sidecar 的 `--import <sdkHook>` 必须传 `file://` URL
  （`pathToFileURL`），否则盘符被 ESM loader 当协议，server 起不来。

## 跑起来

```bash
npm ci                   # 拉 electron + electron-builder（devDeps）
npm run build            # 先产出 dist/server + web/dist（桌面壳直接复用）
npm run desktop:dev      # Electron 指到本地 sidecar（http://127.0.0.1:<随机>）
# 联调前端：另开 npm run dev:server(:8788) + vite(:5173)，再
PI_WEB_DESKTOP_URL=http://localhost:5173 npm run desktop:dev
npm run desktop:dist     # 本地打包（产物在 release/，已 gitignore）
```

国内网络提示：Electron / NSIS 二进制默认从 GitHub 下载，失败时设镜像再跑：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
  npm run desktop:dist
# Electron 二进制本身装不上时：ELECTRON_MIRROR=... node node_modules/electron/install.js
```

## 约定

- 端口：随机空闲口，不抢 `8787`，可与网页版并存。`PI_WEB_PORT` 显式指定时优先，
  但**已占用就退回随机口**（从 ccui 自己的终端里跑 `desktop:dev` 会继承它的 `PI_WEB_PORT`）。
- 图标：复用网页版的 `web/public/icons/icon-1024.png`，electron-builder 自己转 `.ico`，
  换图标只改这一处（网页版 PWA 图标同步变）。
- 数据：`PI_WEB_DATA_DIR` 默认 `<userData>/data`（Windows 上 `%APPDATA%/ccui/data`），
  和 `~/.pi-web` 隔离。
- 启动工作区（cwd）按优先级：`PI_WEB_CWD` 显式指定 → 恢复上次项目（读
  `<dataDir>/client-state.json` 里所有 client 的 projects，按 lastUsed 取最新、
  跳过已删除目录、墓碑、以及用户主目录——home 不作恢复目标，否则取消一次选择
  它就作为「上次项目」被 server 写回，永远 sticky）→ 都没有（新用户/记录全失效）
  就开**欢迎页**：窗口先开、`welcome.html`（壳层 file:// 页面）接管，此时 server
  还没起；用户点「选择项目目录」→ `desktop:pick-directory` IPC 弹系统框 →
  `desktop:start` IPC 才 spawn server（cwd=所选目录）→ 窗口切到真 UI。
  全程无启动期系统对话框、不回退 home；boot 失败清掉半拉 sidecar 可重试。
  UI 里切项目会写回同一份 client-state.json，下次启动自动恢复——闭环。
  选择框必须显式传 `defaultPath`：Electron 43+ 不传会强制落 Downloads/Home（electron#52454）。
- 欢迎页资源：tsc 不搬 HTML，`build:desktop` 末尾把 `desktop/*.html` 拷进
  `dist/desktop/`（electron-builder 的 files 只认 dist/desktop）。
- **标题栏（WCO，VS Code 同款）**：窗口用 `titleBarStyle: "hidden"` +
  `titleBarOverlay`，系统只留右上角 min/max/close 覆盖条（原生行为——双击最大化、
  Win11 贴靠悬停、边缘缩放——全保留），其余标题栏区域是网页：
  - `web/src/main.tsx` 在 `isDesktopShell()` 时给 `<html>` 挂 `desktop-shell`，
    `styles.css` 末尾的规则让顶栏 `-webkit-app-region: drag`（交互元素 no-drag、
    `.tb-spacer` 仍可拖）、`padding-right: calc(16px + 100% - env(titlebar-area-width))`
    给按钮条让位。浏览器没有这个 class，网页版零影响。
  - overlay 颜色由 `web/src/desktop.ts#syncTitlebarOverlay()` 算：`.topbar` 叠 `body`
    逐层合成（两者常是半透明，壁纸主题尤甚）→ hex6 + 按亮度选深浅符号色，
    经 `desktop:titlebar-overlay` IPC 下发（主进程 `setTitleBarOverlay`）。
    主题切换（`ccui:theme-change`）与初次进主界面时都调，所以**浅色主题下按钮条跟着变浅**。
  - overlay 高度不再是写死值：`syncTitlebarOverlay()` 用 `getBoundingClientRect()` 实测
    `.topbar` 高（当前 35 = 控件 26 + 上下 padding 4 + 边框 1，对齐 VS Code 的 35px）一并下发，主进程校验
    20~120px 后 `setTitleBarOverlay`。所以改顶栏 padding / `--topbar-ctl-h` 时**不用**再动
    `main.ts`（只有 welcome.html 阶段的默认高度还留着 35，仅作初值）。
  - 坑：颜色解析要兼容 `color(srgb 0.07 0.08 0.11 / 0.6)` 这类回读格式（分量 0~1 浮点，
    不是 0~255）；不透明窗口下 overlay **不能**吃 alpha，必须合成成不透明色 ——
    例外见下面的「窗口透明」：那时反过来要主动发 `#00000000`。
- **窗口透明（整体不透明度）**：对齐 Windows Terminal 的 `opacity`。
  窗口用 `transparent: true` + `backgroundColor: "#00000000"`，页面用 CSS 变量
  `--window-opacity`（设置 → 界面设置 → 整体不透明度，缺省 100% = 实心）决定自己画多实：
  `body` 底色 = `color-mix(in srgb, var(--bg) var(--window-opacity), transparent)`，
  壁纸层 `body.has-wallpaper::before { opacity: var(--window-opacity) }`（图跟着透），
  终端容器与 xterm 主题底色同乘（`buildTermTheme` 解析成 `rgba()`，xterm 不认
  `color-mix()`/`var()`）。`html` 必须 `background: transparent`，否则最外层照样挡桌面。
  - `transparent` 是 BrowserWindow **构造期**选项，运行中翻不了 → 开关持久化在
    `%APPDATA%/ccui/window-prefs.json`（主进程读写），设置里的「窗口透明」关掉后
    **重建窗口**立即生效（沿用 bounds，server sidecar 与 origin 不动，页面重载一次）。
    缺省开：不透明度 100% 时观感与普通窗口一致，拖滑杆才有区别。
  - 透明时 `syncTitlebarOverlay()` 改发 `#00000000`（主进程颜色校验接受 hex8），
    按钮条跟着页面透出桌面；不透明时仍按 `.topbar`+`body` 合成 hex6。
  - 已知限制：Windows 10 没有 Mica/Acrylic（`backgroundMaterial` 仅 Win11），所以是
    纯 alpha 不模糊；无边框透明窗口拖拽缩放可能有轻微抖动 —— 卡就关掉「窗口透明」。
- 单实例锁：`requestSingleInstanceLock()`。
- 安全：`contextIsolation + sandbox`，renderer 无 node，外链经 scheme allowlist
  （`external-url.ts`）走系统浏览器；同帧导航（`will-navigate`）同样拦截——
  应用自身 origin 放行，其余转系统浏览器，窗口不会被带走。
- 已知限制：**浏览器操作（browser_page）在桌面版里不可用**——窗口里没有 Chrome 扩展运行时，
  page-picker 扩展装不上。前端 `isDesktopShell()`（`web/src/desktop.ts`）会给结论：
  `queryBrowserControl()` 直接报"改用网页版"，`pageCall` 立即返回错误而不干等 3 秒桥超时。
- **ESM 主进程禁止顶层 `await app.whenReady()`**：Electron 要等入口模块求值完成才发 ready
  事件，顶层 await 它 = 互相死等——进程卡在 `waiting for app ready…`、窗口永远不开。
  在 `app.whenReady().then(...)` 回调里 await 才是安全的。
- 与网页版共存：端口（随机口）、数据目录（`<userData>/data`）、控制 socket（按端口命名）、
  单实例锁都隔开，唯一共享的是 `~/.pi/agent`（pi 配置、认证、**会话记录**）——好处是桌面版
  不用重新配置，代价是**别在两边同时操作同一个对话**（两个 server 写同一份 transcript）。
  想彻底隔离就给桌面版设 `PI_CODING_AGENT_DIR`（`server/agent-service.ts` 读这个 env）。
- `electron-builder.yml` 里 `npmRebuild: false`：node-pty 1.1.0 是 N-API 预编译，
  在 `ELECTRON_RUN_AS_NODE` 下能直接 `require`，不需要按 Electron ABI 重编
  （否则打包强依赖本机 Visual Studio）。

## 产物与签名

`npm run desktop:dist` 产出 `release/pi-ccui-<version>-setup.exe`（NSIS 安装包，
可选安装目录）与 `release/win-unpacked/`（免安装直接跑的目录）。当前**未签名**：
Windows 首启有 SmartScreen「未知发布者」提示，功能不受影响。有证书时设
`CSC_LINK` + `CSC_KEY_PASSWORD` 环境变量即可自动签，不用改配置。

## 不在本骨架里

- 应用内自动更新（需要自己的 release 通道，本 fork 暂无；上游实现见其 `desktop/main.ts`
  的 `wireAutoUpdater` + `web/src/desktop-updater.ts` + TopBar 更新面板）。
- `server/index.ts` 拆 `startServer(opts)` → 主进程 in-process 内嵌，省掉 sidecar 进程（大改）。
