// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FooterBar } from "../../web/src/components/FooterBar.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { ChatState } from "../../web/src/use-chat.js";
import { resetAppGlobals, setAppGlobals } from "../../web/src/app-globals.js";

let root: Root | null = null;

function makeChatState(overrides: Partial<ChatState> = {}): ChatState {
	return {
		status: "open",
		ready: true,
		state: {
			cwd: "D:/test-project",
			sessionFile: null,
			conversationId: "conv-1",
			history: [],
			queue: { steering: [], followUp: [] },
			isStreaming: false,
			streamingMessage: null,
			stats: {
				tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				contextUsage: { tokens: 0, contextWindow: 8000, percent: 0, estimated: false },
				cost: 0,
				totalMessages: 0,
			},
		} as unknown as ChatState["state"],
		activeConversationId: "conv-1",
		conversations: [],
		elsewhere: [],
		sessions: [],
		projects: [],
		terminals: [],
		bgServers: [],
		pathCompletions: [],
		notices: [],
		statuses: [],
		...overrides,
	} as unknown as ChatState;
}

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

function mountFooter(chat: ChatState) {
	stubZhStorage();
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root!.render(createElement(LanguageProvider, null, createElement(FooterBar, { chat })));
	});
	return { container };
}

afterEach(() => {
	vi.unstubAllGlobals();
	resetAppGlobals();
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
});

describe("FooterBar 连接状态", () => {
	it("status=open 且 ready=true 时只渲染连接状态符号", () => {
		setAppGlobals({ ready: true, status: "open" });
		const chat = makeChatState({ ready: true, status: "open" });
		const { container } = mountFooter(chat);
		const connWrapper = container.querySelector(".status-conn");
		expect(connWrapper).toBeTruthy();
		expect(connWrapper?.textContent).toBe("");
		// 页面中只有一处连接包装节点
		expect(container.querySelectorAll(".status-conn").length).toBe(1);
	});

	it("status=connecting 且 ready=false 时使用 busy 状态符号", () => {
		setAppGlobals({ ready: false, status: "connecting" });
		const chat = makeChatState({ ready: false, status: "connecting" });
		const { container } = mountFooter(chat);
		const connWrapper = container.querySelector(".status-conn");
		expect(connWrapper).toBeTruthy();
		expect(connWrapper?.textContent).toBe("");
		expect(connWrapper?.classList.contains("busy")).toBe(true);
	});

	it("status=closed 且 ready=false 时使用 error 状态符号", () => {
		setAppGlobals({ ready: false, status: "closed" });
		const chat = makeChatState({ ready: false, status: "closed" });
		const { container } = mountFooter(chat);
		const connWrapper = container.querySelector(".status-conn");
		expect(connWrapper).toBeTruthy();
		expect(connWrapper?.textContent).toBe("");
		expect(connWrapper?.classList.contains("error")).toBe(true);
	});

	it("Context 按终端格式显示百分比与物理上下文窗口", () => {
		const chat = makeChatState({
			state: {
				stats: {
					tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					contextUsage: { tokens: 4000, contextWindow: 8000, percent: 50, estimated: false },
					cost: 0,
					totalMessages: 0,
				},
				queue: { steering: [], followUp: [] },
			} as unknown as ChatState["state"],
		});
		const { container } = mountFooter(chat);
		const ctxWrapper = container.querySelector(".status-ctx");
		expect(ctxWrapper).toBeTruthy();
		expect(ctxWrapper?.textContent).toBe("50.0%/8.0k");
		expect(container.querySelector(".ctx-bar")).toBeNull();
	});

	it("存在 softCap 时仍显示物理上下文窗口", () => {
		const chat = makeChatState({
			state: {
				stats: {
					tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					contextUsage: {
						tokens: 150000,
						contextWindow: 1000000,
						softCap: 300000,
						percent: 15,
						estimated: false,
					},
					cost: 0,
					totalMessages: 0,
				},
				queue: { steering: [], followUp: [] },
			} as unknown as ChatState["state"],
		});
		const { container } = mountFooter(chat);
		const ctxWrapper = container.querySelector(".status-ctx") as HTMLElement;
		expect(ctxWrapper).toBeTruthy();
		expect(ctxWrapper?.textContent).toBe("15.0%/1.0M");
		expect(ctxWrapper?.title).toBe("");
	});

	it("token 统计按终端字段显示，零值项不占位", () => {
		const chat = makeChatState({
			state: {
				stats: {
					tokens: { input: 1200, output: 4200, cacheRead: 9800, cacheWrite: 0, total: 15200 },
					contextUsage: { tokens: 4000, contextWindow: 8000, percent: 50, estimated: false },
					cost: 0.123,
					totalMessages: 8,
				},
				queue: { steering: [], followUp: [] },
			} as unknown as ChatState["state"],
		});
		const { container } = mountFooter(chat);
		expect(container.querySelector(".status-token-stats")?.textContent).toBe("↑1.2k↓4.2kR9.8kCH89.1%");
		expect(container.querySelector(".status-token-stats")?.textContent).not.toContain("W");
		expect(container.querySelector(".status-host-metrics")).toBeNull();
		expect(container.querySelector(".status-token-stats")?.getAttribute("title")).toBeNull();
	});
});
