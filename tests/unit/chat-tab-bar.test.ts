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
});
