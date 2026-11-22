/**
 * P0 可观测性：事件流 + 每条聚合统计。
 *
 * 设计约束（见 .review/plan-pages-v4.md §6）：
 *   - events 是**可丢弃的诊断数据**：按天一个文件，单文件超过上限滚到 `.2`/`.3`，
 *     只保留 N 天。滚动与清理都挂在 append 路径上（写入前查大小、每 N 次扫一次目录），
 *     不引入任何定时器。
 *   - stats.json 是**长期唯一真源**：append 时同步累加，永不用 events 重算覆盖
 *     （events 只留 30 天，重算会把更早的计数清零，而淘汰判据依赖长期计数）。
 *   - 不记内容，只记 id / 工具名 / 事件类型 —— 事件文件随库增长，必须能安全分享。
 *
 * 事件行：{at, ev, id?, n?, src?, conv, turn}
 *   ev: turn(每轮一条) | call(工具调用) | hint(注入) | search(检索命中) |
 *       read(显式读) | use(被证实用上) | ignore(推了没用) | lint(体检)
 */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
	renameSync,
} from "node:fs";
import { join } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

export function createObserver({
	dataDir,
	keepDays = 30,
	maxBytes = 5 * 1024 * 1024,
	pruneEvery = 20,
	now = () => Date.now(),
	log = () => {},
} = {}) {
	const eventsDir = join(dataDir, "events");
	const statsFile = join(dataDir, "stats.json");
	/** @type {Record<string, {hint:number,search:number,read:number,used:number,ignored:number,lastHit:number|null,lastUse:number|null,lastIgnore:number|null}>} */
	let stats = {};
	let appends = 0;
	/** 每个会话当前轮次（run_start 递增），让 (id, turn) 能对齐。 */
	const turns = new Map();
	let dirty = false;

	function ensureDir() {
		try {
			mkdirSync(eventsDir, { recursive: true });
		} catch (err) {
			log("warn", `事件目录不可建：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	function loadStats() {
		try {
			const raw = JSON.parse(readFileSync(statsFile, "utf8"));
			if (raw && typeof raw === "object" && raw.records && typeof raw.records === "object") stats = raw.records;
		} catch {
			/* 没有或坏掉 → 空表；不拿空表盖回去，第一次写入时才落盘 */
		}
	}

	function persistStats() {
		if (!dirty) return;
		const tmp = `${statsFile}.tmp`;
		try {
			writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: now(), records: stats }), "utf8");
			renameSync(tmp, statsFile);
			dirty = false;
		} catch (err) {
			log("warn", `统计落盘失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** 滚动：当前日文件超上限就换 `.2`、`.3`…（按天 + 按体积极少同时触发，够用）。 */
	function currentFile(at) {
		const base = join(eventsDir, `${dayKey(at)}.jsonl`);
		if (!existsSync(base) || statSync(base).size < maxBytes) return base;
		for (let n = 2; n < 1000; n++) {
			const next = join(eventsDir, `${dayKey(at)}.${n}.jsonl`);
			if (!existsSync(next) || statSync(next).size < maxBytes) return next;
		}
		return base;
	}

	function prune(at) {
		let names = [];
		try {
			names = readdirSync(eventsDir);
		} catch {
			return;
		}
		const cutoff = at - keepDays * DAY_MS;
		for (const name of names) {
			const m = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/.exec(name);
			if (!m) continue;
			const day = Date.parse(`${m[1]}T00:00:00Z`);
			if (!Number.isFinite(day) || day >= cutoff) continue;
			try {
				unlinkSync(join(eventsDir, name));
			} catch {
				/* 删不掉就算了，下次再试 */
			}
		}
	}

	function emit(evt) {
		const at = now();
		const line = JSON.stringify({ at, ...evt });
		try {
			ensureDir();
			appendFileSync(currentFile(at), `${line}\n`, "utf8");
			appends += 1;
			if (appends % pruneEvery === 0) prune(at);
		} catch (err) {
			log("warn", `事件写入失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	function bump(id, field, at) {
		if (!id) return;
		const row = (stats[id] = stats[id] ?? {
			hint: 0,
			search: 0,
			read: 0,
			used: 0,
			ignored: 0,
			lastHit: null,
			lastUse: null,
			lastIgnore: null,
		});
		row[field] = (Number(row[field]) || 0) + 1;
		if (field === "hint" || field === "search" || field === "read") row.lastHit = at;
		if (field === "used") row.lastUse = at;
		if (field === "ignored") row.lastIgnore = at;
		dirty = true;
	}

	loadStats();

	return {
		/** 一轮开始：turn 递增并记一条。 */
		startTurn(conv) {
			const key = conv || "global";
			const turn = (turns.get(key) ?? 0) + 1;
			turns.set(key, turn);
			emit({ ev: "turn", conv: key, turn });
			return turn;
		},
		turnOf(conv) {
			return turns.get(conv || "global") ?? 0;
		},
		/** 工具调用（用于主动调用率）。 */
		call(toolName, conv) {
			emit({ ev: "call", n: String(toolName ?? ""), conv: conv || "global", turn: this.turnOf(conv) });
		},
		/** 记忆检索命中（一页一行）。 */
		search(ids, conv) {
			const turn = this.turnOf(conv);
			for (const id of ids ?? []) {
				emit({ ev: "search", id, conv: conv || "global", turn });
				bump(id, "search", now());
			}
		},
		/** 提醒注入（按条目逐行，一次 3 条 = 3 行同 turn）。 */
		hint(ids, conv) {
			const turn = this.turnOf(conv);
			for (const id of ids ?? []) {
				emit({ ev: "hint", id, conv: conv || "global", turn });
				bump(id, "hint", now());
			}
		},
		/** 显式读页/读条。 */
		read(id, conv) {
			emit({ ev: "read", id, conv: conv || "global", turn: this.turnOf(conv) });
			bump(id, "read", now());
		},
		/** 被证实用上（本轮后续工具参数里出现了它的绑定路径/命令）。 */
		use(id, conv) {
			emit({ ev: "use", id, conv: conv || "global", turn: this.turnOf(conv) });
			bump(id, "used", now());
		},
		/** 推了但没用。 */
		ignore(id, conv) {
			emit({ ev: "ignore", id, conv: conv || "global", turn: this.turnOf(conv) });
			bump(id, "ignored", now());
		},
		lint(summary) {
			emit({ ev: "lint", n: String(summary ?? "").slice(0, 120), conv: "global", turn: 0 });
		},
		/** 一轮结束：把统计落盘（不用 events 重算）。 */
		flush() {
			persistStats();
		},
		statsFor(id) {
			return stats[id] ?? null;
		},
		allStats() {
			return stats;
		},
		/** P0 指标：扫 events 目录现算（量小，只在手动查看时调用）。 */
		summarize({ sinceMs = 0 } = {}) {
			let names = [];
			try {
				names = readdirSync(eventsDir).sort();
			} catch {
				return { turns: 0, calls: {}, memoryCalls: 0, hint: 0, use: 0, ignore: 0, hintEffectiveness: null };
			}
			const calls = {};
			let turns = 0;
			let hint = 0;
			let use = 0;
			let ignore = 0;
			for (const name of names) {
				const m = /^(\d{4}-\d{2}-\d{2})/.exec(name);
				if (!m) continue;
				if (sinceMs && Date.parse(`${m[1]}T00:00:00Z`) + DAY_MS <= sinceMs) continue;
				let body = "";
				try {
					body = readFileSync(join(eventsDir, name), "utf8");
				} catch {
					continue;
				}
				for (const line of body.split(/\r?\n/)) {
					const s = line.trim();
					if (!s) continue;
					let e;
					try {
						e = JSON.parse(s);
					} catch {
						continue; // 半行（崩溃留下的）直接跳过
					}
					if (e.ev === "turn") turns += 1;
					else if (e.ev === "call") calls[e.n] = (calls[e.n] ?? 0) + 1;
					else if (e.ev === "hint") hint += 1;
					else if (e.ev === "use") use += 1;
					else if (e.ev === "ignore") ignore += 1;
				}
			}
			const memoryCalls = Object.entries(calls)
				.filter(([n]) => n.startsWith("memory_"))
				.reduce((sum, [, c]) => sum + c, 0);
			return {
				turns,
				calls,
				memoryCalls,
				hint,
				use,
				ignore,
				hintEffectiveness: hint > 0 ? Number((use / hint).toFixed(3)) : null,
				callRate: turns > 0 ? Number((memoryCalls / turns).toFixed(3)) : null,
			};
		},
	};
}
