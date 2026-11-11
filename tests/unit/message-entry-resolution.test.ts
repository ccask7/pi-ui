import { describe, expect, it } from "vitest";
import { ClientSession } from "../../server/agent-service.js";
import type { UiMessage } from "../../server/protocol.js";

interface TestMessage {
	role: string;
	content?: unknown;
	timestamp?: number;
	customType?: string;
	summary?: string;
	command?: string;
	output?: string;
}

interface TestEntry {
	id: string;
	parentId: string | null;
	type: string;
	timestamp?: string;
	message?: TestMessage;
}

function makeConversation(entries: TestEntry[]) {
	return {
		msgIds: new Map<string, number>(),
		nextMsgId: 1,
		idSeqByRoleTs: new Map<string, number>(),
		uiMessageCache: new Map<string, UiMessage>(),
		session: { sessionManager: { buildContextEntries: () => entries, getEntry: () => undefined } },
	};
}

function serialize(conversation: ReturnType<typeof makeConversation>, message: TestMessage): UiMessage {
	const serializer = { uiMessageKey: ClientSession.prototype["uiMessageKey"] };
	return Reflect.apply(ClientSession.prototype["serializeCachedFor"], serializer, [conversation, message]) as UiMessage;
}

function resolve(conversation: ReturnType<typeof makeConversation>, messageId: string) {
	return Reflect.apply(ClientSession.prototype["resolveMessageEntry"], {}, [
		conversation,
		messageId,
	]) as TestEntry | null;
}

const iso = (value: string) => new Date(value).getTime();

describe("消息节点 ID 解析", () => {
	it("助手消息的序列化 ID 能解析回同一节点", () => {
		const entries: TestEntry[] = [
			{
				id: "entry-user",
				parentId: null,
				type: "message",
				message: { role: "user", content: "question", timestamp: 1000 },
			},
			{
				id: "entry-assistant",
				parentId: "entry-user",
				type: "message",
				message: { role: "assistant", content: [], timestamp: 1005 },
			},
		];
		const conversation = makeConversation(entries);
		for (const entry of entries) serialize(conversation, entry.message!);
		const assistant = serialize(conversation, entries[1].message!);

		expect(assistant.id).toBe("a-1005-1");
		expect(resolve(conversation, assistant.id)).toBe(entries[1]);
	});

	it("路径里插入了非消息条目，bash 消息的 ID 仍能解析（序号不再取条目下标）", () => {
		const entries: TestEntry[] = [
			{ id: "entry-think", parentId: null, type: "thinking_level_change" },
			{ id: "entry-model", parentId: "entry-think", type: "model_change" },
			{
				id: "entry-user",
				parentId: "entry-model",
				type: "message",
				message: { role: "user", content: "run ls", timestamp: 2000 },
			},
			{
				id: "entry-bash",
				parentId: "entry-user",
				type: "message",
				message: { role: "bashExecution", command: "ls", output: "", content: [], timestamp: 2001 },
			},
		];
		const conversation = makeConversation(entries);
		for (const entry of entries) if (entry.message) serialize(conversation, entry.message);
		const bash = serialize(conversation, entries[3].message!);

		expect(bash.id).toBe("b-2001-1");
		expect(resolve(conversation, bash.id)).toBe(entries[3]);
	});

	it("同一角色同一时间戳的消息按出现顺序编号，各自解析回对应节点", () => {
		const entries: TestEntry[] = [
			{
				id: "entry-a1",
				parentId: null,
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "first" }], timestamp: 3000 },
			},
			{
				id: "entry-a2",
				parentId: "entry-a1",
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "second" }], timestamp: 3000 },
			},
		];
		const conversation = makeConversation(entries);
		const first = serialize(conversation, entries[0].message!);
		const second = serialize(conversation, entries[1].message!);

		expect([first.id, second.id]).toEqual(["a-3000-1", "a-3000-2"]);
		expect(resolve(conversation, second.id)).toBe(entries[1]);
	});

	it("custom_message / branch_summary / compaction 条目也能按 ID 解析回节点", () => {
		const customTs = "2026-11-05T00:00:00.000Z";
		const branchTs = "2026-11-05T00:00:01.000Z";
		const compactTs = "2026-11-05T00:00:02.000Z";
		const entries: TestEntry[] = [
			{ id: "entry-think", parentId: null, type: "thinking_level_change" },
			{ id: "entry-custom", parentId: "entry-think", type: "custom_message", timestamp: customTs },
			{ id: "entry-branch", parentId: "entry-custom", type: "branch_summary", timestamp: branchTs },
			{ id: "entry-compact", parentId: "entry-branch", type: "compaction", timestamp: compactTs },
		];
		const conversation = makeConversation(entries);
		// 与 SDK 的 sessionEntryToContextMessages() 一致：条目 → 合成消息（timestamp 为毫秒）。
		const custom = serialize(conversation, {
			role: "custom",
			customType: "note",
			content: "note",
			timestamp: iso(customTs),
		});
		const branch = serialize(conversation, { role: "branchSummary", summary: "branch", timestamp: iso(branchTs) });
		const compact = serialize(conversation, {
			role: "compactionSummary",
			summary: "compaction",
			timestamp: iso(compactTs),
		});

		expect(custom.id).toBe(`c-${iso(customTs)}-1`);
		expect(branch.id).toBe(`bs-${iso(branchTs)}-1`);
		expect(compact.id).toBe(`cs-${iso(compactTs)}-1`);
		expect(resolve(conversation, custom.id)).toBe(entries[1]);
		expect(resolve(conversation, branch.id)).toBe(entries[2]);
		expect(resolve(conversation, compact.id)).toBe(entries[3]);
	});
});
