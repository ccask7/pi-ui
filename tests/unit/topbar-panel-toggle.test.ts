// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { TopBar } from "../../web/src/components/TopBar.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { ChatState } from "../../web/src/use-chat.js";
import { setAppSend, setAppGlobals, resetAppGlobals } from "../../web/src/app-globals.js";

/**
 * 顶栏结构锁（方案 A：**单一扁直流**）。这套断言是「所有按钮处于一个层级、
 * 顺序/对齐由 slot 数据决定、桌面与手机同一份数据」的最小回归面。
 *
 * 历史：这里曾经锁的是「贴边按钮固定两端 + 按种类裹 .brand/.view-switch/.topbar-desktop
 * 三个容器 + align 落三个容器区」的旧结构。重构后这些容器与例外全部删除 ——
 * 谁再往顶栏塞结构性包装（按种类分组、把某个条目钉死在一端），这里就会红。
 *
 * 面板开关（☰ 历史 / 📁 文件）已全部从顶栏删除 —— 侧栏入口只剩面板边缘的展开条
 * （`PanelRail`）与面板自己的收起键，所以这里不再有「抽屉按钮」的断言。
 *
 * 零 token / 零端口：真 jsdom + 真 React 渲染，只断言 DOM 结构与回调。
 */

// 锚到仓库根（不用 process.cwd()）：静态守卫要读 web/src/styles.css。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// TopBar 只读 chat 的这几个字段（其余快照流内容用不到），stub 到「已连接」即可。
const chatStub = {
	status: "open",
	ready: true,
	state: null,
	activeConversationId: "",
	terminals: [],
	bgServers: [],
	tabs: undefined,
} as unknown as ChatState;

let root: Root | null = null;

/**
 * 一条宿主内置顶栏条目（issue #146 的 slot 结构子集）：只用到 id / source / label / kind / align。
 * `uiPrimary` 不给 = 「没接线」，此时宿主入口一律可见（见 TopBar 的 FALLBACK_TOPBAR_IDS）。
 */
const hostEntry = (id: string, hidden = false) => ({
	id,
	source: "host" as const,
	slot: "topbar.primary" as const,
	label: id,
	kind: "action" as const,
	order: 100,
	align: "start" as const,
	hidden,
	userOverrides: [],
	arrangedBy: [],
});

function mount(
	view: "chat" | "terminal" | "git" | "plugin:demo-mailbox",
	uiPrimary?: unknown[],
	uiOverflow?: unknown[],
	plugins?: { id: string; name: string; icon?: string; description?: string; error?: string; view?: boolean }[],
	chatPatch?: Record<string, unknown>,
) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const opened: ("left" | "right")[] = [];
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(TopBar, {
					chat: { ...chatStub, ...chatPatch },
					...(uiPrimary ? { uiPrimary } : {}),
					...(uiOverflow ? { uiOverflow } : {}),
					terminal: {
						create: () => {},
						close: () => {},
						register: () => () => {},
						restart: () => {},
						select: () => {},
					},
					view,
					plugins: plugins ?? [],
					onViewChange: () => {},
					onOpenPanel: (side: "left" | "right") => opened.push(side),
					onOpenSettings: () => {},
					onOpenBgTasks: () => {},
					onOpenGlobalSearch: () => {},
					sound: { enabled: false, volume: 0.5, kinds: {} },
					onSoundChange: () => {},
					onSoundPreview: () => {},
					themes: [],
					theme: null,
					onThemeChange: () => {},
				} as unknown as Parameters<typeof TopBar>[0]),
			),
		);
	});
	return { container, opened };
}

/** 扁直流里除 spacer 之外的所有子节点（= 真正画出来的条目，顺序即视觉顺序）。 */
const flowItems = (container: HTMLElement) =>
	Array.from(container.querySelector(".topbar-flow")?.children ?? []).filter(
		(el) => !el.classList.contains("tb-spacer"),
	);

const flowKids = (container: HTMLElement) => Array.from(container.querySelector(".topbar-flow")?.children ?? []);
const spacerIndexes = (container: HTMLElement) =>
	flowKids(container)
		.map((el, i) => (el.classList.contains("tb-spacer") ? i : -1))
		.filter((i) => i >= 0);

afterEach(() => {
	setAppSend(null);
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
});

describe("TopBar 是单一扁直流（无按种类包裹的容器、无贴边例外）", () => {
	it("品牌 / 视图 tab / 工具 chip / 抽屉开关全是 .topbar-flow 的直接子节点", () => {
		const { container } = mount("chat");
		const flow = container.querySelector(".topbar-flow");
		expect(flow).toBeTruthy();
		// 旧结构的三件套容器必须不存在（它们就是「非扁平」的来源）——
		// 注意：.brand 如今是单个品牌条目本体（π+名称），必须是 flow 的直接子节点而非包裹容器。
		expect(container.querySelector(".view-switch")).toBeNull();
		expect(container.querySelector(".topbar-desktop")).toBeNull();
		expect(container.querySelector(".topbar-actions")).toBeNull();
		for (const sel of ['[role="tab"]', "button.newchat"]) {
			const el = flow!.querySelector(sel);
			expect(el, sel).toBeTruthy();
			expect(el!.parentElement, sel).toBe(flow);
		}
		// 品牌条目本体是 flow 的直接子节点，π 与名称是它的内层（不再是两个独立条目）。
		const brand = flow!.querySelector(":scope > .brand");
		expect(brand).toBeTruthy();
		expect(brand!.querySelector(".brand-logo")).toBeTruthy();
		expect(brand!.querySelector(".brand-name")).toBeTruthy();
	});

	it("两个 spacer 把条目分成 start / center / end 三段（align 真的换位置）", () => {
		const { container } = mount("chat", [
			{ ...hostEntry("host:brand"), align: "start" },
			{ ...hostEntry("host:chat"), align: "center" },
			{ ...hostEntry("host:tasks"), align: "end" },
		]);
		const [sp1, sp2] = spacerIndexes(container);
		expect(sp1).toBeGreaterThanOrEqual(0);
		expect(sp2).toBeGreaterThan(sp1);
		const kids = flowKids(container);
		const brand = kids.findIndex((el) => el.classList.contains("brand"));
		const tab = kids.findIndex((el) => el.classList.contains("tb-tab"));
		const tasks = kids.findIndex((el) => el.classList.contains("bg-task-chip"));
		expect(brand).toBeLessThan(sp1);
		expect(tab).toBeGreaterThan(sp1);
		expect(tab).toBeLessThan(sp2);
		expect(tasks).toBeGreaterThan(sp2);
	});

	it("没有 center/end 条目时不留空 spacer（空占位会把顶栏撑出空洞）", () => {
		const { container } = mount("chat", [hostEntry("host:chat"), hostEntry("host:terminal")]);
		expect(spacerIndexes(container)).toEqual([]);
	});

	it("文字总开关：topbarText=false 时 header 挂 no-labels（桌面手机同一套，无独立分支）", () => {
		const { container } = mount("chat", undefined, undefined, undefined, {
			settings: { uiLayout: { topbarText: false } },
		});
		expect(container.querySelector("header.topbar.no-labels")).toBeTruthy();
		// 文字节点仍在 DOM（藏是 CSS 的事）。
		expect(container.querySelector(".brand-name")).toBeTruthy();
		expect(container.querySelector(".topbar-flow .tb-tab")).toBeTruthy();
	});

	it("用 emoji 当图标的顶栏按钮带 .chip-emoji（免被「只显示图标」的 span 隐藏规则误杀）", () => {
		// 回归：临时对话按钮的图标是 `<span>🎭</span>`，与文字标签同为直接子 span；
		// 没有 .chip-emoji 时会被 `.topbar.no-labels .chip > span` 一起 display:none，
		// 按钮在顶栏变成一个空方块，而溢出菜单（portal 到 body，不在 .topbar 内）里正常
		// —— 表现为「折叠进 ⋯ 才看得见图标」。
		const { container } = mount("chat", undefined, undefined, undefined, {
			settings: { uiLayout: { topbarText: false } },
		});
		const glyph = container.querySelector(".topbar-flow .chip-emoji");
		expect(glyph).toBeTruthy();
		expect((glyph?.textContent ?? "").trim().length).toBeGreaterThan(0);
		// 静态锁：豁免必须写在 no-labels 的隐藏规则里（改了 CSS 忘了加 :not 就会红）。
		const css = readFileSync(join(ROOT, "web", "src", "styles.css"), "utf8");
		const rule = css.match(/\.topbar\.no-labels[\s\S]{0,600}?\.brand-name/);
		expect(rule?.[0]).toContain(":not(.chip-emoji)");
	});

	it("顶栏所有可点控件都带 data-tip（悬浮即时说明），唯品牌徽标例外", () => {
		const pluginAction = { ...hostEntry("demo:act"), source: "plugin:demo", label: "演示动作", kind: "action" };
		const pluginView = {
			...hostEntry("demo:__view"),
			source: "plugin:demo",
			label: "演示视图",
			kind: "view",
			view: "plugin:demo",
		};
		const { container } = mount("chat", [
			hostEntry("host:search"),
			hostEntry("host:chat"),
			hostEntry("host:terminal"),
			pluginAction,
			pluginView,
		]);
		const ctrls = [...container.querySelectorAll(".topbar-flow button, .topbar-flow a[href]")];
		expect(ctrls.length).toBeGreaterThan(4);
		for (const el of ctrls) {
			const tip = el.getAttribute("data-tip");
			expect(!!tip && tip.trim().length > 0, el.getAttribute("class") ?? undefined).toBe(true);
		}
	});

	it("默认（开关缺席）不挂 no-labels", () => {
		const { container } = mount("chat");
		expect(container.querySelector("header.topbar.no-labels")).toBeNull();
		expect(container.querySelector("header.topbar")).toBeTruthy();
	});

	it("品牌单独藏掉后不留空容器占位", () => {
		const { container } = mount("chat", [hostEntry("host:chat")]);
		expect(container.querySelector(".brand-logo")).toBeNull();
		expect(container.querySelector(".brand-name")).toBeNull();
		expect(container.querySelector(".brand")).toBeNull();
	});

	it("uiPrimary 一条不给时整条流是空的（不画任何条目，也不留空壳）", () => {
		const { container } = mount("chat", []);
		expect(flowItems(container).length).toBe(0);
		expect(container.querySelector(".plugin-topbar-more")).toBeNull();
	});
});

describe("顶栏不再有面板开关（☰ / 📁 均已删除）", () => {
	// 右栏缺省收起 → 入口是右边缘展开条；左栏同理。顶栏不该再出现任何 .panel-toggle
	// （类也一并删了，这里断言的是「结构上不存在」而不是 CSS 隐藏）。
	for (const view of ["chat", "terminal", "git", "plugin:demo-mailbox"] as const) {
		it(`${view} 视图：没有面板开关按钮`, () => {
			const { container, opened } = mount(view);
			expect(container.querySelectorAll("button.panel-toggle").length).toBe(0);
			// 顶栏本身照常渲染（视图 tab 是每个视图都有的条目）。
			expect(container.querySelector(".topbar-flow .tb-tab")).toBeTruthy();
			expect(opened).toEqual([]);
		});
	}
});

describe("TopBar「打开项目」入口（host:open-project）", () => {
	/** 受控 input 赋值（React 需要原生 setter + input 事件才会收到变更）。 */
	const setInput = (el: HTMLInputElement, value: string) => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
	};

	/** 带一条 host:open-project 的顶栏 + 收集 appSend 出去的协议消息。 */
	const mountWithPicker = () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const sent: { type: string; [k: string]: unknown }[] = [];
		setAppSend((msg) => {
			sent.push(msg as { type: string });
			return true;
		});
		const { container } = mount("chat", [hostEntry("host:open-project"), hostEntry("host:chat")]);
		return { container, sent };
	};

	afterEach(() => resetAppGlobals());

	it("主栏点它打开项目选择器（与左栏 📁+ 同一个对话框），点遮罩关掉", () => {
		const { container } = mountWithPicker();
		const btn = container.querySelector<HTMLButtonElement>("button.open-project");
		expect(btn).toBeTruthy();
		expect(document.querySelector(".project-picker")).toBeNull();
		act(() => btn!.click());
		// 对话框 fixed 定位、与左栏那份是同一个组件：挂在顶栏里也不会被裁剪
		expect(document.querySelector(".project-picker")).toBeTruthy();
		expect(document.querySelector(".project-picker-backdrop")).toBeTruthy();
		act(() => document.querySelector<HTMLElement>(".project-picker-backdrop")!.click());
		expect(document.querySelector(".project-picker")).toBeNull();
	});

	it("选当前目录发 set_cwd，＋新建项目发 make_dir(setAsCwd)", () => {
		const { sent } = mountWithPicker();
		const btn = document.querySelector<HTMLButtonElement>("button.open-project")!;
		act(() => btn.click());
		act(() => document.querySelector<HTMLButtonElement>(".cwd-choose-btn.primary")!.click());
		expect(sent.filter((m) => m.type === "set_cwd")).toEqual([{ type: "set_cwd", path: "/test" }]);

		// 再打开一次，走「＋ 新建项目」：合法名称 → make_dir + setAsCwd
		act(() => btn.click());
		act(() => document.querySelector<HTMLButtonElement>(".cwd-newbtn")!.click());
		const nameInput = document.querySelector<HTMLInputElement>(".cwd-newrow input")!;
		act(() => setInput(nameInput, "my-project"));
		act(() => document.querySelector<HTMLButtonElement>(".cwd-newrow button.primary")!.click());
		expect(sent.find((m) => m.type === "make_dir")).toEqual({
			type: "make_dir",
			path: "/test/my-project",
			setAsCwd: true,
		});
		expect(document.querySelector(".project-picker")).toBeNull();
	});

});

describe("TopBar 连接状态", () => {
	it("品牌区域不渲染连接圆点和连接状态文字", () => {
		const { container } = mount("chat");
		expect(container.querySelector(".topbar-flow .conn-dot")).toBeNull();
		expect(container.querySelector(".topbar-flow .conn-label")).toBeNull();
	});
});

describe("TopBar 槽位渲染（顺序即 slot 顺序，插件条目与宿主条目同级）", () => {
	const pluginViewEntry = (id: string, label: string, target: string) => ({
		id,
		source: "plugin:mail",
		slot: "topbar.primary" as const,
		label,
		kind: "view" as const,
		view: target,
		order: 100,
		align: "start" as const,
		hidden: false,
		userOverrides: [],
		arrangedBy: [],
	});
	const pluginActionEntry = (id: string) => ({
		id: `mail:${id}`,
		source: "plugin:mail",
		slot: "topbar.primary" as const,
		label: `L-${id}`,
		kind: "action" as const,
		order: 100,
		align: "start" as const,
		hidden: false,
		userOverrides: [],
		arrangedBy: [],
	});

	it("视图 tab 按 slot 顺序直排（不再写死 chat/terminal/git，也不再包容器）", () => {
		const { container } = mount("terminal", [
			hostEntry("host:git"),
			hostEntry("host:chat"),
			hostEntry("host:terminal"),
		]);
		const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
		expect(tabs.length).toBe(3);
		// 选中的 terminal 落在 slot 顺序的最后一位（文案随语言包变，用选中态定位）。
		expect(tabs.findIndex((b) => b.getAttribute("aria-selected") === "true")).toBe(2);
		tabs.forEach((t) => expect(t.parentElement?.classList.contains("topbar-flow")).toBe(true));
	});

	it("插件视图 tab 按 slot 顺序插进宿主三连之间", () => {
		const { container } = mount("chat", [
			hostEntry("host:chat"),
			pluginViewEntry("mail:__view", "Mailbox", "plugin:mail"),
			hostEntry("host:terminal"),
		]);
		const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
		expect(tabs.length).toBe(3);
		expect(tabs[1].classList.contains("plugin-tab")).toBe(true);
		expect(tabs[1].textContent).toContain("Mailbox");
	});

	it("插件动作不限 4 个：5 个全进主栏、无溢出时不画 ⋯", () => {
		const { container } = mount("chat", [
			hostEntry("host:chat"),
			pluginActionEntry("a"),
			pluginActionEntry("b"),
			pluginActionEntry("c"),
			pluginActionEntry("d"),
			pluginActionEntry("e"),
		]);
		expect(container.querySelectorAll(".plugin-topbar-item").length).toBe(5);
		expect(container.querySelector(".plugin-topbar-more")).toBeNull();
	});

	it("报错插件的视图 tab 置灰保留（走 plugins 清单兜底，slot 里没有它）", () => {
		const { container } = mount("chat", [hostEntry("host:chat")], undefined, [
			{ id: "mail", name: "Mail", error: "boom" },
		]);
		const broken = container.querySelector(".plugin-tab.broken");
		expect(broken?.textContent).toContain("Mail");
		// 报错原因走 data-tip 即时气泡（顶栏直流内不用原生 title，见上）
		expect(broken?.getAttribute("data-tip")).toContain("boom");
	});
});
