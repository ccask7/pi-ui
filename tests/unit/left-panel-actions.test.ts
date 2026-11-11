// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { LeftPanel } from "../../web/src/components/LeftPanel.js";
import { joinProjectPath, isValidProjectName, parentOf, MACHINE_ROOT } from "../../web/src/components/ProjectPicker.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import { resetAppGlobals, setAppGlobals } from "../../web/src/app-globals.js";
import { buildUiSlots } from "../../web/src/ui-slots.js";
import { getContextMenu, resetContextMenu } from "../../web/src/context-menu-state.js";

let root: Root | null = null;

/** 内存 localStorage：某些 jsdom/CI 环境的存储不可写，桩掉以保证语言确定为中文。 */
function stubZhStorage() {
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
	} as unknown as Storage);
	localStorage.setItem("ccui:lang", "zh");
}

function mountLeftPanel(overrides: Record<string, unknown> = {}) {
	stubZhStorage();
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	const sent: unknown[] = [];
	const panelSend = (msg: unknown) => {
		sent.push(msg);
		return true;
	};
	const props = {
		active: true,
		sessionFile: null,
		conversations: [],
		elsewhere: [],
		sessions: [
			{
				path: "session-1.jsonl",
				name: "Test Session",
				firstMessage: "Hello",
				modified: Date.now(),
				messageCount: 1,
			},
		],
		projectSessions: {
			"/test": [
				{
					path: "session-1.jsonl",
					name: "Test Session",
					firstMessage: "Hello",
					modified: Date.now(),
					messageCount: 1,
				},
			],
		},
		projects: [{ path: "/test", lastUsed: Date.now() }],
		activeConversationId: "",
		onOpenPlugins: () => {},
		onNewTask: () => {},
		pluginsActive: false,
		onOpenGlobalSearch: () => {},
		panelSend,
		pathCompletions: [
			{ name: "sub1", path: "/test/sub1", type: "dir" as const },
			{ name: "sub2", path: "/test/sub2", type: "dir" as const },
			{ name: "file.txt", path: "/test/file.txt", type: "file" as const },
		],
		...overrides,
	};
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				createElement(LeftPanel as any, props),
			),
		);
	});
	return { container, sent };
}

afterEach(() => {
	vi.unstubAllGlobals();
	resetAppGlobals();
	resetContextMenu();
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
});

describe("LeftPanel 标题栏操作与项目管理", () => {
	it("历史分支会话显示分支小标识，但不增加悬浮提示", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const sessions = [
			{
				path: "branch.jsonl",
				name: "分支会话",
				firstMessage: "Hello",
				modified: Date.now(),
				messageCount: 1,
				isBranch: true,
			},
		];
		const { container } = mountLeftPanel({ sessions, projectSessions: { "/test": sessions } });
		const badge = container.querySelector(".session-fork-badge");
		expect(badge?.textContent).toBe("分支");
		expect(badge?.getAttribute("title")).toBeNull();
	});

	it("projects=[] 时仍渲染“项目”标题栏和项目管理按钮，并保留统一树滚动区", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container } = mountLeftPanel({ projects: [] });

		// 标题栏存在
		const projectsSection = container.querySelector(".panel-projects");
		expect(projectsSection).toBeTruthy();
		expect(projectsSection?.textContent).toContain("项目");

		// 项目管理按钮存在
		const projectActionBtn = container.querySelector(".lp-project-action");
		expect(projectActionBtn).toBeTruthy();

		expect(container.querySelector(".project-tree-scroll")).toBeTruthy();
		expect(container.querySelector(".lp-sash")).toBeNull();
	});

	it("项目上方提供品牌、搜索、新建任务与插件入口，项目标题不显示数量", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const onOpenPlugins = vi.fn();
		const onNewTask = vi.fn();
		const onOpenGlobalSearch = vi.fn();
		const { container, sent } = mountLeftPanel({ onOpenPlugins, onNewTask, onOpenGlobalSearch });
		const actions = container.querySelectorAll<HTMLButtonElement>(".lp-primary-action");
		expect(actions).toHaveLength(2);
		expect(actions[0].textContent).toContain("新建任务");
		expect(container.querySelector(".lp-tree-heading")?.textContent).toBe("项目");
		expect(container.querySelector(".lp-brand-name")?.textContent).toBe("Cc");
		act(() => container.querySelector<HTMLButtonElement>(".lp-brand-search")!.click());
		expect(onOpenGlobalSearch).toHaveBeenCalledOnce();

		sent.length = 0;
		act(() => actions[0].click());
		expect(onNewTask).toHaveBeenCalledOnce();
		expect(sent).toEqual([]);
		act(() => actions[1].click());
		expect(onOpenPlugins).toHaveBeenCalledOnce();
	});

	it("品牌行用侧栏图标收起面板，搜索按钮保持独立", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const onToggleCollapse = vi.fn();
		const { container } = mountLeftPanel({ collapsible: true, onToggleCollapse });
		const toggle = container.querySelector<HTMLButtonElement>(".lp-brand-toggle");
		expect(toggle).toBeTruthy();
		expect(toggle?.getAttribute("aria-label")).toBe("收起面板");
		expect(container.querySelector(".panel-collapse-btn")).toBeNull();
		act(() => toggle!.click());
		expect(onToggleCollapse).toHaveBeenCalledOnce();
	});

	it("会话删除只保留在右键菜单中，并在菜单内二次确认", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const slots = buildUiSlots([], { locale: "zh", t: (key) => key });
		const { container, sent } = mountLeftPanel({ uiContextSession: slots["contextmenu.session"] });
		const row = container.querySelector<HTMLElement>(".lp-tree-session-row")!;
		expect(row.querySelector(":scope > .lp-del:not(.lp-rename)")).toBeNull();

		act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 30 })));
		const menu = getContextMenu()!;
		const entry = menu.entries.find((item) => item.id === "host:conv-delete")!;
		expect(entry.hidden).not.toBe(true);
		let keepOpen: void | boolean = undefined;
		act(() => {
			keepOpen = menu.onHostAction?.(entry, menu.target);
		});
		expect(keepOpen).toBe(true);
		expect(sent.some((msg: any) => msg.type === "delete_session")).toBe(false);
		const confirmation = getContextMenu()!;
		const confirmEntry = confirmation.entries.find((item) => item.id === "host:conv-delete")!;
		expect(confirmEntry.label).toBe("确认删除");
		act(() => confirmation.onHostAction?.(confirmEntry, confirmation.target));
		expect(sent).toContainEqual({ type: "delete_session", path: "session-1.jsonl" });
	});

	it("目录默认显示最近 5 个会话，点击查看更多后显示全部", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const history = Array.from({ length: 7 }, (_, index) => ({
			path: `session-${index + 1}.jsonl`,
			name: `Session ${index + 1}`,
			firstMessage: "",
			modified: 1000 - index,
			messageCount: 1,
		}));
		const { container } = mountLeftPanel({ sessions: history, projectSessions: { "/test": history } });

		expect(container.querySelectorAll(".lp-tree-session-row")).toHaveLength(5);
		const more = container.querySelector<HTMLButtonElement>(".lp-tree-more");
		expect(more?.textContent).toContain("查看更多(2)");
		act(() => more!.click());
		expect(container.querySelectorAll(".lp-tree-session-row")).toHaveLength(7);
		expect(container.querySelector(".lp-tree-more")).toBeNull();

		// 点击目录名称区域收起；重新展开后恢复最近 5 条与“查看更多”。
		const project = container.querySelector<HTMLButtonElement>(".project-item");
		act(() => project!.click());
		expect(container.querySelectorAll(".lp-tree-session-row")).toHaveLength(0);
		act(() => project!.click());
		expect(container.querySelectorAll(".lp-tree-session-row")).toHaveLength(5);
		expect(container.querySelector(".lp-tree-more")?.textContent).toContain("查看更多(2)");
	});

	it("当前项目默认展开；展开其他项目时按需请求该项目历史，不切换 cwd", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container, sent } = mountLeftPanel({
			projects: [
				{ path: "/test", lastUsed: 2 },
				{ path: "/other", lastUsed: 1 },
			],
		});

		expect(container.querySelectorAll(".lp-tree-session-row")).toHaveLength(1);
		const otherToggle = container.querySelectorAll<HTMLButtonElement>(".lp-tree-toggle")[1];
		sent.length = 0;
		act(() => otherToggle.click());
		expect(sent).toEqual([{ type: "list_project_sessions", path: "/other" }]);
		expect(sent.some((msg: any) => msg.type === "set_cwd")).toBe(false);
		expect(otherToggle.getAttribute("aria-expanded")).toBe("true");
	});

	it("目录收起后收到本次 cwd 切换结果，不会被自动重新展开", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container } = mountLeftPanel({
			projects: [
				{ path: "/test", lastUsed: 2 },
				{ path: "/other", lastUsed: 1 },
			],
		});
		const otherProject = container.querySelectorAll<HTMLButtonElement>(".project-item")[1];
		act(() => otherProject.click());
		expect(container.querySelectorAll<HTMLButtonElement>(".lp-tree-toggle")[1].getAttribute("aria-expanded")).toBe(
			"true",
		);
		act(() => otherProject.click());
		expect(container.querySelectorAll<HTMLButtonElement>(".lp-tree-toggle")[1].getAttribute("aria-expanded")).toBe(
			"false",
		);

		act(() => setAppGlobals({ cwd: "/other" }));
		expect(container.querySelectorAll<HTMLButtonElement>(".lp-tree-toggle")[1].getAttribute("aria-expanded")).toBe(
			"false",
		);
	});

	it("标题行容器与折叠按钮不产生嵌套 button（无 button button）", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container } = mountLeftPanel({ projects: [] });

		// 保证没有嵌套按钮
		const nestedButtons = container.querySelectorAll("button button");
		expect(nestedButtons.length).toBe(0);
	});

	it("点击项目管理按钮打开项目管理面板，点击遮罩或按 Escape 键可关闭", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container } = mountLeftPanel({ projects: [] });

		const projectActionBtn = container.querySelector<HTMLButtonElement>(".lp-project-action");
		expect(projectActionBtn).toBeTruthy();

		// 点击打开项目管理面板
		act(() => projectActionBtn!.click());
		const dialog = container.querySelector("[role=dialog]");
		expect(dialog).toBeTruthy();

		// 按 Escape 键关闭
		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		expect(container.querySelector("[role=dialog]")).toBeNull();

		// 再次打开并点击遮罩关闭
		act(() => projectActionBtn!.click());
		expect(container.querySelector("[role=dialog]")).toBeTruthy();
		const backdrop = container.querySelector(".status-cwd-backdrop, .project-picker-backdrop");
		expect(backdrop).toBeTruthy();
		act(() => (backdrop as HTMLElement).click());
		expect(container.querySelector("[role=dialog]")).toBeNull();
	});

	it("项目管理面板：非法项目名称（空或含分隔符）不能发送创建消息，合法名称发送 make_dir(setAsCwd: true)", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container, sent } = mountLeftPanel({ projects: [] });

		const projectActionBtn = container.querySelector<HTMLButtonElement>(".lp-project-action");
		act(() => projectActionBtn!.click());

		// 展开新建项目输入框
		const newBtn = container.querySelector<HTMLButtonElement>(".cwd-newbtn, .project-picker-newbtn");
		expect(newBtn).toBeTruthy();
		act(() => newBtn!.click());

		const input = container.querySelector<HTMLInputElement>(".cwd-newrow input, .project-picker-newrow input");
		expect(input).toBeTruthy();
		const createBtn = container.querySelector<HTMLButtonElement>(
			".cwd-newrow button.primary, .project-picker-newrow button.primary",
		);
		expect(createBtn).toBeTruthy();

		// 空名称点击
		sent.length = 0;
		act(() => createBtn!.click());
		expect(sent.filter((m: any) => m.type === "make_dir")).toHaveLength(0);

		// 包含路径分隔符
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "foo/bar");
			input!.dispatchEvent(new Event("input", { bubbles: true }));
		});
		act(() => createBtn!.click());
		expect(sent.filter((m: any) => m.type === "make_dir")).toHaveLength(0);

		// 合法名称
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "my-new-project");
			input!.dispatchEvent(new Event("input", { bubbles: true }));
		});
		act(() => createBtn!.click());
		const makeDirMsg = sent.find((m: any) => m.type === "make_dir") as any;
		expect(makeDirMsg).toBeTruthy();
		expect(makeDirMsg.setAsCwd).toBe(true);
		expect(makeDirMsg.path).toContain("my-new-project");
	});

	it("项目管理面板：选择现有目录发送 set_cwd", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container, sent } = mountLeftPanel({ projects: [] });

		const projectActionBtn = container.querySelector<HTMLButtonElement>(".lp-project-action");
		act(() => projectActionBtn!.click());

		const chooseBtns = Array.from(
			container.querySelectorAll<HTMLButtonElement>(".cwd-choose-btn, .project-picker-choose-btn"),
		);
		expect(chooseBtns.length).toBeGreaterThan(0);

		sent.length = 0;
		act(() => chooseBtns[0].click());
		const setCwdMsg = sent.find((m: any) => m.type === "set_cwd") as any;
		expect(setCwdMsg).toBeTruthy();
		expect(setCwdMsg.path).toBeTruthy();
	});

	it("joinProjectPath 纯函数正确处理 POSIX 和 Windows 根与路径拼接", () => {
		expect(joinProjectPath("/", "foo")).toBe("/foo");
		expect(joinProjectPath("/a", "b")).toBe("/a/b");
		expect(joinProjectPath("/a/", "b")).toBe("/a/b");
		expect(joinProjectPath("C:", "foo")).toBe("C:/foo");
		expect(joinProjectPath("C:/", "foo")).toBe("C:/foo");
		expect(joinProjectPath("C:\\dir", "sub")).toBe("C:/dir/sub");
	});

	it("isValidProjectName 校验项目名称合法性", () => {
		expect(isValidProjectName("my-project")).toBe(true);
		expect(isValidProjectName("  my-project  ")).toBe(true);
		expect(isValidProjectName("")).toBe(false);
		expect(isValidProjectName("   ")).toBe(false);
		expect(isValidProjectName(".")).toBe(false);
		expect(isValidProjectName("..")).toBe(false);
		expect(isValidProjectName("foo/bar")).toBe(false);
		expect(isValidProjectName("foo\\bar")).toBe(false);
	});

	it("parentOf 返回父路径或在根处返回 null", () => {
		expect(parentOf("/")).toBeNull();
		expect(parentOf(MACHINE_ROOT)).toBeNull();
		expect(parentOf("/a")).toBe("/");
		expect(parentOf("/a/b")).toBe("/a");
		expect(parentOf("/a/b/")).toBe("/a");
		expect(parentOf("C:")).toBe(MACHINE_ROOT);
		expect(parentOf("C:/")).toBe(MACHINE_ROOT);
		expect(parentOf("C:/Users")).toBe("C:/");
		expect(parentOf("C:/Users/test")).toBe("C:/Users");
	});
});

describe("LeftPanel 会话行内嵌区", () => {
	const sectionEntry = (id: string, label: string, icon: string) => ({
		id,
		source: "host",
		slot: "leftpanel.sessions",
		label,
		kind: "action",
		icon,
		order: 10,
		align: "start",
		hidden: false,
		userOverrides: [],
		arrangedBy: [],
	});

	it("分区别名条目不进会话行（行内无 activity/clock 原文）；插件行动作正常渲染", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container } = mountLeftPanel({
			uiLeftSessions: [
				sectionEntry("host:lp-running", "运行的对话", "activity"),
				sectionEntry("host:lp-history", "历史对话", "clock"),
				{
					id: "plug:x:go",
					source: "plugin:x",
					slot: "leftpanel.sessions",
					label: "Go",
					kind: "action",
					order: 100,
					align: "start",
					hidden: false,
					userOverrides: [],
					arrangedBy: [],
				},
			],
		});
		const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".lp-slot-btn"));
		// 只有插件那一条；分区别名两条被过滤（以前会按原文画出 activity/clock）
		expect(buttons).toHaveLength(1);
		expect(buttons[0]?.getAttribute("aria-label")).toBe("Go");
		expect(buttons.every((b) => !/activity|clock/.test(b.textContent ?? ""))).toBe(true);
	});

	it("内嵌区为空时不留 .lp-slot-sessions 占位（会话行 DOM 与旧版一致）", () => {
		setAppGlobals({ cwd: "/test", ready: true, status: "open", workspaceRoots: [] });
		const { container } = mountLeftPanel({
			uiLeftSessions: [
				sectionEntry("host:lp-projects", "最近项目", "folder"),
				sectionEntry("host:lp-running", "运行的对话", "activity"),
				sectionEntry("host:lp-history", "历史对话", "clock"),
			],
		});
		expect(container.querySelector(".lp-slot-sessions")).toBeNull();
		expect(container.querySelector(".lp-slot-btn")).toBeNull();
	});
});
