/**
 * memory · 纯逻辑层（服务端 index.mjs 与浏览器视图共用同一份，零依赖、不碰 fs）。
 *
 * 分工：本文件只做可单测的纯函数——分词（中文 2-gram + 英文词）、倒排检索、打分、
 * 强度衰减、脱敏、删除指纹。落盘/宿主交互全在 index.mjs。
 *
 * 分词为什么是 2-gram：中文没有空格，宿主自己的会话搜索也是子串匹配
 * （server/agent-service.ts 的 sessionMatchesSearch），子串召回够用、但排序全平。
 * 两字滑窗是最笨的切法：零依赖、召回不低于词典分词、排序够用，代价只是索引大两三倍。
 */

/** 7 类记忆。类型只决定初始重要度与排序偏好，不决定生死（生命周期靠强度衰减）。 */
export const TYPES = ["task", "pitfall", "decision", "convention", "fact", "glossary", "preference"];

/** 中文标签（界面与工具输出共用）。 */
export const TYPE_LABEL = {
	task: "任务",
	pitfall: "坑",
	decision: "决定",
	convention: "约定",
	fact: "事实",
	glossary: "术语",
	preference: "偏好",
};

/** 范围：global 跨项目 / project 当前项目 / task 当前任务（收尾后收敛成 episode）。 */
export const SCOPES = ["global", "project", "task"];

/** 重要度 → 半衰期（天）。5 ≈ 90 天，3 ≈ 30 天，1 ≈ 7 天。被用到就重新计时。 */
const HALF_LIFE_DAYS = [0, 7, 15, 30, 60, 90];

/** 打分权重（相关度 / 近因 / 重要度 / 使用频次）。 */
export const WEIGHTS = { relevance: 0.45, recency: 0.25, importance: 0.2, usage: 0.1 };

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const DAY_MS = 86_400_000;

export function clampInt(v, min, max, fallback) {
	const n = Math.round(Number(v));
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

export function halfLifeDays(importance) {
	return HALF_LIFE_DAYS[clampInt(importance, 1, 5, 3)] ?? 30;
}

/** 以天为单位的半衰因子：1 = 新鲜，0.5 = 过了一个半衰期。 */
export function decayFactor(sinceMs, nowMs, half) {
	const delta = Math.max(0, nowMs - (Number(sinceMs) || 0));
	return Math.pow(2, -delta / DAY_MS / Math.max(1, half));
}

/** 记录此刻的"有效强度"：原始强度 × 从最后一次被用到现在的衰减。 */
export function effectiveStrength(rec, nowMs) {
	const base = Number(rec?.strength);
	const touch = Number(rec?.lastUsedAt ?? rec?.updatedAt ?? rec?.createdAt) || 0;
	const imp = clampInt(rec?.importance, 1, 5, 3);
	const raw = Number.isFinite(base) ? base : 1;
	return raw * decayFactor(touch, nowMs, halfLifeDays(imp));
}

/**
 * 分词：中文按两字滑窗、英文/数字按词（小写）。返回去重后的词条数组。
 * 单字成串时保留单字（"X" 这类查询仍然能命中）。
 */
export function tokenize(text) {
	const s = String(text ?? "").toLowerCase();
	const out = new Set();
	let buf = "";
	let run = "";
	const flushWord = () => {
		if (buf.length >= 2) out.add(buf);
		buf = "";
	};
	const flushRun = () => {
		if (!run) return;
		if (run.length === 1) out.add(run);
		else for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
		run = "";
	};
	for (const ch of s) {
		if (CJK_RE.test(ch)) {
			flushWord();
			run += ch;
			continue;
		}
		flushRun();
		if (/[a-z0-9_]/.test(ch)) buf += ch;
		else flushWord();
	}
	flushWord();
	flushRun();
	return [...out];
}

/** 建倒排：term → 记录 id 集合；同时留每条记录自己的词条集合（打分时不再重算）。 */
export function buildIndex(records) {
	const postings = new Map();
	const termsById = new Map();
	const list = Array.isArray(records) ? records : [];
	for (const rec of list) {
		if (!rec || !rec.id) continue;
		const terms = new Set(tokenize(`${rec.content ?? ""} ${rec.excerpt ?? ""} ${(rec.tags ?? []).join(" ")}`));
		termsById.set(rec.id, terms);
		for (const t of terms) {
			let bucket = postings.get(t);
			if (!bucket) postings.set(t, (bucket = []));
			bucket.push(rec.id);
		}
	}
	return { postings, termsById, n: termsById.size };
}

function idfOf(index, term) {
	const df = index.postings.get(term)?.length ?? 0;
	return Math.log(1 + (index.n || 1) / (df + 0.5));
}

/** 是否已作废/已过期（作废默认不参与检索）。 */
export function isInvalidated(rec, nowMs) {
	if (!rec) return true;
	const until = Number(rec.validUntil);
	if (Number.isFinite(until) && until > 0 && until <= nowMs) return true;
	return rec.invalidated === true;
}

export function isVisible(rec, nowMs) {
	return !isInvalidated(rec, nowMs) && rec.quarantined !== true;
}

/**
 * 检索。opts: { scopeKeys?, types?, includeInvalidated?, includeQuarantined?, includeQuarantinedOnly?, limit? }
 * 返回 [{ rec, score, relevance, recency, strength, parts }]（已按分数降序）。
 */
export function search(records, index, query, opts = {}) {
	const nowMs = Number(opts.nowMs ?? Date.now());
	const limit = clampInt(opts.limit, 1, 50, 8);
	const qTerms = tokenize(query);
	const wantTypes = Array.isArray(opts.types) && opts.types.length ? new Set(opts.types) : null;
	const wantScopes = Array.isArray(opts.scopeKeys) && opts.scopeKeys.length ? new Set(opts.scopeKeys) : null;

	const byId = new Map();
	for (const rec of records ?? []) if (rec?.id) byId.set(rec.id, rec);

	const candidates = new Map();
	if (!qTerms.length) {
		// 空查询 = 浏览：全部按时间/强度排
		for (const rec of records ?? []) candidates.set(rec.id, 0);
	} else {
		let totalIdf = 0;
		for (const t of qTerms) totalIdf += idfOf(index, t);
		const hits = new Map();
		for (const t of qTerms) {
			for (const id of index.postings.get(t) ?? []) {
				const cur = hits.get(id) ?? { rel: 0, terms: 0 };
				cur.rel += idfOf(index, t);
				cur.terms += 1;
				hits.set(id, cur);
			}
		}
		for (const [id, h] of hits) candidates.set(id, totalIdf > 0 ? h.rel / totalIdf : 0);
	}

	const out = [];
	for (const [id, relevance] of candidates) {
		const rec = byId.get(id);
		if (!rec) continue;
		if (wantTypes && !wantTypes.has(rec.type)) continue;
		if (wantScopes && !wantScopes.has(rec.scopeKey ?? rec.scope)) continue;
		if (opts.includeQuarantinedOnly) {
			if (rec.quarantined !== true) continue;
		} else if (rec.quarantined === true && !opts.includeQuarantined) continue;
		if (isInvalidated(rec, nowMs) && !opts.includeInvalidated) continue;

		const imp = clampInt(rec.importance, 1, 5, 3);
		const touched = Number(rec.lastUsedAt ?? rec.updatedAt ?? rec.createdAt) || nowMs;
		const recency = decayFactor(touched, nowMs, 30);
		const strength = effectiveStrength(rec, nowMs);
		const usage = Math.min(1, Math.log1p(Number(rec.useCount) || 0) / 3);
		const base =
			WEIGHTS.relevance * relevance +
			WEIGHTS.recency * recency +
			WEIGHTS.importance * (imp / 5) +
			WEIGHTS.usage * usage;
		// 淡出：强度低于 1 时整体降权，但不清零 —— 永远还能被搜到、能捞回来
		const fade = 0.5 + 0.5 * Math.min(1, Math.max(0, strength));
		out.push({
			rec,
			score: base * fade + (rec.pinned ? 0.05 : 0),
			relevance,
			recency,
			strength,
			base,
		});
	}
	out.sort((a, b) => b.score - a.score || (Number(b.rec.createdAt) || 0) - (Number(a.rec.createdAt) || 0));
	return out.slice(0, limit);
}

/** 相对时间（工具输出与界面共用）。 */
export function relTime(ms, nowMs = Date.now()) {
	const t = Number(ms) || 0;
	if (!t) return "时间未知";
	const diff = Math.max(0, nowMs - t);
	if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟前`;
	if (diff < DAY_MS) return `${Math.round(diff / 3_600_000)} 小时前`;
	if (diff < 30 * DAY_MS) return `${Math.round(diff / DAY_MS)} 天前`;
	return `${Math.round(diff / (30 * DAY_MS))} 个月前`;
}

/** 类型的中文/英文别名（斜杠命令与工具入参都认）。 */
export const TYPE_ALIASES = {
	坑: "pitfall",
	错误: "pitfall",
	报错: "pitfall",
	决定: "decision",
	约定: "convention",
	事实: "fact",
	术语: "glossary",
	偏好: "preference",
	任务: "task",
};

/**
 * 猜类型（只给 `/remember 这条东西` 这种不带类型的手写输入用）。
 * 规则按"最先命中"取，顺序 = 从最具体到最泛；都没命中按约定（用户手写的多半是约定）。
 */
export function guessType(text) {
	const s = String(text ?? "");
	// 行为约束（"问问题时不要动手，回答即可"）算偏好：它约束的是我怎么做事，不是项目约定
	if (
		/别啰嗦|偏好|喜欢|风格|语气|回答.*(短|简|详细)|用中文|用英文|只回答|回答问题|不要主动|别主动|不要动手|别动手|动手前|先问我|不要执行/i.test(
			s,
		)
	)
		return "preference";
	if (/报错|错误|失败|踩坑|坑|崩|挂了|不生效/i.test(s)) return "pitfall";
	if (/决定|选了|改用|否决|方案|取舍|因为/i.test(s)) return "decision";
	// 祈使/流程语气优先于"事实"：句子里出现「服务」不代表它记的是服务本身
	if (/不要|别|必须|先|一律|统一|命令|流程|命名|规范|提交前|迁移前/i.test(s)) return "convention";
	if (/端口|路径|版本|地址|账号|服务|环境|依赖|目录/i.test(s)) return "fact";
	if (/简称|代号|指的是|黑话|叫它/i.test(s)) return "glossary";
	return "convention";
}

/** 一条记忆的单行表示（列表、工具输出、图上详情共用）。 */
export function renderLine(rec, nowMs = Date.now()) {
	const type = TYPE_LABEL[rec?.type] ?? rec?.type ?? "?";
	const age = relTime(rec?.updatedAt ?? rec?.createdAt, nowMs);
	const flags = [];
	if (rec?.pinned) flags.push("钉");
	if (rec?.quarantined) flags.push("隔离");
	if (isInvalidated(rec, nowMs)) flags.push("作废");
	if (Number(rec?.importance) >= 4) flags.push(`重要${rec.importance}`);
	const tail = flags.length ? ` · ${flags.join("/")}` : "";
	return `[${rec?.id}] ${type} · ${age}${tail} — ${rec?.content ?? ""}`;
}

/**
 * 脱敏：命中即拒绝写入（密钥/令牌/密码/私钥），返回命中的规则名。
 * 宁可错拒一条记忆，不可把凭据落盘。
 */
const SECRET_RULES = [
	["私钥块", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	["OpenAI/Anthropic 风格 key", /\b(?:sk|sk-ant|sk-proj)-[A-Za-z0-9_-]{16,}/],
	["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
	["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
	["Bearer 头", /\bbearer\s+[A-Za-z0-9._~+/-]{20,}/i],
	["password= / pwd=", /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S{6,}/i],
	["连接串带凭据", /\b[a-z]+:\/\/[^\s:@/]+:[^\s@/]{6,}@/i],
	["长十六进制串", /\b[0-9a-f]{32,}\b/i],
];

export function redact(text) {
	const s = String(text ?? "");
	for (const [name, re] of SECRET_RULES) if (re.test(s)) return { hit: name };
	return { hit: null };
}

/**
 * 删除指纹：归一化词条集合。删掉的记忆进黑名单，自动抽取再次写入前先比一次，
 * 相似度超阈值就丢弃（否则删了又被对话抓回来）。
 */
export function fingerprint(content) {
	return tokenize(content).sort().slice(0, 160);
}

export function jaccard(a, b) {
	const A = new Set(a ?? []);
	const B = new Set(b ?? []);
	if (!A.size && !B.size) return 1;
	let inter = 0;
	for (const x of A) if (B.has(x)) inter += 1;
	return inter / (A.size + B.size - inter);
}

/** 黑名单命中：同类型同范围且词条相似度过阈值。 */
export function hitsBlacklist(entry, list, threshold = 0.8) {
	const fp = fingerprint(entry?.content ?? "");
	for (const item of list ?? []) {
		if (item?.type && entry?.type && item.type !== entry.type) continue;
		if (item?.scopeKey && entry?.scopeKey && item.scopeKey !== entry.scopeKey) continue;
		if (jaccard(fp, item.fp ?? []) >= threshold) return true;
	}
	return false;
}

/** 写入归一化：把工具/界面传来的对象修成一条合法记录（未给 id 时由调用方补）。 */
export function normalizeRecord(raw, nowMs = Date.now()) {
	const r = raw && typeof raw === "object" ? raw : {};
	const type = TYPES.includes(r.type) ? r.type : "pitfall";
	const content = String(r.content ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 400);
	const excerpt = String(r.excerpt ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 2000);
	const tags = (Array.isArray(r.tags) ? r.tags : [])
		.map((t) =>
			String(t ?? "")
				.trim()
				.slice(0, 24),
		)
		.filter(Boolean)
		.slice(0, 8);
	const created = Number(r.createdAt) || nowMs;
	return {
		id: String(r.id ?? ""),
		type,
		scope: SCOPES.includes(r.scope) ? r.scope : "project",
		scopeKey: String(r.scopeKey ?? "global").slice(0, 120),
		content,
		excerpt,
		tags,
		importance: clampInt(r.importance, 1, 5, type === "pitfall" || type === "decision" ? 4 : 3),
		source: {
			conversationId: r.source?.conversationId ? String(r.source.conversationId).slice(0, 80) : undefined,
			file: r.source?.file ? String(r.source.file).slice(0, 400) : undefined,
			runId: r.source?.runId ? String(r.source.runId).slice(0, 80) : undefined,
			kind: ["user", "agent", "auto", "import"].includes(r.source?.kind) ? r.source.kind : "agent",
		},
		createdAt: created,
		updatedAt: Number(r.updatedAt) || created,
		lastUsedAt: Number(r.lastUsedAt) || created,
		useCount: Math.max(0, Math.round(Number(r.useCount) || 0)),
		strength: Number.isFinite(Number(r.strength)) ? Math.max(0, Number(r.strength)) : 1,
		validFrom: Number(r.validFrom) || created,
		validUntil: Number(r.validUntil) || 0,
		supersededBy: r.supersededBy ? String(r.supersededBy).slice(0, 64) : null,
		pinned: r.pinned === true,
		quarantined: r.quarantined === true,
		feedback: {
			pos: Math.max(0, Math.round(Number(r.feedback?.pos) || 0)),
			neg: Math.max(0, Math.round(Number(r.feedback?.neg) || 0)),
		},
	};
}
