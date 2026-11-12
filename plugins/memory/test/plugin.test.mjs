/** 插件服务端单测：用假宿主跑 activate → 工具写/查/改/删 → 提醒注入 → 反馈。 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../index.mjs";

function makeHost(dir, settings = {}) {
	const tools = new Map();
	const commands = new Map();
	const notices = [];
	const handlers = { runEvent: [], toolPost: [], cwd: [] };
	const routes = new Map();
	const host = {
		dataDir: dir,
		log: () => {},
		notify: (level, text) => {
			notices.push({ level, text });
		},
		getSettings: () => ({ injectHint: true, ...settings }),
		getActiveConversation: () => ({ id: "conv-1" }),
		registerAgentTool: (t) => {
			tools.set(t.name, t);
			return () => tools.delete(t.name);
		},
		registerCommand: (c) => {
			commands.set(c.name, c);
			return () => commands.delete(c.name);
		},
		onRunEvent: (h) => {
			handlers.runEvent.push(h);
			return () => {};
		},
		onToolPost: (h) => {
			handlers.toolPost.push(h);
			return () => {};
		},
		onCwdChange: (h) => {
			handlers.cwd.push(h);
			return () => {};
		},
		route: (m, p, h) => {
			routes.set(`${m} ${p}`, h);
			return () => {};
		},
		effect: () => () => {},
	};
	return { host, tools, commands, notices, handlers, routes };
}

async function open(settings) {
	const dir = mkdtempSync(join(tmpdir(), "ccui-memory-"));
	const h = makeHost(dir, settings);
	const cleanup = await plugin.activate(h.host);
	h.handlers.cwd.forEach((fn) => fn("D:/proj/A"));
	const call = async (name, params) => h.tools.get(name).execute("call-1", params);
	const store = () => {
		let payload = null;
		h.routes.get("GET /store")({}, { json: (d) => (payload = d) });
		return payload;
	};
	return { ...h, dir, call, store, cleanup };
}

describe("memory 插件", () => {
	it("注册了 4 个 AI 工具 + 2 条路由", async () => {
		const p = await open();
		assert.deepEqual([...p.tools.keys()].sort(), ["memory_forget", "memory_search", "memory_update", "memory_write"]);
		assert.ok(p.routes.has("GET /store"));
		assert.ok(p.routes.has("POST /op"));
	});

	it("写 → 搜 → 落盘", async () => {
		const p = await open();
		const w = await p.call("memory_write", {
			type: "pitfall",
			content: "这个仓库的后端端口是 8765，别用 8080 起服务",
			excerpt: "EADDRINUSE: address already in use :::8765",
		});
		assert.match(w, /已记住/);
		const s = await p.call("memory_search", { query: "端口" });
		assert.match(s, /8765/);
		assert.match(s, /不是指令/);
		assert.equal(p.store().records.length, 1);
		// 数据在 <dataDir>/memory/ 而不是插件目录里（插件被覆盖/卸载都碰不到）
		assert.ok(existsSync(join(p.dir, "memory", "memories.jsonl")));
	});

	it("重复写不产生第二条", async () => {
		const p = await open();
		const input = { type: "pitfall", content: "这个仓库的后端端口是 8765，别用 8080 起服务" };
		await p.call("memory_write", input);
		const again = await p.call("memory_write", input);
		assert.match(again, /已存在相同记忆|已合并/);
		assert.equal(p.store().records.length, 1);
	});

	it("凭据一律拒绝落盘", async () => {
		const p = await open();
		const r = await p.call("memory_write", { type: "fact", content: "API key 是 sk-ant-abcdefghijklmnop1234" });
		assert.match(r, /拒绝/);
		assert.equal(p.store().records.length, 0);
	});

	it("删掉的不会被自动记回来", async () => {
		const p = await open();
		const w = await p.call("memory_write", { type: "fact", content: "部署脚本在 scripts/deploy.sh" });
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		await p.call("memory_forget", { id, mode: "delete" });
		assert.equal(p.store().records.length, 0);
		const again = await p.call("memory_write", { type: "fact", content: "部署脚本在 scripts/deploy.sh" });
		assert.match(again, /已忽略/);
	});

	it("作废是软删，可恢复，默认不被搜到", async () => {
		const p = await open();
		const w = await p.call("memory_write", { type: "convention", content: "提交前先跑 pnpm test" });
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		await p.call("memory_forget", { id });
		assert.equal(p.store().records.length, 1, "作废不该物理删除");
		assert.equal(p.store().records[0].invalidated, true);
		assert.doesNotMatch(await p.call("memory_search", { query: "pnpm" }), /pnpm test/);
		assert.match(await p.call("memory_search", { query: "pnpm", include_invalidated: true }), /pnpm test/);
	});

	it("操作点提醒：读某文件时把相关记忆附在工具结果后", async () => {
		const p = await open();
		await p.call("memory_write", {
			type: "pitfall",
			content: "src/app.ts 里改路由前先跑一遍类型检查，否则运行期才炸",
			file: "src/app.ts",
		});
		const edit = p.handlers.toolPost[0]({
			toolName: "read",
			params: { path: "D:/proj/A/src/app.ts" },
			conversationId: "conv-1",
		});
		assert.ok(edit?.additionalContext?.includes("相关历史记录"));
		assert.ok(edit.additionalContext.includes("类型检查"));
	});

	it("反馈②：同轮工具命中后强度上涨，run_end 结算", async () => {
		const p = await open();
		await p.call("memory_write", {
			type: "pitfall",
			content: "src/app.ts 里改路由前先跑一遍类型检查",
			file: "src/app.ts",
		});
		p.handlers.toolPost[0]({ toolName: "read", params: { path: "src/app.ts" }, conversationId: "conv-1" });
		p.handlers.runEvent[0]({ type: "run_end", conversationId: "conv-1" });
		await new Promise((r) => setTimeout(r, 30));
		const [r] = p.store().records;
		assert.ok(r.strength > 1, `强度应上涨，实际 ${r.strength}`);
		assert.ok(r.useCount >= 1);
	});

	it("项目隔离：别的项目的记忆默认搜不到", async () => {
		const p = await open();
		await p.call("memory_write", { type: "convention", content: "本项目用 pnpm，不要用 npm" });
		// 切到另一个项目
		p.handlers.cwd.forEach((fn) => fn("D:/proj/B"));
		assert.doesNotMatch(await p.call("memory_search", { query: "pnpm" }), /pnpm/);
		assert.match(await p.call("memory_search", { query: "pnpm", all_projects: true }), /pnpm/);
	});

	it("global 记忆跨项目都搜得到", async () => {
		const p = await open();
		await p.call("memory_write", { type: "preference", scope: "global", content: "回答尽量简短，不要客套" });
		p.handlers.cwd.forEach((fn) => fn("D:/proj/B"));
		assert.match(await p.call("memory_search", { query: "简短" }), /简短/);
	});

	it("重启用同一目录仍读得回来", async () => {
		const p = await open();
		await p.call("memory_write", { type: "fact", content: "Node 24 才能跑 node:sqlite" });
		await p.cleanup();
		const again = makeHost(p.dir);
		await plugin.activate(again.host);
		let payload = null;
		again.routes.get("GET /store")({}, { json: (d) => (payload = d) });
		assert.equal(payload.records.length, 1);
		assert.match(readFileSync(join(p.dir, "memory", "memories.jsonl"), "utf8"), /node:sqlite/);
	});
});

describe("斜杠命令", () => {
	it("注册 /remember /recall /forget", async () => {
		const p = await open();
		assert.deepEqual([...p.commands.keys()].sort(), ["forget", "recall", "remember"]);
	});

	it("/remember 不带类型时按词面猜，并真正落库", async () => {
		const p = await open();
		const out = await p.commands.get("remember").run("迁移前必须先停服务，否则锁表");
		assert.match(out, /已记住/);
		assert.equal(p.store().records[0].type, "convention");
		assert.equal(p.store().records[0].source.kind, "user");
	});

	it("/remember 带类型前缀（中文或英文）", async () => {
		const p = await open();
		await p.commands.get("remember").run("坑 这个组件改名会牵动三处");
		assert.equal(p.store().records[0].type, "pitfall");
		await p.commands.get("remember").run("fact 后端端口 8765");
		assert.equal(p.store().records[1].type, "fact");
	});

	it("/remember 第一个词不是类型时整句都算内容", async () => {
		const p = await open();
		await p.commands.get("remember").run("数据库 迁移前要先备份");
		assert.equal(p.store().records[0].content, "数据库 迁移前要先备份");
	});

	it("/recall 给用户看（不进模型上下文），/forget 默认作废", async () => {
		const p = await open();
		const w = await p.commands.get("remember").run("坑 迁移前必须先停服务");
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		assert.match(await p.commands.get("recall").run("迁移"), /迁移前必须先停服务/);
		assert.match(await p.commands.get("forget").run(id), /已作废/);
		assert.equal(p.store().records[0].invalidated, true);
	});

	it("/forget 带「删除」= 移进回收站并进黑名单", async () => {
		const p = await open();
		const w = await p.commands.get("remember").run("事实 部署脚本在 scripts/deploy.sh");
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		assert.match(await p.commands.get("forget").run(`${id} 删除`), /回收站/);
		assert.equal(p.store().records.length, 0);
		// 自动/AI 侧再写同一条 → 被指纹挡住（删掉的东西不该自己回来）
		assert.match(await p.call("memory_write", { type: "fact", content: "部署脚本在 scripts/deploy.sh" }), /已忽略/);
		// 用户手写命令可以重新记（人想加回来是正当的）
		assert.match(await p.commands.get("remember").run("部署脚本在 scripts/deploy.sh"), /已记住/);
	});
});

describe("漏记兜底（模型嘴上说记住但没调工具）", () => {
	const runEvents = (p, conv, task, toolNames = []) => {
		p.handlers.runEvent[0]({ type: "run_start", conversationId: conv, task, at: Date.now() });
		for (const name of toolNames)
			p.handlers.runEvent[0]({ type: "tool_start", conversationId: conv, toolName: name, at: Date.now() });
		p.handlers.runEvent[0]({ type: "run_end", conversationId: conv, at: Date.now() });
	};

	it("用户说「记住」但没调 memory_write → 自动补一条（隔离区）并提示", async () => {
		const p = await open();
		runEvents(p, "conv-x", "记住，在我询问问题时，不要主动执行，回答问题即可。");
		await new Promise((r) => setTimeout(r, 40));
		const [rec] = p.store().records;
		assert.ok(rec, "应该补写一条");
		assert.equal(rec.quarantined, true);
		assert.equal(rec.source.kind, "auto");
		assert.equal(rec.type, "preference");
		assert.match(rec.content, /不要主动执行/);
		assert.ok(
			p.notices.some((n) => /已自动记下/.test(n.text)),
			"要提示用户，别偷偷写",
		);
	});

	it("模型真的调了 memory_write 就不重复补", async () => {
		const p = await open();
		runEvents(p, "conv-y", "记住，提交前先跑 pnpm test", ["memory_write"]);
		await new Promise((r) => setTimeout(r, 40));
		assert.equal(p.store().records.length, 0);
	});

	it("没提「记住」的普通对话不补", async () => {
		const p = await open();
		runEvents(p, "conv-z", "这个函数是干什么的？");
		await new Promise((r) => setTimeout(r, 40));
		assert.equal(p.store().records.length, 0);
	});

	it("设置里关掉 autoRemember 就不补", async () => {
		const p = await open({ autoRemember: false });
		runEvents(p, "conv-w", "记住，以后都用中文回复");
		await new Promise((r) => setTimeout(r, 40));
		assert.equal(p.store().records.length, 0);
	});
});

describe("数据搬家：<dataDir>/memory（与插件目录平级）", () => {
	const line = (id, content) =>
		`${JSON.stringify({ id, type: "fact", scope: "global", scopeKey: "global", content, createdAt: Date.now(), updatedAt: Date.now() })}
`;

	it("旧位置的库会被复制过来，旧文件不删", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ccui-memory-mig-"));
		const legacy = join(dir, "plugins", "memory", "data");
		mkdirSync(legacy, { recursive: true });
		writeFileSync(join(legacy, "memories.jsonl"), line("old1", "迁移前就在的记忆"));
		const h = makeHost(dir);
		await plugin.activate(h.host);
		h.handlers.cwd.forEach((fn) => fn("D:/proj/A"));
		let payload = null;
		h.routes.get("GET /store")({}, { json: (d) => (payload = d) });
		assert.equal(payload.records.length, 1);
		assert.equal(payload.records[0].id, "old1");
		assert.ok(existsSync(join(dir, "memory", "memories.jsonl")), "新位置要有");
		assert.ok(existsSync(join(legacy, "memories.jsonl")), "旧文件必须保留（不自动删数据）");
	});

	it("新位置已有数据时以新为准，不把旧的灌回来", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ccui-memory-mig2-"));
		const legacy = join(dir, "plugins", "memory", "data");
		mkdirSync(legacy, { recursive: true });
		mkdirSync(join(dir, "memory"), { recursive: true });
		writeFileSync(join(legacy, "memories.jsonl"), line("old1", "旧数据"));
		writeFileSync(join(dir, "memory", "memories.jsonl"), line("new1", "新数据"));
		const h = makeHost(dir);
		await plugin.activate(h.host);
		let payload = null;
		h.routes.get("GET /store")({}, { json: (d) => (payload = d) });
		assert.deepEqual(
			payload.records.map((r) => r.id),
			["new1"],
		);
	});

	it("启动留当天快照；物理删除前再留一份；最多保留 5 份", async () => {
		const p = await open();
		await p.call("memory_write", { type: "fact", content: "先记一条，才有东西可备份" });
		const backupDir = join(p.dir, "memory", "backups");
		// 重启一次 → 当天快照
		const again = makeHost(p.dir);
		await plugin.activate(again.host);
		assert.ok(existsSync(backupDir));
		assert.equal(readdirSync(backupDir).filter((f) => f.endsWith(".jsonl")).length, 1);

		// 物理删除前再留一份
		const w = await again.tools.get("memory_write").execute("c", { type: "fact", content: "第二条待删" });
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		await again.tools.get("memory_forget").execute("c", { id, mode: "delete" });
		assert.equal(readdirSync(backupDir).filter((f) => f.endsWith(".jsonl")).length, 2);

		// 手工塞到 5 份以上，再触发一次删除 → 被裁到 5
		for (let i = 0; i < 6; i++) writeFileSync(join(backupDir, `memories-2020-01-0${i + 1}.jsonl`), "{}");
		const w2 = await again.tools.get("memory_write").execute("c", { type: "fact", content: "第三条待删" });
		const id2 = /\[(m[^\]]+)\]/.exec(w2)[1];
		await again.tools.get("memory_forget").execute("c", { id: id2, mode: "delete" });
		assert.ok(readdirSync(backupDir).filter((f) => f.endsWith(".jsonl")).length <= 5);
	});
});

describe("回收站（删除可恢复）", () => {
	it("删除进回收站，可恢复，恢复后指纹也撤了", async () => {
		const p = await open();
		const w = await p.call("memory_write", { type: "fact", content: "部署脚本在 scripts/deploy.sh" });
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		assert.match(await p.call("memory_forget", { id, mode: "delete" }), /回收站/);
		assert.equal(p.store().records.length, 0);
		assert.equal(p.store().trash.length, 1);
		assert.equal(p.store().trash[0].id, id);

		assert.match(await p.call("memory_forget", { id: "x" }), /找不到/); // 主库里已经没了
		const p2 = p.routes.get("POST /op");
		let out = null;
		await new Promise((r) => {
			p2({ body: { op: "restore", id } }, { json: (d) => ((out = d), r()) });
		});
		assert.match(out.text, /已从回收站恢复/);
		assert.equal(p.store().records.length, 1);
		assert.equal(p.store().trash.length, 0);
		// 恢复后同一条不会再被指纹挡住（改成合并/重复提示）
		const again = await p.call("memory_write", { type: "fact", content: "部署脚本在 scripts/deploy.sh" });
		assert.doesNotMatch(again, /已忽略/);
	});

	it("彻底删除：回收站里也没了", async () => {
		const p = await open();
		const w = await p.call("memory_write", { type: "fact", content: "临时结论" });
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		await p.call("memory_forget", { id, mode: "delete" });
		let out = null;
		await new Promise((r) => {
			p.routes.get("POST /op")({ body: { op: "purge", id } }, { json: (d) => ((out = d), r()) });
		});
		assert.match(out.text, /已彻底删除/);
		assert.equal(p.store().trash.length, 0);
	});

	it("超过 30 天的回收站条目在启动时自动清掉", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ccui-memory-trash-"));
		mkdirSync(join(dir, "memory"), { recursive: true });
		const old = { id: "gone", type: "fact", content: "很久以前删的", deletedAt: Date.now() - 31 * 24 * 3600 * 1000 };
		const fresh = { id: "keep", type: "fact", content: "刚删的", deletedAt: Date.now() - 3600 * 1000 };
		writeFileSync(
			join(dir, "memory", "trash.jsonl"),
			`${JSON.stringify(old)}
${JSON.stringify(fresh)}
`,
		);
		const h = makeHost(dir);
		await plugin.activate(h.host);
		let payload = null;
		h.routes.get("GET /store")({}, { json: (d) => (payload = d) });
		assert.deepEqual(
			payload.trash.map((t) => t.id),
			["keep"],
		);
	});
});

describe("整理（去重合并 + 复核）", () => {
	it("近重复合并：保留强度高的，另一条作废并指向赢家", async () => {
		const p = await open();
		await p.call("memory_write", { type: "fact", content: "部署脚本在 scripts/deploy.sh，要先 chmod" });
		await p.call("memory_write", { type: "fact", content: "部署脚本在 scripts/deploy.sh 要先 chmod" });
		let out = null;
		await new Promise((r) => {
			p.routes.get("POST /op")({ body: { op: "housekeep" } }, { json: (d) => ((out = d), r()) });
		});
		// 写入时已经合并过一条（0.6~0.85），这里只验证整理能跑且不报错
		assert.match(out.text, /整理完成/);
		const recs = p.store().records;
		assert.ok(recs.length >= 1);
	});

	it("复核：指向的文件不存在 → 自动作废（变灰、可恢复）", async () => {
		const p = await open();
		const w = await p.call("memory_write", {
			type: "pitfall",
			content: "这个文件里的写法容易漏改",
			file: "this-file-does-not-exist.ts",
		});
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		assert.equal(p.store().records[0].invalidated, false);
		let out = null;
		await new Promise((r) => {
			p.routes.get("POST /op")({ body: { op: "housekeep" } }, { json: (d) => ((out = d), r()) });
		});
		assert.match(out.text, /文件已不存在/);
		const rec = p.store().records.find((r) => r.id === id);
		assert.equal(rec.invalidated, true);
		assert.equal(rec.stale, true);
		// 还能恢复
		await new Promise((r) => {
			p.routes.get("POST /op")({ body: { op: "restore", id } }, { json: () => r() });
		});
		assert.equal(p.store().records.find((r) => r.id === id).invalidated, false);
	});

	it("激活时超过 24h 会自动跑一次整理", async () => {
		const p = await open();
		await p.call("memory_write", { type: "pitfall", content: "指向不存在文件", file: "nope.ts" });
		// 第一次激活写过 state.json（上次整理=现在）→ 抹掉时间戳，模拟"隔了一天再启动"
		writeFileSync(join(p.dir, "memory", "state.json"), JSON.stringify({ lastHousekeep: 0 }));
		const again = makeHost(p.dir);
		await plugin.activate(again.host);
		again.handlers.cwd.forEach((fn) => fn("D:/proj/A")); // cwd 到位后才做复核
		let payload = null;
		again.routes.get("GET /store")({}, { json: (d) => (payload = d) });
		assert.equal(payload.records[0].invalidated, true);
	});
});

describe("隔离区升降 + 批量操作", () => {
	const post = (p, body) =>
		new Promise((resolve) => {
			p.routes.get("POST /op")({ body }, { json: (d) => resolve(d) });
		});

	it("隔离区：能放进去也能升级出来", async () => {
		const p = await open();
		const w = await p.call("memory_write", { type: "fact", content: "自动记下的结论" });
		const id = /\[(m[^\]]+)\]/.exec(w)[1];
		assert.match((await post(p, { op: "quarantine", id, on: true })).text, /隔离区/);
		assert.equal(p.store().records[0].quarantined, true);
		assert.match((await post(p, { op: "quarantine", id, on: false })).text, /升级/);
		assert.equal(p.store().records[0].quarantined, false);
	});

	it("批量作废 / 恢复 / 钉住 / 升级", async () => {
		const p = await open();
		const ids = [];
		for (const text of ["批量一", "批量二", "批量三"]) {
			const w = await p.call("memory_write", { type: "fact", content: `${text} deploy 说明` });
			ids.push(/\[(m[^\]]+)\]/.exec(w)[1]);
		}
		assert.match((await post(p, { op: "bulk", action: "invalidate", ids })).text, /作废 3 条/);
		assert.equal(p.store().records.filter((r) => r.invalidated).length, 3);

		assert.match((await post(p, { op: "bulk", action: "restore", ids })).text, /恢复 3 条/);
		assert.equal(p.store().records.filter((r) => r.invalidated).length, 0);

		assert.match((await post(p, { op: "bulk", action: "pin", ids })).text, /钉住 3 条/);
		assert.equal(p.store().records.filter((r) => r.pinned).length, 3);

		assert.match((await post(p, { op: "bulk", action: "delete", ids })).text, /删除 3 条/);
		assert.equal(p.store().records.length, 0);
		assert.equal(p.store().trash.length, 3);
	});

	it("未知批量动作直接 400，不静默回“已完成 0 条”", async () => {
		const p = await open();
		let status = 0;
		let body = {};
		p.routes.get("POST /op")(
			{ body: { op: "bulk", action: "explode", ids: ["m1"] } },
			{ status: (c) => ((status = c), { json: (d) => (body = d) }) },
		);
		assert.equal(status, 400);
		assert.match(String(body.error), /未知的批量动作/);
	});

	it("批量接口拒绝空 ids", async () => {
		const p = await open();
		let status = 0;
		p.routes.get("POST /op")(
			{ body: { op: "bulk", action: "pin", ids: [] } },
			{ status: (c) => ((status = c), { json: () => {} }) },
		);
		assert.equal(status, 400);
	});
});
