/**
 * memory 视图（`client/entry.mjs`）—— 一张会变模糊的图。
 *
 * 读数据只走插件的 HTTP 路由（`/plugins-api/memory/*`）：视图挂不挂在取决于用户点不点
 * 这个视图，不能拿 mount 当命脉；HTTP 在浏览器侧任何时候都能用，多标签页也天然一致。
 * API 前缀从 bundle 自己的 URL 推（`<base>/plugins/memory/client/entry.mjs` →
 * `<base>/plugins-api/memory`），nginx 子路径反代不用额外配置。
 *
 * 视觉编码（这是本插件"遗忘"的可视化，不是装饰）：
 *   大小 = 有效强度（越淡越小）、透明度 = 强度、颜色 = 类型、
 *   灰实心点 = 作废、虚线圈 = 隔离区、金色环 = 钉住。
 * 边 4 类：共享标签 / 指向同一文件·服务 / 取代关系（双时态）/ 同一次任务产生。
 *
 * 力导向是手写的（插件 bundle 不能 import npm）：O(n²) 斥力 + 弹簧 + 中心引力，
 * 几百个节点以内足够；只在不平衡或有交互时跑 rAF，静止即停。
 */
import * as C from "./core.mjs";

/** 从 bundle URL 推 API 前缀（同 notes 的做法）。 */
function resolveApiBase(importMetaUrl) {
	const base = String(importMetaUrl);
	const idx = base.indexOf("/plugins/");
	const root = idx >= 0 ? base.slice(0, idx) : base.replace(/\/[^/]*$/, "");
	return `${root}/plugins-api/memory`;
}

const API = resolveApiBase(import.meta.url);

const TYPE_COLOR = {
	task: "#4ea1ff",
	pitfall: "#ff6b6b",
	decision: "#b98bff",
	convention: "#3ecf8e",
	fact: "#f0b429",
	glossary: "#59c2d6",
	preference: "#ff8fc8",
};

const STYLE = `
.mem-root{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#12141a);color:var(--fg,#e6e6ea);font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.mem-bar{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);flex-wrap:wrap}
.mem-bar input[type=search]{flex:1 1 200px;min-width:140px;padding:6px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:inherit;font:inherit}
.mem-bar input[type=search]:focus{outline:1px solid rgba(120,170,255,.6)}
.mem-btn{padding:5px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:inherit;font:inherit;cursor:pointer}
.mem-btn:hover{background:rgba(255,255,255,.09)}
.mem-btn.on{background:rgba(120,170,255,.22);border-color:rgba(120,170,255,.5)}
.mem-chips{display:flex;gap:4px;flex-wrap:wrap}
.mem-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;opacity:.55}
.mem-chip.on{opacity:1;background:rgba(255,255,255,.07)}
.mem-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.mem-main{position:relative;flex:1;display:flex;min-height:0}
.mem-canvas-wrap{position:relative;flex:1;min-width:0}
.mem-canvas{display:block;width:100%;height:100%;cursor:grab}
.mem-canvas.dragging{cursor:grabbing}
.mem-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;color:rgba(230,230,234,.5);pointer-events:none;text-align:center;padding:24px}
.mem-side{width:310px;flex:none;border-left:1px solid rgba(255,255,255,.08);padding:12px;overflow:auto;display:none}
.mem-side.open{display:block}
.mem-side h3{margin:0 0 6px;font-size:14px;font-weight:600}
.mem-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;color:rgba(230,230,234,.62);font-size:12px}
.mem-body{white-space:pre-wrap;word-break:break-word;background:rgba(255,255,255,.04);border-radius:8px;padding:8px 10px;margin-bottom:10px}
.mem-quote{border-left:2px solid rgba(255,255,255,.18);padding-left:8px;color:rgba(230,230,234,.7);white-space:pre-wrap;margin-bottom:10px;font-family:ui-monospace,Consolas,monospace;font-size:12px;max-height:160px;overflow:auto}
.mem-actions{display:flex;gap:6px;flex-wrap:wrap}
.mem-batchbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(120,170,255,.07)}
.mem-batchbar[hidden]{display:none}
.mem-batch-count{color:rgba(230,230,234,.7);font-size:12px;margin-right:4px}
.mem-trash{position:absolute;inset:0;overflow:auto;padding:14px 16px;display:none}
.mem-trash.open{display:block}
.mem-trash-head{display:flex;gap:10px;align-items:center;margin-bottom:10px;color:rgba(230,230,234,.8);font-size:13px;font-weight:600}
.mem-trash-row{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:8px}
.mem-trash-main{flex:1;min-width:0}
.mem-trash-text{word-break:break-word}
.mem-trash-meta{color:rgba(230,230,234,.55);font-size:12px;margin-top:2px}
.mem-edit{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.mem-edit label{font-size:12px;color:rgba(230,230,234,.6)}
.mem-edit textarea,.mem-edit select,.mem-edit input{padding:6px 8px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:inherit;font:inherit;width:100%;box-sizing:border-box}
.mem-edit textarea{min-height:76px;resize:vertical}
.mem-edit-row{display:flex;gap:6px}
.mem-drop{color:rgba(230,230,234,.45);font-size:12px;text-align:center;padding:20px}
.mem-bar-note{color:rgba(230,230,234,.55);font-size:12px}
.mem-strength{height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden;margin-bottom:10px}
.mem-strength > i{display:block;height:100%;background:linear-gradient(90deg,#4ea1ff,#3ecf8e)}
`;

function ensureStyles() {
	const id = "ccui-memory-style";
	if (document.getElementById(id)) return;
	const s = document.createElement("style");
	s.id = id;
	s.textContent = STYLE;
	document.head.appendChild(s);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** 建边：4 类关系，去重、限量（避免高标签量的节点把图连成毛线球）。 */
function buildEdges(records) {
	const edges = [];
	const seen = new Set();
	const push = (a, b, kind, w) => {
		if (!a || !b || a === b) return;
		const key = a < b ? `${a}|${b}|${kind}` : `${b}|${a}|${kind}`;
		if (seen.has(key)) return;
		seen.add(key);
		edges.push({ a, b, kind, w });
	};
	const byId = new Map(records.map((r) => [r.id, r]));

	// 取代关系（双时态）：新旧之间连一条，方向仍按 supersededBy 记在数据里
	for (const r of records) {
		if (r.supersededBy && byId.has(r.supersededBy)) push(r.id, r.supersededBy, "supersede", 1.6);
	}
	// 指向同一文件/服务（tags 里的路径或点号条目）
	const byTag = new Map();
	for (const r of records) {
		for (const t of r.tags ?? []) {
			if (!(t.includes("/") || t.includes("\\") || t.includes("."))) continue;
			let list = byTag.get(t);
			if (!list) byTag.set(t, (list = []));
			list.push(r.id);
		}
	}
	for (const [tag, ids] of byTag) {
		const cap = ids.slice(0, 6);
		for (let i = 0; i < cap.length; i++) for (let j = i + 1; j < cap.length; j++) push(cap[i], cap[j], "file", 1.0);
		void tag;
	}
	// 同一次任务产生 / 同类型共享普通标签
	const byConv = new Map();
	for (const r of records) {
		const conv = r.source?.conversationId;
		if (!conv) continue;
		let list = byConv.get(conv);
		if (!list) byConv.set(conv, (list = []));
		list.push(r.id);
	}
	for (const ids of byConv.values()) {
		const cap = ids.slice(0, 6);
		for (let i = 0; i < cap.length; i++) for (let j = i + 1; j < cap.length; j++) push(cap[i], cap[j], "task", 0.7);
	}
	const byTypeTag = new Map();
	for (const r of records) {
		for (const t of r.tags ?? []) {
			if (t.includes("/") || t.includes("\\") || t.includes(".")) continue;
			const key = `${r.type}:${t}`;
			let list = byTypeTag.get(key);
			if (!list) byTypeTag.set(key, (list = []));
			list.push(r.id);
		}
	}
	for (const ids of byTypeTag.values()) {
		const cap = ids.slice(0, 5);
		for (let i = 0; i < cap.length; i++) for (let j = i + 1; j < cap.length; j++) push(cap[i], cap[j], "tag", 0.5);
	}
	return edges;
}

export default {
	mount(el, ctx) {
		ensureStyles();
		const root = document.createElement("div");
		root.className = "mem-root";
		root.innerHTML = `
			<div class="mem-bar">
				<button class="mem-btn" data-act="back" title="回到对话（再点左栏「记忆」也能收起）">← 对话</button>
				<input type="search" placeholder="搜记忆（高亮命中，其余压暗）" />
				<div class="mem-chips"></div>
				<button class="mem-btn" data-act="scope" title="只看当前项目，还是看全部项目">当前项目</button>
				<button class="mem-btn" data-act="faded" title="是否显示已经淡出/作废的点">含淡出</button>
				<button class="mem-btn" data-act="new" title="手动新建一条记忆">＋ 新建</button>
				<button class="mem-btn" data-act="batch" title="批量：点节点多选，然后一起作废/删除">批量</button>
				<button class="mem-btn" data-act="housekeep" title="整理：合并近重复 + 把指向已删文件的记忆作废">整理</button>
				<button class="mem-btn" data-act="quarantine" title="隔离区：自动记下但还没被用上的记忆">隔离区</button>
				<button class="mem-btn" data-act="trash" title="回收站：删掉的先进这里 30 天，可恢复">回收站</button>
				<button class="mem-btn" data-act="export" title="导出整库 JSON">导出</button>
				<span class="mem-bar-note"></span>
			</div>
			<div class="mem-batchbar" hidden>
				<span class="mem-batch-count"></span>
				<button class="mem-btn" data-batch="all">全选当前筛选</button>
				<button class="mem-btn" data-batch="clear">清空选择</button>
				<button class="mem-btn" data-batch="invalidate">作废所选</button>
				<button class="mem-btn" data-batch="delete">删除所选</button>
				<button class="mem-btn" data-batch="pin">钉住所选</button>
			</div>
			<div class="mem-main">
				<div class="mem-canvas-wrap">
					<canvas class="mem-canvas"></canvas>
					<div class="mem-trash"></div>
					<div class="mem-empty" hidden></div>
				</div>
				<aside class="mem-side"></aside>
			</div>`;
		el.appendChild(root);

		const $ = (sel) => root.querySelector(sel);
		const canvas = $(".mem-canvas");
		const wrap = $(".mem-canvas-wrap");
		const side = $(".mem-side");
		const empty = $(".mem-empty");
		const note = $(".mem-bar-note");
		const searchInput = $('input[type="search"]');
		const g = canvas.getContext("2d");

		const state = {
			records: [],
			now: Date.now(),
			query: "",
			types: new Set(),
			allProjects: false,
			showFaded: false,
			listMode: null, // null | "trash" | "quarantine"
			trash: [],
			batch: false,
			picked: new Set(),
			creating: false,
			selected: null,
			hover: null,
		};
		let nodes = [];
		let edges = [];
		let sim = { alpha: 0 };
		let view = { x: 0, y: 0, k: 1 };
		let raf = 0;
		let disposed = false;

		// ---------------------------------------------------------------- 数据
		async function load() {
			try {
				const res = await fetch(`${API}/store`, { headers: { accept: "application/json" } });
				const data = await res.json();
				if (!data?.ok) throw new Error(data?.error ?? "读取失败");
				state.records = Array.isArray(data.records) ? data.records : [];
				state.trash = Array.isArray(data.trash) ? data.trash : [];
				state.now = data.now ?? Date.now();
				// 选中的条目可能刚被删除/作废：先剔掉失效 id，免得批量条还显示“已选 3”
				if (state.picked.size) {
					const alive = new Set(state.records.map((r) => r.id));
					for (const id of [...state.picked]) if (!alive.has(id)) state.picked.delete(id);
				}
				rebuild();
				updateListButtons();
				if (state.listMode) renderList();
				updateBatchBar();
			} catch (err) {
				note.textContent = `读取失败：${err instanceof Error ? err.message : String(err)}`;
			}
		}

		async function op(body) {
			try {
				const res = await fetch(`${API}/op`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				const data = await res.json();
				if (data?.text) note.textContent = data.text;
				await load();
				// 选中的那条可能刚被删掉：还在就刷新详情，没了就收起侧栏
				if (state.selected) {
					if (state.records.some((r) => r.id === state.selected.id)) renderSide();
					else select(null);
				}
			} catch (err) {
				note.textContent = `操作失败：${err instanceof Error ? err.message : String(err)}`;
			}
		}

		function currentProject() {
			// 服务端按 cwd 归一算 scopeKey；前端只需要知道"当前项目"的那一串是哪个，
			// 由记录里的 scopeKey 频率推（同一个项目下的记忆共用同一个 key）。
			const counts = new Map();
			for (const r of state.records) {
				if (r.scope !== "project") continue;
				counts.set(r.scopeKey, (counts.get(r.scopeKey) ?? 0) + 1);
			}
			let best = "";
			let max = -1;
			for (const [k, n] of counts) {
				if (n > max) {
					max = n;
					best = k;
				}
			}
			return best;
		}

		function visibleRecords() {
			const project = currentProject();
			return state.records.filter((r) => {
				if (!state.allProjects && r.scope === "project" && project && r.scopeKey !== project) return false;
				if (state.types.size && !state.types.has(r.type)) return false;
				const invalid = r.invalidated === true || (r.validUntil > 0 && r.validUntil <= state.now);
				if (invalid && !state.showFaded) return false;
				if (!state.showFaded && (r.effStrength ?? 1) < 0.15 && !r.pinned) return false;
				return true;
			});
		}

		function rebuild() {
			const keep = new Map(nodes.map((n) => [n.id, n]));
			const recs = visibleRecords();
			nodes = recs.map((r, i) => {
				const old = keep.get(r.id);
				const strength = clamp(Number(r.effStrength ?? 1), 0, 5);
				const rt = C.TYPE_LABEL[r.type] ?? r.type;
				return {
					id: r.id,
					rec: r,
					label: rt,
					r: (r.invalidated ? 4 : 5) + 9 * Math.sqrt(Math.min(strength, 4) / 4),
					x: old?.x ?? Math.cos((i / Math.max(1, recs.length)) * Math.PI * 2) * 180,
					y: old?.y ?? Math.sin((i / Math.max(1, recs.length)) * Math.PI * 2) * 180,
					vx: 0,
					vy: 0,
				};
			});
			edges = buildEdges(recs);
			sim.alpha = 1;
			renderChips();
			updateEmpty();
			if (nodes.length && !view.settled) {
				view = { x: 0, y: 0, k: 1 };
				view.settled = true;
			}
			tick();
		}

		function updateEmpty() {
			const none = nodes.length === 0;
			empty.hidden = !none;
			if (none) {
				empty.textContent = state.records.length
					? "当前筛选下没有记忆。"
					: "还没有记忆。AI 遇到坑、做了有理由的决定、确认了约定时会记下来；你也可以让它「记一下……」。";
			}
		}

		/** 两个列表按钮上的条数（没有就不显示数字）。 */
		function updateListButtons() {
			const t = root.querySelector('[data-act="trash"]');
			if (t) t.textContent = state.trash.length ? `回收站 ${state.trash.length}` : "回收站";
			const q = root.querySelector('[data-act="quarantine"]');
			const n = state.records.filter((r) => r.quarantined && !r.invalidated).length;
			if (q) q.textContent = n ? `隔离区 ${n}` : "隔离区";
		}

		/**
		 * 列表视图：回收站（可恢复/彻底删）与隔离区（升级/删除）共用一套。
		 * 打开时藏起画布，避免两种交互混在一起。
		 */
		function renderList() {
			const box = $(".mem-trash");
			const mode = state.listMode;
			if (!mode) {
				box.classList.remove("open");
				box.innerHTML = "";
				canvas.style.display = "";
				updateEmpty();
				return;
			}
			box.classList.add("open");
			canvas.style.display = "none";
			empty.hidden = true;
			const now = Date.now();

			if (mode === "trash") {
				if (!state.trash.length) {
					box.innerHTML = `<div class="mem-drop">回收站是空的。删除的记忆会先来这里躺 30 天，期间可以恢复。</div>`;
					return;
				}
				box.innerHTML =
					`<div class="mem-trash-head">回收站 · ${state.trash.length} 条<button class="mem-btn" data-list="empty">清空</button></div>` +
					state.trash
						.map((t) => {
							const left = Math.max(0, Math.ceil(((Number(t.expiresAt) || 0) - now) / 86400000));
							return `<div class="mem-trash-row">
								<div class="mem-trash-main">
									<div class="mem-trash-text">${escapeHtml(t.content ?? "")}</div>
									<div class="mem-trash-meta">${escapeHtml(C.TYPE_LABEL[t.type] ?? t.type ?? "")} · 还剩 ${left} 天 · ${escapeHtml(C.relTime(t.deletedAt, now))}删除</div>
								</div>
								<button class="mem-btn" data-list="restore" data-id="${escapeHtml(t.id)}">恢复</button>
								<button class="mem-btn" data-list="purge" data-id="${escapeHtml(t.id)}">彻底删除</button>
							</div>`;
						})
						.join("");
			} else {
				const list = state.records.filter((r) => r.quarantined && !r.invalidated);
				if (!list.length) {
					box.innerHTML = `<div class="mem-drop">隔离区是空的。自动记下来的东西会先待在这里，被你或 AI 用上之后才升级为正式记忆。</div>`;
					return;
				}
				box.innerHTML =
					`<div class="mem-trash-head">隔离区 · ${list.length} 条<button class="mem-btn" data-list="upgrade-all">全部升级</button></div>` +
					list
						.map(
							(r) => `<div class="mem-trash-row">
								<div class="mem-trash-main">
									<div class="mem-trash-text">${escapeHtml(r.content ?? "")}</div>
									<div class="mem-trash-meta">${escapeHtml(C.TYPE_LABEL[r.type] ?? r.type ?? "")} · 重要 ${r.importance}/5 · ${escapeHtml(C.relTime(r.updatedAt ?? r.createdAt, now))}</div>
								</div>
								<button class="mem-btn" data-list="upgrade" data-id="${escapeHtml(r.id)}">升级</button>
								<button class="mem-btn" data-list="del" data-id="${escapeHtml(r.id)}">删除</button>
							</div>`,
						)
						.join("");
			}

			box.querySelectorAll("[data-list]").forEach((btn) => {
				btn.onclick = () => {
					const kind = btn.dataset.list;
					const id = btn.dataset.id;
					if (kind === "empty") return void op({ op: "empty-trash" });
					if (kind === "restore") return void op({ op: "restore", id });
					if (kind === "purge") return void op({ op: "purge", id });
					if (kind === "upgrade") return void op({ op: "quarantine", id, on: false });
					if (kind === "upgrade-all")
						return void op({
							op: "bulk",
							action: "unquarantine",
							ids: state.records.filter((r) => r.quarantined && !r.invalidated).map((r) => r.id),
						});
					if (kind === "del") return void op({ op: "delete", id });
				};
			});
		}

		function renderChips() {
			const chips = $(".mem-chips");
			const counts = new Map();
			for (const r of state.records) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
			chips.innerHTML = "";
			for (const t of C.TYPES) {
				const n = counts.get(t) ?? 0;
				if (!n) continue;
				const b = document.createElement("button");
				b.className = `mem-chip${state.types.has(t) ? " on" : ""}`;
				b.innerHTML = `<span class="mem-dot" style="background:${TYPE_COLOR[t]}"></span>${C.TYPE_LABEL[t]} ${n}`;
				b.onclick = () => {
					if (state.types.has(t)) state.types.delete(t);
					else state.types.add(t);
					rebuild();
				};
				chips.appendChild(b);
			}
		}

		// ---------------------------------------------------------------- 物理
		function tick() {
			if (disposed) return;
			const steps = sim.alpha > 0.05 ? 2 : 1;
			for (let s = 0; s < steps; s++) step();
			draw();
			if (sim.alpha > 0.005) {
				sim.alpha *= 0.985;
				raf = requestAnimationFrame(tick);
			} else {
				sim.alpha = 0;
				raf = 0;
			}
		}

		function step() {
			const n = nodes.length;
			if (!n) return;
			const alpha = sim.alpha;
			// 斥力
			for (let i = 0; i < n; i++) {
				const a = nodes[i];
				for (let j = i + 1; j < n; j++) {
					const b = nodes[j];
					let dx = b.x - a.x;
					let dy = b.y - a.y;
					let d2 = dx * dx + dy * dy;
					if (d2 < 1) {
						dx = Math.random() - 0.5;
						dy = Math.random() - 0.5;
						d2 = 1;
					}
					const d = Math.sqrt(d2);
					const f = (2600 * alpha) / d2;
					const fx = (dx / d) * f;
					const fy = (dy / d) * f;
					a.vx -= fx;
					a.vy -= fy;
					b.vx += fx;
					b.vy += fy;
				}
			}
			// 弹簧
			const byId = new Map(nodes.map((x) => [x.id, x]));
			for (const e of edges) {
				const a = byId.get(e.a);
				const b = byId.get(e.b);
				if (!a || !b) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d = Math.max(1, Math.hypot(dx, dy));
				const rest = 70 + a.r + b.r;
				const f = ((d - rest) / d) * 0.08 * e.w * alpha;
				const fx = dx * f;
				const fy = dy * f;
				a.vx += fx;
				a.vy += fy;
				b.vx -= fx;
				b.vy -= fy;
			}
			// 中心引力 + 阻尼
			for (const p of nodes) {
				if (p === dragNode) continue;
				p.vx -= p.x * 0.0016 * alpha;
				p.vy -= p.y * 0.0016 * alpha;
				p.vx *= 0.82;
				p.vy *= 0.82;
				p.x += p.vx;
				p.y += p.vy;
			}
		}

		// ---------------------------------------------------------------- 绘制
		function highlightSet() {
			const q = state.query.trim();
			if (!q) return null;
			const terms = C.tokenize(q);
			if (!terms.length) return null;
			const out = new Set();
			for (const node of nodes) {
				const hay = C.tokenize(`${node.rec.content} ${node.rec.excerpt ?? ""} ${(node.rec.tags ?? []).join(" ")}`);
				const set = new Set(hay);
				if (terms.every((t) => set.has(t))) out.add(node.id);
			}
			return out;
		}

		function draw() {
			const dpr = window.devicePixelRatio || 1;
			const w = wrap.clientWidth;
			const h = wrap.clientHeight;
			if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
				canvas.width = Math.floor(w * dpr);
				canvas.height = Math.floor(h * dpr);
			}
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			g.clearRect(0, 0, w, h);
			g.save();
			g.translate(w / 2 + view.x, h / 2 + view.y);
			g.scale(view.k, view.k);

			const hit = highlightSet();
			const dimmed = (id) => hit && !hit.has(id);

			// 边
			const byId = new Map(nodes.map((x) => [x.id, x]));
			for (const e of edges) {
				const a = byId.get(e.a);
				const b = byId.get(e.b);
				if (!a || !b) continue;
				const dim = dimmed(a.id) && dimmed(b.id);
				g.strokeStyle = e.kind === "supersede" ? "rgba(255,255,255,.34)" : "rgba(255,255,255,.13)";
				if (e.kind === "supersede") g.setLineDash([4, 3]);
				g.lineWidth = (e.kind === "supersede" ? 1.4 : 1) / view.k;
				g.globalAlpha = dim ? 0.25 : 0.9;
				g.beginPath();
				g.moveTo(a.x, a.y);
				g.lineTo(b.x, b.y);
				g.stroke();
				g.setLineDash([]);
			}
			g.globalAlpha = 1;

			// 节点
			for (const p of nodes) {
				const rec = p.rec;
				const invalid = rec.invalidated === true || (rec.validUntil > 0 && rec.validUntil <= state.now);
				const strength = clamp(Number(rec.effStrength ?? 1), 0, 5);
				const alpha = invalid ? 0.42 : clamp(0.35 + 0.65 * Math.min(1, strength), 0.25, 1);
				const baseColor = invalid ? "#6b6f78" : (TYPE_COLOR[rec.type] ?? "#8a8f98");
				g.globalAlpha = dimmed(p.id) && p !== state.hover && p !== state.selected ? alpha * 0.22 : alpha;
				g.beginPath();
				g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
				g.fillStyle = baseColor;
				g.fill();
				if (rec.quarantined) {
					g.setLineDash([3, 3]);
					g.strokeStyle = "rgba(255,255,255,.55)";
					g.lineWidth = 1.2 / view.k;
					g.beginPath();
					g.arc(p.x, p.y, p.r + 3, 0, Math.PI * 2);
					g.stroke();
					g.setLineDash([]);
				}
				if (rec.pinned) {
					g.strokeStyle = "#f5c451";
					g.lineWidth = 1.8 / view.k;
					g.beginPath();
					g.arc(p.x, p.y, p.r + 2.5, 0, Math.PI * 2);
					g.stroke();
				}
				if (state.batch && state.picked.has(p.id)) {
					g.strokeStyle = "#7aa2ff";
					g.lineWidth = 2 / view.k;
					g.setLineDash([4 / view.k, 3 / view.k]);
					g.beginPath();
					g.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
					g.stroke();
					g.setLineDash([]);
				}
				if (p === state.selected || p === state.hover) {
					g.strokeStyle = "rgba(255,255,255,.85)";
					g.lineWidth = 1.6 / view.k;
					g.beginPath();
					g.arc(p.x, p.y, p.r + 4.5, 0, Math.PI * 2);
					g.stroke();
				}
				// 标签：够大、或选中/悬停时才画（避免噪声）
				if (p.r > 11 || p === state.selected || p === state.hover || (hit && hit.has(p.id))) {
					g.globalAlpha = invalid ? 0.5 : 0.9;
					g.fillStyle = "rgba(235,238,245,.92)";
					g.font = `${11 / view.k}px system-ui,-apple-system,"Segoe UI",sans-serif`;
					g.textAlign = "center";
					g.textBaseline = "top";
					const text = rec.content.length > 22 ? `${rec.content.slice(0, 22)}…` : rec.content;
					g.fillText(text, p.x, p.y + p.r + 4 / view.k);
				}
			}
			g.globalAlpha = 1;
			g.restore();
		}

		// ---------------------------------------------------------------- 交互
		function nodeAt(clientX, clientY) {
			const rect = canvas.getBoundingClientRect();
			const wx = (clientX - rect.left - rect.width / 2 - view.x) / view.k;
			const wy = (clientY - rect.top - rect.height / 2 - view.y) / view.k;
			let best = null;
			let bestD = Infinity;
			for (const p of nodes) {
				const d = Math.hypot(p.x - wx, p.y - wy);
				if (d <= p.r + 6 / view.k && d < bestD) {
					best = p;
					bestD = d;
				}
			}
			return best;
		}

		let dragNode = null;
		let panFrom = null;

		canvas.addEventListener("pointerdown", (ev) => {
			const p = nodeAt(ev.clientX, ev.clientY);
			if (p) {
				dragNode = p;
				p.fixed = true;
			} else {
				panFrom = { x: ev.clientX - view.x, y: ev.clientY - view.y };
				canvas.classList.add("dragging");
			}
			canvas.setPointerCapture(ev.pointerId);
		});
		canvas.addEventListener("pointermove", (ev) => {
			if (dragNode) {
				const rect = canvas.getBoundingClientRect();
				dragNode.x = (ev.clientX - rect.left - rect.width / 2 - view.x) / view.k;
				dragNode.y = (ev.clientY - rect.top - rect.height / 2 - view.y) / view.k;
				dragNode.vx = 0;
				dragNode.vy = 0;
				sim.alpha = Math.max(sim.alpha, 0.35);
				if (!raf) tick();
				return;
			}
			if (panFrom) {
				view.x = ev.clientX - panFrom.x;
				view.y = ev.clientY - panFrom.y;
				draw();
				return;
			}
			const p = nodeAt(ev.clientX, ev.clientY);
			if (p !== state.hover) {
				state.hover = p;
				draw();
			}
		});
		canvas.addEventListener("pointerup", (ev) => {
			const wasPan = !!panFrom;
			const target = dragNode;
			dragNode = null;
			panFrom = null;
			canvas.classList.remove("dragging");
			canvas.releasePointerCapture?.(ev.pointerId);
			if (!wasPan) select(target ? target.id : null);
		});
		canvas.addEventListener("wheel", (ev) => {
			ev.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const mx = ev.clientX - rect.left - rect.width / 2;
			const my = ev.clientY - rect.top - rect.height / 2;
			const before = view.k;
			const next = clamp(view.k * (ev.deltaY < 0 ? 1.1 : 0.9), 0.25, 3);
			view.x = mx - ((mx - view.x) * next) / before;
			view.y = my - ((my - view.y) * next) / before;
			view.k = next;
			draw();
		});

		function select(id) {
			if (state.batch) {
				if (id) togglePick(id);
				return;
			}
			state.selected = id ? (nodes.find((n) => n.id === id) ?? null) : null;
			renderSide();
			draw();
		}

		function togglePick(id) {
			if (state.picked.has(id)) state.picked.delete(id);
			else state.picked.add(id);
			updateBatchBar();
			draw();
		}

		function updateBatchBar() {
			const bar = root.querySelector(".mem-batchbar");
			if (!bar) return;
			bar.hidden = !state.batch;
			const n = state.picked.size;
			bar.querySelector(".mem-batch-count").textContent = n ? `已选 ${n} 条` : "批量模式：点节点多选";
			bar.querySelectorAll("[data-batch]").forEach((b) => {
				const need = b.dataset.batch !== "all" && b.dataset.batch !== "clear";
				b.disabled = need && n === 0;
			});
		}

		/** 手动新建：表单直接落在右侧详情位，不弹模态。 */
		function renderCreate() {
			side.classList.add("open");
			side.innerHTML = `
				<h3>新建记忆</h3>
				<div class="mem-edit">
					<label>正文（一句话说清：什么情况下会需要它）</label>
					<textarea data-new="content" placeholder="例：迁移前必须先停服务，否则锁表"></textarea>
					<div class="mem-edit-row">
						<select data-new="type">${C.TYPES.map((t) => `<option value="${t}"${t === "pitfall" ? " selected" : ""}>${escapeHtml(C.TYPE_LABEL[t] ?? t)}</option>`).join("")}</select>
						<select data-new="importance">${[1, 2, 3, 4, 5].map((i) => `<option value="${i}"${i === 4 ? " selected" : ""}>重要 ${i}</option>`).join("")}</select>
						<select data-new="scope">
							<option value="project" selected>本项目</option>
							<option value="global">全局</option>
							<option value="task">当前任务</option>
						</select>
					</div>
					<label>原话片段（可选，报错原文/命令原文）</label>
					<textarea data-new="excerpt" style="min-height:52px"></textarea>
					<input data-new="tags" placeholder="标签（逗号分隔，可写文件路径）" />
				</div>
				<div class="mem-actions">
					<button class="mem-btn" data-new-act="save">保存</button>
					<button class="mem-btn" data-new-act="cancel">取消</button>
				</div>`;
			const q = (sel) => side.querySelector(sel);
			q('[data-new-act="cancel"]').onclick = () => {
				state.creating = false;
				renderSide();
			};
			q('[data-new-act="save"]').onclick = () => {
				const content = String(q("[data-new=content]")?.value ?? "").trim();
				if (!content) {
					note.textContent = "正文不能为空";
					return;
				}
				void op({
					op: "write",
					type: String(q("[data-new=type]")?.value ?? "pitfall"),
					scope: String(q("[data-new=scope]")?.value ?? "project"),
					importance: Number(q("[data-new=importance]")?.value ?? 4),
					content,
					excerpt: String(q("[data-new=excerpt]")?.value ?? "").trim(),
					tags: String(q("[data-new=tags]")?.value ?? "")
						.split(",")
						.map((t) => t.trim())
						.filter(Boolean),
				}).then(() => {
					state.creating = false;
					renderSide();
				});
			};
			q("[data-new=content]").focus();
		}

		function renderSide() {
			if (state.creating) return renderCreate();
			const p = state.selected;
			if (!p) {
				side.classList.remove("open");
				side.innerHTML = "";
				return;
			}
			const r = p.rec;
			const strength = clamp(Number(r.effStrength ?? 1), 0, 5);
			const invalid = r.invalidated === true || (r.validUntil > 0 && r.validUntil <= state.now);
			side.classList.add("open");
			side.innerHTML = `
				<h3>${escapeHtml(C.TYPE_LABEL[r.type] ?? r.type)}${invalid ? " · 已作废" : ""}${r.quarantined ? " · 隔离区" : ""}</h3>
				<div class="mem-meta">
					<span>${escapeHtml(r.scope === "global" ? "全局" : r.scope === "task" ? "任务" : "项目")}</span>
					<span>重要 ${r.importance}/5</span>
					<span>${escapeHtml(C.relTime(r.updatedAt ?? r.createdAt, Date.now()))}</span>
					${r.source?.kind ? `<span>来源 ${escapeHtml(r.source.kind)}</span>` : ""}
				</div>
				<div class="mem-strength" title="有效强度 ${strength.toFixed(2)}"><i style="width:${Math.round(clamp(strength / 4, 0, 1) * 100)}%"></i></div>
				<div class="mem-edit">
					<label>正文（改完点保存）</label>
					<textarea data-edit="content">${escapeHtml(r.content)}</textarea>
					<div class="mem-edit-row">
						<select data-edit="type">${C.TYPES.map((t) => `<option value="${t}"${t === r.type ? " selected" : ""}>${escapeHtml(C.TYPE_LABEL[t] ?? t)}</option>`).join("")}</select>
						<select data-edit="importance">${[1, 2, 3, 4, 5].map((i) => `<option value="${i}"${i === Number(r.importance) ? " selected" : ""}>重要 ${i}</option>`).join("")}</select>
					</div>
					<input data-edit="tags" placeholder="标签（逗号分隔）" value="${escapeHtml((r.tags ?? []).join(", "))}" />
					<button class="mem-btn" data-op="save">保存修改</button>
				</div>
				${r.excerpt ? `<div class="mem-quote">${escapeHtml(r.excerpt)}</div>` : ""}
				<div class="mem-actions">
					<button class="mem-btn" data-op="pin">${r.pinned ? "取消钉住" : "钉住"}</button>
					<button class="mem-btn" data-op="pos">有用</button>
					<button class="mem-btn" data-op="neg">没用</button>
					${invalid ? `<button class="mem-btn" data-op="restore">恢复</button>` : `<button class="mem-btn" data-op="invalidate">作废</button>`}
					<button class="mem-btn" data-op="delete">删除</button>
				</div>`;
			side.querySelectorAll("[data-op]").forEach((btn) => {
				btn.onclick = () => {
					const opName = btn.dataset.op;
					if (opName === "pin") return void op({ op: "update", id: r.id, pinned: !r.pinned });
					if (opName === "pos" || opName === "neg") return void op({ op: "feedback", id: r.id, kind: opName });
					if (opName === "restore") return void op({ op: "restore", id: r.id });
					if (opName === "invalidate") return void op({ op: "invalidate", id: r.id });
					if (opName === "delete") return void op({ op: "delete", id: r.id });
					if (opName === "save") {
						const q = (sel) => side.querySelector(sel);
						const content = String(q("[data-edit=content]")?.value ?? "").trim();
						if (!content) {
							note.textContent = "正文不能为空";
							return;
						}
						return void op({
							op: "update",
							id: r.id,
							content,
							type: String(q("[data-edit=type]")?.value ?? r.type),
							importance: Number(q("[data-edit=importance]")?.value ?? r.importance),
							tags: String(q("[data-edit=tags]")?.value ?? "")
								.split(",")
								.map((t) => t.trim())
								.filter(Boolean),
						}).then(() => renderSide());
					}
				};
			});
		}

		function escapeHtml(s) {
			return String(s ?? "").replace(
				/[&<>"']/g,
				(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
			);
		}

		// ---------------------------------------------------------------- 工具栏
		let searchTimer = 0;
		searchInput.addEventListener("input", () => {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(() => {
				state.query = searchInput.value;
				draw();
			}, 120);
		});
		root.querySelector('[data-act="scope"]').onclick = (ev) => {
			state.allProjects = !state.allProjects;
			ev.currentTarget.classList.toggle("on", state.allProjects);
			ev.currentTarget.textContent = state.allProjects ? "全部项目" : "当前项目";
			rebuild();
		};
		root.querySelector('[data-act="faded"]').onclick = (ev) => {
			state.showFaded = !state.showFaded;
			ev.currentTarget.classList.toggle("on", state.showFaded);
			rebuild();
		};
		root.querySelector('[data-act="back"]').onclick = () => {
			// 走宿主桥切回对话；宿主在 setView("chat") 时顺手收起主面板（见 App.tsx）。
			const bridge = window.__piWebUiHost;
			if (bridge?.setView) bridge.setView("chat");
		};
		const toggleList = (mode) => () => {
			state.listMode = state.listMode === mode ? null : mode;
			root.querySelectorAll('[data-act="trash"],[data-act="quarantine"]').forEach((b) => {
				b.classList.toggle("on", state.listMode && b.dataset.act === state.listMode);
			});
			if (state.listMode) select(null);
			renderList();
		};
		root.querySelector('[data-act="trash"]').onclick = toggleList("trash");
		root.querySelector('[data-act="quarantine"]').onclick = toggleList("quarantine");
		root.querySelector('[data-act="new"]').onclick = () => {
			state.creating = true;
			state.selected = null;
			if (state.listMode) {
				state.listMode = null;
				root.querySelectorAll('[data-act="trash"],[data-act="quarantine"]').forEach((b) => b.classList.remove("on"));
				renderList();
			}
			renderSide();
		};
		root.querySelector('[data-act="batch"]').onclick = (ev) => {
			state.batch = !state.batch;
			state.picked.clear();
			ev.currentTarget.classList.toggle("on", state.batch);
			if (state.batch) select(null);
			updateBatchBar();
			draw();
		};
		root.querySelectorAll("[data-batch]").forEach((btn) => {
			btn.onclick = () => {
				const kind = btn.dataset.batch;
				if (kind === "all") {
					for (const n of nodes) state.picked.add(n.id);
					updateBatchBar();
					draw();
					return;
				}
				if (kind === "clear") {
					state.picked.clear();
					updateBatchBar();
					draw();
					return;
				}
				const ids = [...state.picked];
				if (!ids.length) return;
				if (kind === "delete" && ids.length > 3) {
					const ok = window.confirm(`删除 ${ids.length} 条？会先进回收站（30 天内可恢复）。`);
					if (!ok) return;
				}
				void op({ op: "bulk", action: kind, ids }).then(() => {
					state.picked.clear();
					updateBatchBar();
				});
			};
		});
		root.querySelector('[data-act="housekeep"]').onclick = () => {
			note.textContent = "整理中…";
			void op({ op: "housekeep" });
		};
		root.querySelector('[data-act="export"]').onclick = () => {
			window.open(`${API}/export`, "_blank");
		};

		const onResize = () => draw();
		window.addEventListener("resize", onResize);
		const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
		ro?.observe(wrap);

		void load();
		void ctx;

		return () => {
			disposed = true;
			if (raf) cancelAnimationFrame(raf);
			clearTimeout(searchTimer);
			window.removeEventListener("resize", onResize);
			ro?.disconnect();
			root.remove();
		};
	},
};
