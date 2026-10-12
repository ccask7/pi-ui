#!/usr/bin/env node
/**
 * Ccui CLI（本 fork 的精简版）。
 *
 * 保留：
 *   ccui                              启动服务器（前台，Ctrl+C 停止，自动打开浏览器）
 *   ccui --port/--cwd/--data-dir/--host/--agent-dir/--no-browser
 *   ccui --version | --help
 *
 * 本 fork 已删除（与上游"关联/远程获取"有关，删源码而非关闭开关）：
 *   - `server install|uninstall|start|stop|restart|status|quiesce|unquiesce|shortcut`
 *     （系统服务自启 / 桌面快捷方式；需要自启请自行写计划任务或守护脚本）
 *   - `install|uninstall|plugins`（从 GitHub/npm 拉取界面插件、更新检查与回滚）
 *   - `plugin create|upgrade-sdk`（插件脚手架；需要时可用 `ccui plugin create` 的
 *     上游实现，见 git 基线提交 5930cb2 的 bin/ccui.mjs）
 *
 * 环境变量（flag 优先，环境变量后备）：PI_WEB_PORT / PI_WEB_CWD / PI_WEB_DATA_DIR /
 * PI_WEB_HOST / PI_CODING_AGENT_DIR；鉴权口令 PI_WEB_TOKEN 仅环境变量。
 */
import { spawnSync } from "node:child_process";
import { get as httpGet } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
/** <pkg>/dist/server/index.js — the actual server entry. */
const SERVER_ENTRY = join(BIN_DIR, "..", "dist", "server", "index.js");
/** 可选的「优先用全局/祖先那份 pi SDK」解析钩子（`PI_WEB_SDK=global` 才生效）。
 *  必须早于任何 SDK 静态 import 加载 —— 所以启动路径把它当 `--import` 传进去；
 *  默认不启用时它自己什么都不做（见 server/resolve-global-sdk.ts）。 */
const SDK_HOOK = join(BIN_DIR, "..", "dist", "server", "resolve-global-sdk.js");
/** dist 可能是旧构建（没有这个钩子文件）—— 只有文件在才注入。 */
const HAS_SDK_HOOK = existsSync(SDK_HOOK);

let pkg = { version: "0.0.0" };
try {
	pkg = JSON.parse(readFileSync(join(BIN_DIR, "..", "package.json"), "utf8"));
} catch {
	// version is best-effort — the server itself doesn't need it
}

/** Detect if the user prefers Chinese locale: POSIX env vars win, then Intl API fallback. */
function isZhLang() {
	const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
	if (env.startsWith("zh")) return true;
	if (!env) {
		try {
			return Intl.DateTimeFormat().resolvedOptions().locale.startsWith("zh");
		} catch {
			/* ignore */
		}
	}
	return false;
}

const ZH = isZhLang();

const HELP_ZH = `ccui v${pkg.version} — web chat for the pi coding agent

用法:
  ccui                               启动服务器（前台，Ctrl+C 停止，自动打开浏览器）
  ccui --port 9000 --cwd /path       指定端口 / 工作目录
  ccui --no-browser                  启动但不自动打开浏览器
  ccui --version / --help

选项（flag 优先，环境变量后备）:
  --port <n>        端口（默认 8787，或 $PI_WEB_PORT）
  --cwd <dir>       工作目录（默认 $PI_WEB_CWD 或当前目录）
  --data-dir <dir>  数据目录（默认 ~/.pi-web，或 $PI_WEB_DATA_DIR）
  --host <addr>     监听地址（默认 127.0.0.1，或 $PI_WEB_HOST；0.0.0.0 供局域网/容器）
  --agent-dir <dir> pi 配置目录（默认 $PI_CODING_AGENT_DIR 或 ~/.pi/agent）
  --no-browser      启动但不自动打开浏览器

环境变量: PI_WEB_PORT / PI_WEB_CWD / PI_WEB_DATA_DIR / PI_WEB_HOST /
          PI_CODING_AGENT_DIR / PI_WEB_SDK / PI_WEB_TABS / PI_WEB_TOKEN（仅环境变量）

本 fork 已移除: 系统服务自启（server install/shortcut/start/stop…）与插件远程安装
          （install/uninstall/plugins）。界面插件请直接把插件目录放到 <data-dir>/plugins/。`;

const HELP_EN = `ccui v${pkg.version} — web chat for the pi coding agent

Usage:
  ccui                               Start the server (foreground, Ctrl+C to stop, opens the browser)
  ccui --port 9000 --cwd /path       Override port / workspace
  ccui --no-browser                  Start without opening the browser
  ccui --version / --help

Options (flag wins; env var is the fallback):
  --port <n>        HTTP port (default 8787, or $PI_WEB_PORT)
  --cwd <dir>       Workspace root (default $PI_WEB_CWD or the current directory)
  --data-dir <dir>  Data dir (default ~/.pi-web, or $PI_WEB_DATA_DIR)
  --host <addr>     Listen address (default 127.0.0.1, or $PI_WEB_HOST; 0.0.0.0 for LAN/containers)
  --agent-dir <dir> pi config dir (default $PI_CODING_AGENT_DIR or ~/.pi/agent)
  --no-browser      Start without opening the browser

Env vars: PI_WEB_PORT / PI_WEB_CWD / PI_WEB_DATA_DIR / PI_WEB_HOST /
          PI_CODING_AGENT_DIR / PI_WEB_SDK / PI_WEB_TABS / PI_WEB_TOKEN (env only)

Removed in this fork: system-service autostart (server install/shortcut/start/stop…) and
          remote plugin installs (install/uninstall/plugins). Drop plugin folders into
          <data-dir>/plugins/ instead.`;

const HELP = ZH ? HELP_ZH : HELP_EN;

/** Minimum Node required by the pi SDK (its dist uses `import … with { type: "json" }`). */
const NODE_MIN = [22, 19, 0];
function checkNodeVersion() {
	const v = process.versions.node.split(".").map(Number);
	const tooOld =
		v[0] < NODE_MIN[0] ||
		(v[0] === NODE_MIN[0] && v[1] < NODE_MIN[1]) ||
		(v[0] === NODE_MIN[0] && v[1] === NODE_MIN[1] && v[2] < NODE_MIN[2]);
	if (tooOld) {
		const zh =
			`✖ ccui 需要 Node.js >= ${NODE_MIN.join(".")}（当前 ${process.versions.node}）。\n` +
			`  pi SDK 的代码使用了 import attributes（with）语法，旧版 Node 无法解析。\n` +
			`  请升级 Node：https://nodejs.org（或 nvm-windows / fnm）。`;
		const en =
			`✖ ccui requires Node.js >= ${NODE_MIN.join(".")} (current: ${process.versions.node}).\n` +
			`  The pi SDK uses import attributes (\`with\` syntax) which older Node versions can't parse.\n` +
			`  Upgrade Node: https://nodejs.org`;
		console.error(ZH ? zh : en);
		process.exit(1);
	}
}

function fail(msg) {
	console.error(`✖ ${msg}`);
	process.exit(1);
}

/** Parse --flag value / --flag=value options; returns { opts, positionals }. */
function parseFlags(argv) {
	const opts = {
		port: undefined,
		cwd: undefined,
		dataDir: undefined,
		host: undefined,
		agentDir: undefined,
		noBrowser: false,
		help: false,
		version: false,
	};
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const eq = a.indexOf("=");
		const key = eq >= 0 ? a.slice(0, eq) : a;
		const inline = eq >= 0 ? a.slice(eq + 1) : undefined;
		const take = () => (inline !== undefined ? inline : argv[++i]);
		switch (key) {
			case "--port":
				opts.port = take();
				break;
			case "--cwd":
				opts.cwd = take();
				break;
			case "--data-dir":
				opts.dataDir = take();
				break;
				break;
			case "--host":
				opts.host = take();
				break;
			case "--agent-dir":
				opts.agentDir = take();
				break;
			case "--no-browser":
				opts.noBrowser = true;
				break;
			case "--help":
			case "-h":
				opts.help = true;
				break;
			case "--version":
			case "-v":
				opts.version = true;
				break;
			default:
				positionals.push(a);
				break;
		}
	}
	return { opts, positionals };
}

function effectivePort(opts) {
	return String(opts.port ?? process.env.PI_WEB_PORT ?? "8787");
}

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";

function openBrowser(url) {
	let res;
	if (isMac) {
		res = spawnSync("open", [url], { stdio: "ignore" });
	} else if (isWin) {
		res = spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
	} else {
		res = spawnSync("xdg-open", [url], { stdio: "ignore" });
	}
	// spawnSync 不抛异常：命令缺失（headless 服务器）时在返回对象里带 error 字段。
	if (res?.error) {
		if (res.error.code === "ENOENT") {
			console.warn(
				ZH
					? `[browser] 未找到打开器 (${res.error.path || "command not found"})，headless 服务器可用 --no-browser 关闭自动打开`
					: `[browser] no opener found (${res.error.path || "command not found"}), headless servers can use --no-browser to disable auto-open`,
			);
		} else {
			console.warn(ZH ? "[browser] 打开浏览器失败:" : "[browser] failed to open browser:", res.error.message);
		}
	}
}

/**
 * Poll `url` until the server answers (or ~15s pass), then open it in the
 * default browser. The foreground server runs in this process, so the first
 * HTTP response is the "listening" signal.
 */
function openBrowserWhenUp(url) {
	const deadline = Date.now() + 15_000;
	const attempt = () => {
		const req = httpGet(url, (res) => {
			res.resume();
			console.log(
				ZH
					? `  🌐 已自动打开浏览器：${url}（--no-browser 可关闭）`
					: `  🌐 Browser opened automatically: ${url} (--no-browser to disable)`,
			);
			openBrowser(url);
		});
		req.setTimeout(1000, () => {
			req.destroy();
			if (Date.now() < deadline) setTimeout(attempt, 150);
		});
		req.on("error", () => {
			if (Date.now() < deadline) setTimeout(attempt, 150);
		});
	};
	attempt();
}

async function startForeground(opts) {
	if (opts.port) process.env.PI_WEB_PORT = opts.port;
	if (opts.cwd) process.env.PI_WEB_CWD = resolve(opts.cwd);
	if (opts.dataDir) process.env.PI_WEB_DATA_DIR = resolve(opts.dataDir);
	if (opts.agentDir) process.env.PI_CODING_AGENT_DIR = resolve(opts.agentDir);
	const url = `http://localhost:${effectivePort(opts)}`;
	if (HAS_SDK_HOOK) await import(pathToFileURL(SDK_HOOK).href);
	await import(pathToFileURL(SERVER_ENTRY).href);
	if (!opts.noBrowser) openBrowserWhenUp(url);
}

async function main() {
	checkNodeVersion();
	const { opts, positionals } = parseFlags(process.argv.slice(2));
	if (opts.version) {
		console.log(pkg.version);
		return;
	}
	if (opts.help) {
		console.log(HELP);
		return;
	}
	if (positionals.length > 0)
		fail(
			ZH
				? `未知命令: ${positionals[0]}（--help 查看用法；本 fork 已移除服务自启与插件远程安装）`
				: `Unknown command: ${positionals[0]} (see --help; this fork removed service install and remote plugin installs)`,
		);
	await startForeground(opts);
}

main().catch((err) => {
	console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
