/** 纯逻辑单测：分词 / 检索排序 / 衰减 / 脱敏 / 指纹。跑法：node --test plugins/memory/test/ */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as C from "../client/core.mjs";

const rec = (over) => C.normalizeRecord({ id: over.id ?? "x", type: "pitfall", content: "占位", ...over });

describe("tokenize", () => {
	it("中文两字滑窗 + 英文词", () => {
		const t = C.tokenize("端口 port 8080");
		assert.ok(t.includes("端口"));
		assert.ok(t.includes("port"));
		assert.ok(t.includes("8080"));
	});

	it("单字成串时保留单字", () => {
		assert.deepEqual(C.tokenize("锁"), ["锁"]);
	});

	it("标点不产生空词条", () => {
		assert.deepEqual(C.tokenize("，。！"), []);
	});
});

describe("search", () => {
	const records = [
		rec({ id: "a", type: "pitfall", content: "后端端口是 8765，别用 8080 起服务" }),
		rec({ id: "b", type: "fact", content: "今天顺手改了端口那一行注释" }),
		rec({ id: "c", type: "convention", content: "提交前先跑 pnpm test" }),
	];
	const index = C.buildIndex(records);

	it("专门讲这件事的排在顺带提一句的前面", () => {
		const hits = C.search(records, index, "端口", { scopeKeys: ["global"] });
		assert.equal(hits[0].rec.id, "a");
		assert.ok(hits.findIndex((h) => h.rec.id === "b") > 0);
	});

	it("作废的默认不返回，显式要才返回", () => {
		const withInvalid = records.map((r) => (r.id === "a" ? { ...r, validUntil: Date.now() - 1000 } : r));
		const idx = C.buildIndex(withInvalid);
		assert.equal(
			C.search(withInvalid, idx, "端口", {}).some((h) => h.rec.id === "a"),
			false,
		);
		assert.equal(
			C.search(withInvalid, idx, "端口", { includeInvalidated: true }).some((h) => h.rec.id === "a"),
			true,
		);
	});

	it("隔离区的默认不参与推送，但可显式查到", () => {
		const q = [{ ...rec({ id: "q", content: "迁移前先备份数据库" }), quarantined: true }];
		const idx = C.buildIndex(q);
		assert.equal(C.search(q, idx, "备份").length, 0);
		assert.equal(C.search(q, idx, "备份", { includeQuarantined: true }).length, 1);
	});
});

describe("衰减", () => {
	it("半衰期只跟重要度挂钩", () => {
		assert.equal(C.halfLifeDays(5), 90);
		assert.equal(C.halfLifeDays(1), 7);
	});

	it("过了半衰期强度减半", () => {
		const base = { strength: 2, importance: 3, lastUsedAt: 0, createdAt: 0 };
		const now = 30 * 86_400_000;
		assert.ok(Math.abs(C.effectiveStrength(base, now) - 1) < 1e-6);
	});

	it("被用到就重新计时", () => {
		const now = 30 * 86_400_000;
		const fresh = { strength: 2, importance: 3, lastUsedAt: now, createdAt: 0 };
		assert.ok(Math.abs(C.effectiveStrength(fresh, now) - 2) < 1e-6);
	});
});

describe("脱敏与指纹", () => {
	it("拦得住常见凭据", () => {
		assert.equal(C.redact("key 是 sk-ant-abcdefghijklmnop1234").hit, "OpenAI/Anthropic 风格 key");
		assert.equal(C.redact("password=hunter22222").hit !== null, true);
		assert.equal(C.redact("正常的记忆内容，没有秘密").hit, null);
	});

	it("删除指纹能认出几乎同一条", () => {
		const a = C.fingerprint("后端端口是 8765，不要用 8080");
		const b = C.fingerprint("后端端口是 8765，不要用 8080。");
		assert.ok(C.jaccard(a, b) > 0.9);
		const list = [{ fp: a, type: "pitfall", scopeKey: "p" }];
		assert.equal(
			C.hitsBlacklist({ content: "后端端口是 8765，不要用 8080", type: "pitfall", scopeKey: "p" }, list),
			true,
		);
		assert.equal(C.hitsBlacklist({ content: "提交前先跑测试", type: "pitfall", scopeKey: "p" }, list), false);
	});
});

describe("归一化", () => {
	it("类型/范围非法时回落而不是丢条", () => {
		const r = C.normalizeRecord({ type: "胡说", scope: "宇宙", content: "x" });
		assert.equal(r.type, "pitfall");
		assert.equal(r.scope, "project");
	});

	it("重要度钳在 1..5", () => {
		assert.equal(C.normalizeRecord({ content: "x", importance: 99 }).importance, 5);
		assert.equal(C.normalizeRecord({ content: "x", importance: -3 }).importance, 1);
	});
});

describe("guessType（手写 /remember 的兜底）", () => {
	it("祈使/流程 → 约定；带「服务」不误判成事实", () => {
		assert.equal(C.guessType("迁移前必须先停服务，否则锁表"), "convention");
		assert.equal(C.guessType("提交前先跑 pnpm test"), "convention");
	});

	it("报错/决定/事实/术语/偏好各自归位", () => {
		assert.equal(C.guessType("改这个组件会报错 EADDRINUSE"), "pitfall");
		assert.equal(C.guessType("决定改用 pnpm，因为快了 3 倍"), "decision");
		assert.equal(C.guessType("后端端口 8765"), "fact");
		assert.equal(C.guessType("这个模块的简称是 RGW"), "glossary");
		assert.equal(C.guessType("回答尽量简短，别客套"), "preference");
	});
});
