/**
 * Lightweight bash fallback for Windows.
 *
 * 本 fork 已删除「自动下载 busybox-w32」（原来会从 frippery.org 拉
 * busybox64u.exe 到 <home>/.pi-web/bin/ 并暴露成 bash.exe）。Windows 上需要
 * bash 时请自行准备其中之一：
 *   1. 安装 Git for Windows（首选，pi SDK 也优先用它）；
 *   2. 把任意 bash 放到 PATH；
 *   3. 手动把 busybox-w32 的 busybox64u.exe 复制成
 *      `<home>/.pi-web/bin/bash.exe` —— 本文件仍导出该目录，
 *      terminals.ts 的 resolveShell() 与 SDK 的 PATH 都会找到它。
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Directory holding the optional bash fallback (shared with terminals.ts / PATH). */
export function windowsBashDir(): string {
	return join(homedir(), ".pi-web", "bin");
}
