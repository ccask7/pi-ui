/**
 * 记忆检索的固定题库评分（纯函数，浏览器/Node 都能跑）。
 *
 * 为什么要有它：这几类系统的公开 benchmark 都在对话记忆上，编码 agent 的"项目记忆"没有
 * 可直接借的；而"觉得记得挺准"是感觉，不是指标。所以自建一个小题库，每条查询人工标出
 * **应该**返回哪些条目（expect）和**已知是错的/过期的**（bad），每次调权重/改分词都跑一遍。
 *
 * 两个数是关键：
 *   - 命中率 hitRate   = 该想起来的想起来了没有
 *   - 有害率 harmfulRate = 返回的条目里有多少是被标成错误/过期的（**这个数比命中率重要**：
 *     编码场景里"记错了旧命令"比"忘了"危险得多）
 */
import * as C from "../client/core.mjs";

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * @param records 记忆数组（server 落盘的那些原样）
 * @param queries [{ q, expect?: string[], bad?: string[], k?: number, scopeKeys?: string[] }]
 * @param opts    { limit?, nowMs? }
 */
export function evaluate(records, queries, opts = {}) {
	const nowMs = Number(opts.nowMs ?? Date.now());
	const index = C.buildIndex(records);
	const limit = Number(opts.limit ?? 8);
	const rows = [];
	for (const item of queries ?? []) {
		const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
		const hits = C.search(records, index, String(item.q ?? ""), {
			limit,
			nowMs,
			scopeKeys: item.scopeKeys,
			includeInvalidated: item.includeInvalidated === true,
		});
		const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
		const got = hits.map((h) => h.rec.id);
		const expect = Array.isArray(item.expect) ? item.expect : [];
		const bad = new Set(Array.isArray(item.bad) ? item.bad : []);
		const k = Number(item.k ?? limit);
		const top = got.slice(0, k);
		rows.push({
			q: String(item.q ?? ""),
			expect,
			got,
			hit: expect.every((id) => top.includes(id)),
			/** 返回里落在 bad 名单上的条数（有害召回） */
			harmful: got.filter((id) => bad.has(id)).length,
			returned: got.length,
			ms: t1 - t0,
		});
	}
	const n = rows.length;
	const totalReturned = rows.reduce((a, r) => a + r.returned, 0);
	const harmful = rows.reduce((a, r) => a + r.harmful, 0);
	const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
	return {
		rows,
		summary: {
			n,
			hitRate: n ? round(rows.filter((r) => r.hit).length / n) : 0,
			harmfulItems: harmful,
			/** 返回条目中被标为错误/过期的比例（分母 = 总返回条数） */
			harmfulRate: totalReturned ? round(harmful / totalReturned) : 0,
			avgReturned: n ? round(totalReturned / n, 2) : 0,
			avgMs: n ? round(sum((r) => r.ms) / n, 2) : 0,
			maxMs: n ? round(Math.max(...rows.map((r) => r.ms)), 2) : 0,
		},
	};
}

/** 一条查询是否"有害召回"超标（红线：> 0.05 就停止加功能，先修检索与失效判断）。 */
export const HARMFUL_RED_LINE = 0.05;

export function verdict(summary) {
	if (!summary.n) return "题库是空的：先攒几天真实记忆再标，别凭想象编。";
	if (summary.harmfulRate > HARMFUL_RED_LINE) {
		return `有害召回率 ${(summary.harmfulRate * 100).toFixed(1)}% 超过 ${HARMFUL_RED_LINE * 100}% 红线 —— 先修检索与换代判断，别加功能。`;
	}
	return `有害召回率 ${(summary.harmfulRate * 100).toFixed(1)}%，在红线内（命中率 ${(summary.hitRate * 100).toFixed(0)}%）。`;
}
