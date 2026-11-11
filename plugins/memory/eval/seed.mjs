#!/usr/bin/env node
/**
 * 模拟记忆数据（给图谱和题库用）。
 *
 *   node plugins/memory/eval/seed.mjs                 # 写入约 45 条模拟记忆（走真实 HTTP，串行落库）
 *   node plugins/memory/eval/seed.mjs --clean         # 把模拟数据删掉（delete → purge，不留回收站垃圾）
 *   node plugins/memory/eval/seed.mjs --port 8788
 *
 * 所有条目都带 tag `seed`，可以随时按这个标签识别/清理。
 * 刻意造出这几种状态，好让界面上各种视觉都出现一次：
 *   普通 / 淡出（很久没用到）/ 作废（validUntil 已过）/ 被取代（supersededBy）/ 隔离区 / 钉住。
 */
import http from "node:http";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
};

const PORT = Number(opt("port", 8788));
const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (d) => now - d * DAY;

const call = (payload) =>
	new Promise((resolve, reject) => {
		const body = Buffer.from(JSON.stringify(payload), "utf8");
		const req = http.request(
			{
				host: "127.0.0.1",
				port: PORT,
				path: "/plugins-api/memory/op",
				method: "POST",
				headers: { "content-type": "application/json; charset=utf-8", "content-length": body.length },
			},
			(res) => {
				let data = "";
				res.setEncoding("utf8");
				res.on("data", (c) => (data += c));
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch {
						reject(new Error(`响应不是 JSON：${data.slice(0, 200)}`));
					}
				});
			},
		);
		req.on("error", reject);
		req.end(body);
	});

const store = () =>
	new Promise((resolve, reject) => {
		http
			.get(`http://127.0.0.1:${PORT}/plugins-api/memory/store`, (res) => {
				let data = "";
				res.setEncoding("utf8");
				res.on("data", (c) => (data += c));
				res.on("end", () => resolve(JSON.parse(data)));
			})
			.on("error", reject);
	});

/** 一条模拟记忆（默认：项目范围、正常状态）。 */
let seq = 0;
const m = (type, content, over = {}) => {
	seq += 1;
	const created = over.createdAt ?? daysAgo(20);
	return {
		id: `seed-${String(seq).padStart(2, "0")}`,
		type,
		scope: "project",
		scopeKey: "d:/aiagent/pi-web/app",
		content,
		excerpt: over.excerpt ?? "",
		tags: ["seed", ...(over.tags ?? [])],
		importance: over.importance ?? (type === "pitfall" || type === "decision" ? 4 : 3),
		createdAt: created,
		updatedAt: over.updatedAt ?? created,
		lastUsedAt: over.lastUsedAt ?? created,
		strength: over.strength ?? 1,
		useCount: over.useCount ?? 0,
		validFrom: created,
		validUntil: over.validUntil ?? 0,
		supersededBy: over.supersededBy ?? null,
		pinned: over.pinned === true,
		quarantined: over.quarantined === true,
		source: { kind: "agent", ...(over.source ?? {}) },
		feedback: { pos: 0, neg: 0 },
	};
};

const SEED = [
	// ---- 坑（最值钱的那类）----
	m(
		"pitfall",
		"8788 端口被上一组 node 进程占着时，vite 会一直刷 ws proxy error ECONNREFUSED；先 taskkill 那组 concurrently 再启动",
		{
			tags: ["8788", "server/index.ts"],
			excerpt: "AggregateError [ECONNREFUSED]: at internalConnectMultiple (node:net:1142:49)",
			strength: 3.5,
			useCount: 6,
			lastUsedAt: daysAgo(1),
			importance: 5,
			pinned: true,
		},
	),
	m("pitfall", "node --watch 重启的那两秒，/plugins-api/* 会返回 404 not found，不是插件 bug，等两秒再请求", {
		tags: ["server/index.ts"],
		strength: 2.4,
		useCount: 3,
		lastUsedAt: daysAgo(2),
	}),
	m(
		"pitfall",
		"用 python 脚本改仓库文件会按 CRLF 写回，git 里整个文件都变成重写；要么用 node，要么 open(newline='') 保持 LF",
		{
			tags: ["server/plugins.ts"],
			excerpt: "git diff --numstat 显示 12001 11994",
			strength: 3,
			useCount: 4,
			lastUsedAt: daysAgo(1),
			importance: 5,
		},
	),
	m("pitfall", "PowerShell 里 curl 是 Invoke-WebRequest 的别名，要测接口得写 curl.exe", {
		strength: 1.2,
		useCount: 1,
		lastUsedAt: daysAgo(9),
	}),
	m(
		"pitfall",
		"在 Write/Edit 之外用 shell 写文件里的正则，反斜杠容易被吞成真换行，split(/\\\\r?\\\\n/) 会变成语法错误",
		{
			tags: ["plugins/memory/index.mjs"],
			strength: 2.1,
			useCount: 2,
			lastUsedAt: daysAgo(3),
		},
	),
	m(
		"pitfall",
		'插件 manifest 里每个内置插件都必须有 iconSvg（线条 + currentColor + fill="none"），只写 emoji 会被单测拦下',
		{
			tags: ["plugins/memory/manifest.json", "tests/unit/plugin-icon-dom.test.ts"],
			strength: 1.6,
			lastUsedAt: daysAgo(6),
		},
	),
	m("pitfall", "插件视图挂载失败时整片空白很难查：先看 pluginViews 有没有加载成功，再看 manifest 的 view/permissions", {
		strength: 0.9,
		lastUsedAt: daysAgo(15),
		importance: 3,
	}),
	m(
		"pitfall",
		"同一个会话里改完宿主 UI 槽位，必须同时改 server/protocol.ts 的 UiSlotId、server/plugins.ts 的 UI_SLOTS、web/src/ui-slots.ts 的 SLOT_IDS，缺一处就是注册了但界面上没有",
		{
			tags: ["server/protocol.ts", "server/plugins.ts", "web/src/ui-slots.ts"],
			strength: 2.8,
			useCount: 3,
			lastUsedAt: daysAgo(1),
			importance: 5,
		},
	),

	// ---- 决定与理由 ----
	m(
		"decision",
		"插件停用语义从「只隐藏 UI」改成「真反激活」：以前关掉开关工具照样能用，是误导；现在禁用会撤回工具/路由/订阅，数据留在磁盘",
		{
			tags: ["server/plugins.ts", "server/plugin-disabled.ts"],
			strength: 2.6,
			useCount: 3,
			lastUsedAt: daysAgo(2),
			importance: 5,
		},
	),
	m(
		"decision",
		"中文检索用 2-gram 而不是 jieba：不想引入几 MB 词典依赖和首装失败风险，2-gram 召回够用、排序也比子串匹配好",
		{
			tags: ["plugins/memory/client/core.mjs"],
			strength: 2.2,
			useCount: 2,
			lastUsedAt: daysAgo(4),
			importance: 4,
		},
	),
	m(
		"decision",
		"记忆数据搬到 <dataDir>/memory/ 而不是留在插件目录：一次同步删目录把整库带走过，插件随便覆盖/卸载都不该碰数据",
		{
			tags: ["plugins/memory/index.mjs"],
			strength: 2,
			useCount: 2,
			lastUsedAt: daysAgo(1),
			importance: 5,
		},
	),
	m(
		"decision",
		"否决了「把热记忆写进项目 AGENTS.md」：那是可信指令位，写 AI 生成内容等于把数据升格成命令，还会和用户自己的规则打架",
		{
			strength: 1.4,
			useCount: 1,
			lastUsedAt: daysAgo(5),
		},
	),
	m("decision", "记忆面板改用 main.panel 槽位而不是插件视图：视图会把左栏一起换掉，和「插件」能力面板的交互不一致", {
		tags: ["web/src/App.tsx"],
		strength: 1.8,
		useCount: 2,
		lastUsedAt: daysAgo(2),
	}),

	// ---- 约定 ----
	m(
		"convention",
		"提交前依次跑：npm run format:check、npm run typecheck、npx vitest run、npm run lint（lint 有 34 条基线 warning，不算失败）",
		{
			tags: ["package.json"],
			strength: 3.2,
			useCount: 7,
			lastUsedAt: daysAgo(0),
			importance: 5,
			pinned: true,
		},
	),
	m("convention", "改宿主行为要同步改单测：ui-slots 的槽位数量、plugin-api-catalog 的例子表都有硬断言", {
		tags: ["tests/unit/ui-slots.test.ts", "tests/unit/plugin-api-catalog.test.ts"],
		strength: 2.5,
		useCount: 4,
		lastUsedAt: daysAgo(1),
	}),
	m("convention", "插件更新用覆盖式拷贝（cp -r plugins/memory/. <dataDir>/plugins/memory/），不要 rm -rf 整个目录", {
		tags: ["plugins/memory/README.md"],
		strength: 2,
		useCount: 2,
		lastUsedAt: daysAgo(1),
	}),
	m("convention", "开发时用 npm run dev（concurrently 起 server 8788 + vite 5173），日志写 web-dev.log", {
		strength: 2.6,
		useCount: 5,
		lastUsedAt: daysAgo(0),
	}),
	m("convention", "插件服务端代码是可信 Node，直接 node:fs 写数据；host.fs 是工作区锚定的，不该拿来写数据目录", {
		tags: ["plugins/memory/index.mjs"],
		strength: 1.5,
		useCount: 1,
		lastUsedAt: daysAgo(7),
	}),

	// ---- 事实 ----
	m("fact", "数据目录是 ~/.pi-web：插件在 plugins/<id>/，记忆库在 memory/，secrets.key 在同级", {
		strength: 2.8,
		useCount: 4,
		lastUsedAt: daysAgo(0),
		importance: 4,
	}),
	m("fact", "server 默认监听 127.0.0.1:8788，vite dev 在 5173，vite 把 /api 和 /plugins-api 反代到 8788", {
		strength: 2.4,
		useCount: 3,
		lastUsedAt: daysAgo(1),
	}),
	m("fact", "仓库的插件源码在 app/plugins/<id>/，已装插件在 <dataDir>/plugins/<id>/，两边是拷贝关系不是软链", {
		strength: 2,
		useCount: 2,
		lastUsedAt: daysAgo(2),
	}),
	m("fact", "Node 24 自带 node:sqlite（仍带 experimental 警告），22.x 需要特性检测后回落", {
		strength: 1,
		useCount: 1,
		lastUsedAt: daysAgo(11),
	}),
	m("fact", "当前模型是 DeepSeek V4.1 Flash，思考强度默认「高」", {
		strength: 1.2,
		useCount: 1,
		lastUsedAt: daysAgo(8),
		importance: 2,
	}),

	// ---- 术语 ----
	m("glossary", "ccui = 这个 fork 的名字（上游叫 pi-web-ui）；数据目录和 PI_WEB_* 环境变量故意保留旧名", {
		strength: 1.8,
		useCount: 2,
		lastUsedAt: daysAgo(4),
	}),
	m("glossary", "__view = 插件顶栏视图 tab 的保留 id；插件不声明时宿主会合成一条 hidden 的", {
		tags: ["web/src/ui-slots.ts"],
		strength: 1.4,
		lastUsedAt: daysAgo(6),
	}),
	m(
		"glossary",
		"slot / 槽位 = 宿主定义的 UI 挂载点（topbar.primary、main.panel、leftpanel.nav…），插件只声明条目、宿主负责画",
		{
			tags: ["server/plugins.ts"],
			strength: 1.6,
			useCount: 1,
			lastUsedAt: daysAgo(5),
		},
	),
	m("glossary", "quarantine / 隔离区 = 自动记下但还没被用上的记忆，可被搜到但不参与优先推送", {
		tags: ["plugins/memory/index.mjs"],
		strength: 1,
		lastUsedAt: daysAgo(5),
	}),

	// ---- 偏好 ----
	m("preference", "回答简短，不要客套和总结式复述", {
		scope: "global",
		scopeKey: "global",
		strength: 3,
		useCount: 5,
		lastUsedAt: daysAgo(0),
	}),
	m("preference", "用户提问时只回答问题，不要主动执行", {
		scope: "global",
		scopeKey: "global",
		strength: 3.4,
		useCount: 6,
		lastUsedAt: daysAgo(0),
		importance: 4,
		pinned: true,
	}),
	m("preference", "UI 文案用中文，代码注释也用中文", {
		scope: "global",
		scopeKey: "global",
		strength: 2,
		useCount: 2,
		lastUsedAt: daysAgo(3),
	}),

	// ---- 任务状态 ----
	m("task", "记忆插件 P0：库/检索/工具/命令/图谱/左栏入口/开关语义 都已完成，剩题库和 P1 自动抽取", {
		strength: 2.2,
		useCount: 2,
		lastUsedAt: daysAgo(0),
		createdAt: daysAgo(3),
	}),
	m("task", "图谱视图的力导向和拖拽还没经过人眼验收，等节点多了再看手感", {
		strength: 1.4,
		lastUsedAt: daysAgo(1),
		createdAt: daysAgo(3),
	}),
	m("task", "仓库里还有 12 个宿主文件改动 + 记忆插件本体没提交，计划拆成三个 commit", {
		strength: 1.2,
		lastUsedAt: daysAgo(1),
		createdAt: daysAgo(1),
	}),

	// ---- 刻意造出来的各种状态 ----
	m("fact", "旧版本里 8788 是后端端口（已过时：现在是 server 默认端口，说法变了）", {
		strength: 0.8,
		lastUsedAt: daysAgo(40),
		createdAt: daysAgo(60),
		validUntil: daysAgo(5), // 作废（图上灰点）
	}),
	m("convention", "以前提交前只跑单元测试，不跑 lint", {
		strength: 0.6,
		lastUsedAt: daysAgo(35),
		createdAt: daysAgo(50),
		validUntil: daysAgo(3), // 作废
	}),
	m("fact", "记忆库路径原本是 <dataDir>/plugins/memory/data/（已迁走）", {
		strength: 0.9,
		lastUsedAt: daysAgo(20),
		createdAt: daysAgo(30),
		supersededBy: "seed-11", // 被「搬到 <dataDir>/memory/」那条取代
		validUntil: daysAgo(1),
	}),
	m("pitfall", "冷启动时插件视图偶尔白屏，重启就好", {
		strength: 0.7,
		lastUsedAt: daysAgo(55),
		createdAt: daysAgo(70),
		// 很淡：快被遗忘了
	}),
	m("glossary", "（模糊印象）ccui 以前叫过 cc-web", {
		strength: 0.5,
		lastUsedAt: daysAgo(80),
		createdAt: daysAgo(90),
		quarantined: true, // 隔离区
	}),
	m("decision", "考虑过用 sqlite 存记忆，但几千条以内 JSONL + 2-gram 倒排足够", {
		strength: 0.4,
		lastUsedAt: daysAgo(45),
		createdAt: daysAgo(45),
		quarantined: true,
	}),
];

async function main() {
	if (flag("clean")) {
		const data = await store();
		const ids = data.records.filter((r) => (r.tags ?? []).includes("seed")).map((r) => r.id);
		for (const id of ids) {
			await call({ op: "delete", id });
			await call({ op: "purge", id });
		}
		const trashIds = (data.trash ?? []).filter((t) => (t.tags ?? []).includes("seed")).map((t) => t.id);
		for (const id of trashIds) await call({ op: "purge", id });
		console.log(`已清理 ${ids.length + trashIds.length} 条模拟记忆`);
		return;
	}
	const res = await call({ op: "import", records: SEED });
	console.log(res.text);
	const data = await store();
	console.log(
		`当前：${data.records.length} 条（其中模拟 ${data.records.filter((r) => (r.tags ?? []).includes("seed")).length} 条），回收站 ${data.trash.length} 条`,
	);
}

main().catch((err) => {
	console.error("失败：", err.message);
	console.error("服务没起？先 npm run dev，或用 --port 指定端口。");
	process.exit(1);
});
