/**
 * 维护脚本（本 fork 自有）：从 locales/*.json 语言包里删除指定键。
 *
 * 用法:  node scripts/prune-locale-keys.mjs <key> [key...]
 * 示例:  node scripts/prune-locale-keys.mjs updateDesktopNote browserControlDesktop
 *
 * 为什么需要它：web/src/i18n.tsx 的 zh/en 是"键的真相"，locales/*.json（8 个语言包）
 * 必须与 zh 键**一一对应且顺序一致**（tests/unit/locales.test.ts 校验）。
 * 所以从 i18n.tsx 删键之后，必须同步删除语言包里的同名键。
 *
 * 实现：按行处理，尽量保留原文件的缩进与格式；遇到跨行的值会整段跳过；
 * 删到对象最后一个键时会顺手去掉上一行的尾逗号，避免产出非法 JSON。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
const keys = new Set(process.argv.slice(2));
if (keys.size === 0) {
	console.error("用法: node scripts/prune-locale-keys.mjs <key> [key...]");
	process.exit(1);
}

let touched = 0;
let removedTotal = 0;

for (const file of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
	const path = join(dir, file);
	const lines = readFileSync(path, "utf8").split("\n");
	const out = [];
	let removed = 0;
	let skipping = false;

	for (const line of lines) {
		if (skipping) {
			// 跨行值：直到本行出现结尾的 , 或 } 才结束
			if (/[,\]}]\s*$/.test(line.trimEnd())) skipping = false;
			continue;
		}
		const m = line.match(/^\s*"([^"]+)":\s*(.*)$/);
		if (m && keys.has(m[1])) {
			removed++;
			const rest = m[2].trimEnd();
			if (!/[,\}]$/.test(rest)) skipping = true;
			continue;
		}
		out.push(line);
	}

	if (removed === 0) continue;

	// 删掉的键若是对象最后一个成员，前一行会留下多余的尾逗号 —— 去掉它
	for (let i = 0; i < out.length; i++) {
		if (!/,\s*$/.test(out[i])) continue;
		const next = out.slice(i + 1).find((l) => l.trim() !== "");
		if (next && /^[\]}]/.test(next.trim())) out[i] = out[i].replace(/,\s*$/, "");
	}

	writeFileSync(path, out.join("\n"));
	touched++;
	removedTotal += removed;
}

console.log(`[prune-locale-keys] 处理 ${touched} 个语言包，共删除 ${removedTotal} 处键`);
