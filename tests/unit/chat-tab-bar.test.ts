// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ChatTabBar } from "../../web/src/components/ChatTabBar.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { ConversationSummary } from "../../web/src/types.js";

let root: Root | null = null;
afterEach(() => {
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
});

describe("会话标签", () => {
	it("插件页中点击当前标签也发送切换，以便 panelSend 退出插件页", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		const panelSend = vi.fn(() => true);
		const conversation = { id: "c1", title: "当前会话", cwd: "/project" } as ConversationSummary;
		act(() => {
			root!.render(
				createElement(
					LanguageProvider,
					null,
					createElement(ChatTabBar, {
						conversations: [conversation],
						elsewhere: [],
						activeConversationId: "c1",
						panelSend,
					}),
				),
			);
		});
		const tab = container.querySelector<HTMLButtonElement>('.chat-tab-main[role="tab"]')!;
		expect(tab.getAttribute("aria-selected")).toBe("true");
		act(() => tab.click());
		expect(panelSend).toHaveBeenCalledWith({ type: "switch_conversation", id: "c1" });
	});

	it("会话标签直接使用真实名称，重命名也使用同一名称", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		const source = {
			id: "c1",
			title: "原会话",
			cwd: "/project",
			// 即使来源自身也是更早的分支，产生新分支后也不追加分支文字。
			forkFrom: { conversationId: "c0", title: "更早会话" },
		} as ConversationSummary;
		const conversation = {
			id: "c2",
			title: "分支会话(分支)",
			cwd: "/project",
			forkFrom: { conversationId: "c1", title: "原会话" },
		} as ConversationSummary;
		act(() => {
			root!.render(
				createElement(
					LanguageProvider,
					null,
					createElement(ChatTabBar, {
						conversations: [source, conversation],
						elsewhere: [],
						activeConversationId: "c2",
						panelSend: vi.fn(() => true),
					}),
				),
			);
		});
		const tabs = container.querySelectorAll(".chat-tab");
		expect(tabs).toHaveLength(2);
		expect(tabs[0].querySelector(".chat-tab-title")?.textContent).toBe("原会话");
		expect(tabs[1].querySelector(".chat-tab-title")?.textContent).toBe("分支会话(分支)");
		expect(tabs[1].querySelector(".chat-tab-flag")).toBeNull();
		act(() => {
			tabs[1]
				.querySelector<HTMLButtonElement>(".chat-tab-main")!
				.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		});
		expect(tabs[1].querySelector<HTMLInputElement>(".chat-tab-rename")?.value).toBe("分支会话(分支)");
	});

	it("设置和插件复用同一工作区页面标签并支持关闭", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		const onClosePage = vi.fn();
		act(() => {
			root!.render(
				createElement(
					LanguageProvider,
					null,
					createElement(ChatTabBar, {
						conversations: [],
						elsewhere: [],
						activeConversationId: "",
						page: { id: "main:memory", title: "记忆", kind: "plugin" },
						onClosePage,
						panelSend: vi.fn(() => true),
					}),
				),
			);
		});
		const tab = container.querySelector<HTMLElement>('.workspace-page-tab[data-page-id="main:memory"]');
		expect(tab?.textContent).toContain("记忆");
		act(() => tab!.querySelector<HTMLButtonElement>(".chat-tab-act.close")!.click());
		expect(onClosePage).toHaveBeenCalledOnce();
	});
});
