import { describe, expect, it } from "vitest";
import { ClientSession } from "../../server/agent-service.js";

function makeConversation(messageCount: number) {
	return {
		id: "conv-1",
		title: "新对话",
		parentId: undefined,
		isSubagent: false,
		listed: false,
		promptedSinceActive: false,
		wizardRunning: false,
		goal: { reviewing: false },
		session: {
			sessionFile: null,
			isStreaming: false,
			isCompacting: false,
			getSessionStats: () => ({ totalMessages: messageCount }),
		},
		terminals: { countBlockingLive: () => 0 },
	};
}

function displace(conversation: ReturnType<typeof makeConversation>) {
	const context = {
		conv: conversation,
		activeId: conversation.id,
		convs: new Map([[conversation.id, conversation]]),
		hasConversationContent: ClientSession.prototype["hasConversationContent"],
	};
	return Reflect.apply(ClientSession.prototype["displaceActive"], context, []);
}

async function switchConversation(
	active: ReturnType<typeof makeConversation>,
	target: ReturnType<typeof makeConversation>,
): Promise<void> {
	const convs = new Map([
		[active.id, active],
		[target.id, target],
	]);
	const context = {
		convs,
		activeId: active.id,
		cwd: "/project",
		displaceActive: () => null,
		webUi: { refresh: () => {} },
		emitConversations: () => {},
		goalSvc: { emitGoalStatus: () => {} },
		pushTerminals: () => {},
		pushSlashCommands: async () => {},
		notifyConversationChanged: () => {},
		flushSnapshot: () => {},
	};
	Object.defineProperty(context, "conv", { get: () => convs.get(context.activeId) });
	await Reflect.apply(ClientSession.prototype["switchConversation"], context, [target.id]);
}

describe("会话标签切换保留", () => {
	it("只打开历史但本次没有新发言，切走后自动关闭", () => {
		const conversation = makeConversation(2);
		expect(displace(conversation)).toBe(conversation);
		expect(conversation.listed).toBe(false);
	});

	it("本次发送过消息的会话切走后保留", () => {
		const conversation = { ...makeConversation(2), promptedSinceActive: true };
		expect(displace(conversation)).toBeNull();
		expect(conversation.listed).toBe(true);
	});

	it("切回已经对话过的标签不会清除保留标记", async () => {
		const active = { ...makeConversation(2), id: "conv-active", cwd: "/project" };
		const used = { ...makeConversation(2), id: "conv-used", cwd: "/project", promptedSinceActive: true };
		await switchConversation(active, used);
		expect(used.promptedSinceActive).toBe(true);
		expect(displace(used)).toBeNull();
	});

	it("空白新会话仍可自动清理，避免堆出空标签", () => {
		const conversation = makeConversation(0);
		expect(displace(conversation)).toBe(conversation);
		expect(conversation.listed).toBe(false);
	});

	it("曾经入列但本次未继续的空白会话也不会被永久保留", () => {
		const conversation = { ...makeConversation(0), listed: true };
		expect(displace(conversation)).toBe(conversation);
	});
});
