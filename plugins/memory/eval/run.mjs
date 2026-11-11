#!/usr/bin/env node
/**
 * 题库跑分（只读，不启服务）：
 *
 *     node plugins/memory/eval/run.mjs                       # 默认读 ~/.pi-web 的库与同目录题库
 *     node plugins/memory/eval/run.mjs --data D:/x --queries q.json
 *     node plugins/memory/eval/run.mjs --json                # 机器可读输出
 *
 * 库 = <data>/memory/memories.jsonl（与插件落盘同一份；老版本在 plugins/memory/data/）。
 * 题库 = 本目录的 queries.json：每条 { q, expect: [id...], bad: [id...], k? }，
 * 其中 expect 是"应该返回的条目 id"，bad 是"已知错误/过期、出现了就算有害"的 id。
 * id 从 /recall 或记忆图里拿。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../client/core.mjs";
import { evaluate, verdict } from "./evaluate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	if (i < 0) return fallback;
	return process.argv[i + 1] ?? fallback;
}
const asJson = process.argv.includes("--json");
const dataDir = resolve(arg("data", join(homedir(), ".pi-web")));
const queriesFile = resolve(arg("queries", join(here, "queries.json")));
const storeFile = join(dataDir, "memory", "memories.jsonl");
const legacyStoreFile = join(dataDir, "plugins", "memory", "data", "memories.jsonl");

function loadRecords() {
	if (!existsSync(storeFile)) return [];
	const out = [];
	for (const line of readFileSync(storeFile, "utf8").split(/\r?\n/)) {
		const s = line.trim();
		if (!s) continue;
		try {
			const rec = C.normalizeRecord(JSON.parse(s));
			if (rec.id) out.push(rec);
		} catch {
			/* 坏行跳过 */
		}
	}
	return out;
}

const records = loadRecords();
if (!records.length && existsSync(legacyStoreFile)) {
	console.error(`提示：<data>/memory 里没有数据，但旧位置还有一份：${legacyStoreFile}`);
}
const queries = existsSync(queriesFile) ? (JSON.parse(readFileSync(queriesFile, "utf8")).queries ?? []) : [];
const report = evaluate(records, queries, { limit: Number(arg("limit", 8)) });

if (asJson) {
	console.log(
		JSON.stringify({ storeFile, records: records.length, ...report, verdict: verdict(report.summary) }, null, 2),
	);
} else {
	console.log(`库：${storeFile}（${records.length} 条）`);
	console.log(`题库：${queriesFile}（${queries.length} 条）`);
	console.log("");
	const pad = (s, n) => String(s).padEnd(n);
	console.log(`${pad("命中", 4)} ${pad("有害", 4)} ${pad("返回", 4)} ${pad("ms", 7)} 查询`);
	for (const r of report.rows) {
		console.log(
			`${pad(r.hit ? "✓" : "✗", 4)} ${pad(r.harmful, 4)} ${pad(r.returned, 4)} ${pad(r.ms.toFixed(2), 7)} ${r.q}`,
		);
	}
	const s = report.summary;
	console.log("");
	console.log(
		`命中率 ${(s.hitRate * 100).toFixed(0)}% · 有害召回率 ${(s.harmfulRate * 100).toFixed(1)}% · 平均返回 ${s.avgReturned} 条 · 平均 ${s.avgMs}ms（最慢 ${s.maxMs}ms）`,
	);
	console.log(verdict(s));
}
