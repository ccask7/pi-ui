import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObserver } from "../lib/observe.mjs";

function tmp() {
	return mkdtempSync(join(tmpdir(), "mem-obs-"));
}

function lines(dir) {
	const out = [];
	for (const name of readdirSync(join(dir, "events"))) {
		for (const line of readFileSync(join(dir, "events", name), "utf8").split("\n")) {
			if (line.trim()) out.push(JSON.parse(line));
		}
	}
	return out;
}

test("事件按轮次与条目逐条落盘，不含内容", () => {
	const dir = tmp();
	const obs = createObserver({ dataDir: dir });
	obs.startTurn("c1");
	obs.call("memory_search", "c1");
	obs.hint(["a", "b"], "c1");
	obs.use("a", "c1");
	obs.ignore("b", "c1");
	const all = lines(dir);
	assert.deepEqual(
		all.map((e) => e.ev),
		["turn", "call", "hint", "hint", "use", "ignore"],
	);
	assert.equal(all[0].turn, 1);
	for (const e of all.slice(2, 4)) assert.equal(e.turn, 1);
	assert.equal(all[1].n, "memory_search");
	// 不落内容：所有值都不该是长文本
	for (const e of all) {
		for (const v of Object.values(e)) {
			if (typeof v === "string") assert.ok(v.length <= 120, `字段过长：${v}`);
		}
	}
});

test("stats 累加并落盘，flush 后可直接读回", () => {
	const dir = tmp();
	const obs = createObserver({ dataDir: dir });
	obs.startTurn("c1");
	obs.hint(["a"], "c1");
	obs.search(["a"], "c1");
	obs.use("a", "c1");
	obs.ignore("a", "c1");
	obs.flush();
	const raw = JSON.parse(readFileSync(join(dir, "stats.json"), "utf8"));
	assert.equal(raw.records.a.hint, 1);
	assert.equal(raw.records.a.search, 1);
	assert.equal(raw.records.a.used, 1);
	assert.equal(raw.records.a.ignored, 1);
	assert.ok(raw.records.a.lastUse > 0);
});

test("stats 是长期真源：本轮进程重启后计数仍在，不从 events 重算", () => {
	const dir = tmp();
	const first = createObserver({ dataDir: dir });
	first.hint(["a"], "c1");
	first.flush();
	const second = createObserver({ dataDir: dir });
	assert.equal(second.statsFor("a").hint, 1);
	second.hint(["a"], "c1");
	second.flush();
	assert.equal(JSON.parse(readFileSync(join(dir, "stats.json"), "utf8")).records.a.hint, 2);
});

test("单日文件超过上限后滚到 .2（不引入定时器）", () => {
	const dir = tmp();
	const obs = createObserver({ dataDir: dir, maxBytes: 200 });
	obs.startTurn("c1");
	for (let i = 0; i < 20; i++) obs.call("read", "c1");
	const names = readdirSync(join(dir, "events"));
	assert.ok(
		names.some((n) => /\.2\.jsonl$/.test(n)),
		`应出现分片：${names.join(",")}`,
	);
});

test("超过保留期的事件文件在 append 路径上被清掉", () => {
	const dir = tmp();
	const obs = createObserver({ dataDir: dir, pruneEvery: 1, keepDays: 30 });
	obs.startTurn("c1"); // 建目录
	const old = join(dir, "events", "2020-01-01.jsonl");
	writeFileSync(old, '{"ev":"turn"}\n');
	assert.ok(existsSync(old));
	obs.call("read", "c1");
	assert.ok(!existsSync(old), "过期文件应被清理");
});

test("summarize 给出 P0 三项指标的分母分子", () => {
	const dir = tmp();
	const obs = createObserver({ dataDir: dir });
	for (let t = 0; t < 4; t++) {
		obs.startTurn("c1");
		obs.call(t === 0 ? "memory_search" : "read", "c1");
	}
	obs.hint(["a", "b", "c"], "c1");
	obs.use("a", "c1");
	const s = obs.summarize();
	assert.equal(s.turns, 4);
	assert.equal(s.memoryCalls, 1);
	assert.equal(s.callRate, 0.25);
	assert.equal(s.hint, 3);
	assert.equal(s.use, 1);
	assert.equal(s.hintEffectiveness, 0.333);
});
