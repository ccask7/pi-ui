/**
 * 维护脚本（本 fork 自有）：找出 web/src/i18n.tsx 里**没有任何地方引用**的 i18n 键。
 *
 * 用法:
 *   node scripts/unused-i18n-keys.mjs            # 只报告
 *   node scripts/unused-i18n-keys.mjs --write    # 报告并删除（同时同步 locales/*.json）
 *
 * 用途：删除功能（比如"更新体系""桌面壳"）之后，配套的文案键会变成死键。
 *      zh 是键的真相（en 是 Record<keyof typeof zh, string>，TS 会强制两边一致），
 *      locales/*.json 又必须与 zh 一一对应，所以删键要三处一起动 —— 本脚本一次做完。
 *
 * 已知动态键：`t(`thinking.${v}`)`、`tt(`promptTok_${tk}_desc`)` 这类模板拼接，
 * 扫描器看不出来，所以按前缀白名单跳过（见 IGNORE_PREFIXES）。新增动态键家族时请补进来。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const I18N = join(root, "web", "src", "i18n.tsx");
const SCAN_DIRS = ["web/src", "plugins", "extensions", "server", "tests", "scripts", "bin"];
const IGNORE_PREFIXES = ["thinking.", "promptTok_"];
const write = process.argv.includes("--write");
// --only <regex>：只处理匹配该正则的键（删功能时只想清自己的死键，
// 不想动上游历史遗留的死键 —— 后者里不少是社区插件可能在用的宿主键）。
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? new RegExp(process.argv[onlyArg + 1]) : null;

/** 递归列出目录下的文本文件（跳过 node_modules / dist / vendor 产物）。 */
function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "dist" || name === "vendor" || name === ".git") continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

/** 收集所有文本文件内容，供键引用扫描用。 */
const haystack = [];
for (const d of SCAN_DIRS) {
	for (const f of walk(join(root, d))) {
		if (f === I18N) continue;
		if (!/\.(ts|tsx|mjs|js|json|md)$/.test(f)) continue;
		haystack.push([relative(root, f), readFileSync(f, "utf8")]);
	}
}

// ---- 1) 从 i18n.tsx 抽出 zh 的键（`export const zh = { ... } as const;` 区间内） ----
const i18nLines = readFileSync(I18N, "utf8").split("\n");
const zhStart = i18nLines.findIndex((l) => l.startsWith("export const zh = {"));
const zhEnd = i18nLines.findIndex((l, i) => i > zhStart && l.startsWith("} as const;"));
if (zhStart < 0 || zhEnd < 0) {
	console.error("找不到 export const zh = { ... } as const; 区间，脚本需要更新");
	process.exit(1);
}
const keyLine = /^\t(?:"([A-Za-z0-9_.]+)"|([A-Za-z0-9_]+)):/;
const zhKeys = [];
for (let i = zhStart + 1; i < zhEnd; i++) {
	const m = i18nLines[i].match(keyLine);
	if (m) zhKeys.push(m[1] ?? m[2]);
}
console.log(`[i18n] zh 键 ${zhKeys.length} 个`);

// ---- 2) 找出未被引用的键 ----
const unused = [];
for (const key of zhKeys) {
	if (IGNORE_PREFIXES.some((p) => key.startsWith(p))) continue;
	if (only && !only.test(key)) continue;
	const needle = `"${key}"`;
	const needle2 = `'${key}'`;
	const needle3 = "`" + key + "`";
	const hit = haystack.some(([, text]) => text.includes(needle) || text.includes(needle2) || text.includes(needle3));
	if (!hit) unused.push(key);
}
console.log(`[i18n] 未被引用的键 ${unused.length} 个：`);
for (const k of unused) console.log(`  - ${k}`);

if (!write) {
	console.log("\n（只报告模式；加 --write 才会删除）");
	process.exit(0);
}

// ---- 3) 从 i18n.tsx 删除这些键（zh 与 en 各一遍，保留缩进/多行值） ----
const unusedSet = new Set(unused);
let removedI18n = 0;
const kept = [];
for (let i = 0; i < i18nLines.length; i++) {
	const line = i18nLines[i];
	const m = line.match(keyLine);
	const keyName = m ? (m[1] ?? m[2]) : undefined;
	if (keyName && unusedSet.has(keyName)) {
		removedI18n++;
		// 值换行时吃掉后续行，直到出现结尾的逗号
		if (!/,\s*$/.test(line)) {
			while (i + 1 < i18nLines.length && !/,\s*$/.test(i18nLines[i + 1])) i++;
			i++;
		}
		continue;
	}
	kept.push(line);
}
// 删掉的若是对象最后一个成员，去掉上一行多余逗号
for (let i = 0; i < kept.length; i++) {
	if (!/,\s*$/.test(kept[i])) continue;
	const next = kept.slice(i + 1).find((l) => l.trim() !== "");
	if (next && /^[\]}]/.test(next.trim())) kept[i] = kept[i].replace(/,\s*$/, "");
}
writeFileSync(I18N, kept.join("\n"));
console.log(`[i18n] i18n.tsx 删除 ${removedI18n} 行（zh+en）`);

// ---- 4) 同步 locales/*.json ----
const localesDir = join(root, "locales");
let packsTouched = 0;
let packKeysRemoved = 0;
for (const file of readdirSync(localesDir).filter((n) => n.endsWith(".json"))) {
	const path = join(localesDir, file);
	const lines = readFileSync(path, "utf8").split("\n");
	const out = [];
	let removed = 0;
	let skipping = false;
	for (const line of lines) {
		if (skipping) {
			if (/[,\]}]\s*$/.test(line.trimEnd())) skipping = false;
			continue;
		}
		const m = line.match(/^\s*"([^"]+)":\s*(.*)$/);
		if (m && unusedSet.has(m[1])) {
			removed++;
			if (!/[,\}]$/.test(m[2].trimEnd())) skipping = true;
			continue;
		}
		out.push(line);
	}
	if (removed === 0) continue;
	for (let i = 0; i < out.length; i++) {
		if (!/,\s*$/.test(out[i])) continue;
		const next = out.slice(i + 1).find((l) => l.trim() !== "");
		if (next && /^[\]}]/.test(next.trim())) out[i] = out[i].replace(/,\s*$/, "");
	}
	writeFileSync(path, out.join("\n"));
	packsTouched++;
	packKeysRemoved += removed;
}
console.log(`[i18n] 语言包：${packsTouched} 个文件、删除 ${packKeysRemoved} 处键`);
