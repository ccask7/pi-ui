/** 题库评分器单测：命中率 / 有害召回率 / 空题库的判定。 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as C from "../client/core.mjs";
import { evaluate, verdict, HARMFUL_RED_LINE } from "../eval/evaluate.mjs";

const now = Date.now();
const rec = (id, content, over = {}) =>
	C.normalizeRecord({ id, type: "pitfall", content, scopeKey: "proj", createdAt: now, updatedAt: now, ...over });

const records = [
	rec("a", "这个仓库的后端端口是 8765，别用 8080 起服务"),
	rec("b", "提交前先跑 pnpm test，别直接提"),
	rec("c", "旧命令 npm run build 已经废弃，改用 pnpm build", { validUntil: now - 1000 }),
];

describe("题库评分", () => {
	it("命中 / 有害 / 平均返回都算得出来", () => {
		const report = evaluate(records, [
			{ q: "端口", expect: ["a"] },
			{ q: "提交前", expect: ["b"] },
			// 期望 a 但查询指向的是 b → 不命中
			{ q: "提交", expect: ["a"] },
		]);
		assert.equal(report.summary.n, 3);
		assert.equal(report.rows[0].hit, true);
		assert.equal(report.rows[2].hit, false);
		assert.ok(report.summary.hitRate > 0.6 && report.summary.hitRate < 0.7, `实际 ${report.summary.hitRate}`);
		assert.equal(report.summary.harmfulItems, 0);
	});

	it("作废条目默认不返回；被标 bad 的条目出现了就算有害", () => {
		// 强行让 c 参与返回（显式 includeInvalidated）
		const r1 = evaluate(records, [{ q: "build", k: 5 }]);
		assert.ok(!r1.rows[0].got.includes("c"), "作废的默认不该返回");

		const r2 = evaluate(records, [{ q: "build", k: 5, includeInvalidated: true, bad: ["c"] }]);
		assert.ok(r2.rows[0].got.includes("c"));
		assert.equal(r2.summary.harmfulItems, 1);
		assert.ok(r2.summary.harmfulRate > 0);
	});

	it("有害召回率超红线时 verdict 直接叫停", () => {
		const bad = evaluate(records, [{ q: "build", k: 5, includeInvalidated: true, bad: ["c"] }]);
		assert.ok(bad.summary.harmfulRate > HARMFUL_RED_LINE);
		assert.match(verdict(bad.summary), /红线/);
	});

	it("空题库不假装有结果", () => {
		const empty = evaluate(records, []);
		assert.equal(empty.summary.n, 0);
		assert.match(verdict(empty.summary), /题库是空的/);
	});
});
