import { describe, expect, it } from "vitest";
import type { UiMessage } from "../../web/src/types.js";
import { collectTurnActivities, findRecentTurnStart } from "../../web/src/activity-turns.js";

function message(id: string, role: string, content: UiMessage["content"], timestamp = 1000): UiMessage {
	return { id, role, content, timestamp };
}

describe("按用户回合聚合工作记录", () => {
	it("同一轮多条助手消息共享一个分组并保持步骤顺序", () => {
		const messages = [
			message("u1", "user", [{ type: "text", text: "任务" }]),
			message(
				"a1",
				"assistant",
				[
					{ type: "thinking", thinking: "先检查" },
					{ type: "toolCall", id: "t1", name: "read", arguments: {} },
				],
				2000,
			),
			message("r1", "toolResult", [{ type: "text", text: "结果" }], 3000),
			message(
				"a2",
				"assistant",
				[
					{ type: "text", text: "继续处理" },
					{ type: "toolCall", id: "t2", name: "edit", arguments: {} },
				],
				4000,
			),
			message("a3", "assistant", [{ type: "text", text: "完成" }], 5000),
		];
		const groups = collectTurnActivities(messages, false);
		const first = groups.get("a1");
		expect(first?.ownerId).toBe("a1");
		expect(first?.startedAt).toBe(2000);
		expect(first?.blocks.map((block) => block.type)).toEqual(["thinking", "toolCall", "toolCall"]);
		expect(groups.get("a2")).toBe(first);
		expect(groups.get("a3")).toBe(first);
		expect(first?.headerId).toBe("a1");
		expect(first?.finalTextId).toBe("a3");
		expect(first?.summary.id).toBe("a1");
		expect(first?.summary.content[0]).toEqual({ type: "text", text: "完成" });
		expect(first?.summary.content.filter((block) => block.type === "toolCall")).toHaveLength(2);
	});

	it("下一条用户消息开启独立分组，运行状态只属于最后一轮", () => {
		const messages = [
			message("u1", "user", [{ type: "text", text: "第一项" }]),
			message("a1", "assistant", [{ type: "thinking", thinking: "旧思考" }], 2000),
			message("u2", "user", [{ type: "text", text: "第二项" }], 3000),
			message("a2", "assistant", [{ type: "thinking", thinking: "新思考" }], 4000),
		];
		const groups = collectTurnActivities(messages, true);
		expect(groups.get("a1")).not.toBe(groups.get("a2"));
		expect(groups.get("a1")?.streaming).toBe(false);
		expect(groups.get("a2")?.streaming).toBe(true);
		expect(groups.get("a2")?.ownerId).toBe("a2");
		expect(groups.get("a1")?.finalTextId).toBeNull();
		expect(groups.get("a2")?.finalTextId).toBeNull();
	});

	it("阶段正文各自独立，运行结束后最后一条正文成为最终回答", () => {
		const groups = collectTurnActivities(
			[
				message("u1", "user", [{ type: "text", text: "修复问题" }]),
				message("a1", "assistant", [{ type: "text", text: "先检查日志" }], 2000),
				message("a2", "assistant", [{ type: "text", text: "已经定位原因" }], 3000),
				message("a3", "assistant", [{ type: "text", text: "修复完成" }], 4000),
			],
			false,
		);
		const turn = groups.get("a1");
		expect(turn?.messageIds).toEqual(["a1", "a2", "a3"]);
		expect(turn?.headerId).toBe("a1");
		expect(turn?.finalTextId).toBe("a3");
		expect(turn?.summary.content[0]).toEqual({ type: "text", text: "修复完成" });
	});

	it("历史折叠只按用户回合计数，不受工具结果数量影响", () => {
		const messages: UiMessage[] = [];
		for (let turn = 0; turn < 20; turn++) {
			messages.push(message(`u${turn}`, "user", [{ type: "text", text: `问题 ${turn}` }]));
			messages.push(message(`a${turn}`, "assistant", [{ type: "text", text: `回答 ${turn}` }]));
			for (let result = 0; result < 5; result++) {
				messages.push(message(`r${turn}-${result}`, "toolResult", [{ type: "text", text: "结果" }]));
			}
		}
		expect(messages.length).toBe(140);
		expect(findRecentTurnStart(messages, 20, 10)).toBe(0);
		messages.push(message("u20", "user", [{ type: "text", text: "第 21 问" }]));
		expect(findRecentTurnStart(messages, 20, 10)).toBe(77);
		expect(messages[77].id).toBe("u11");
	});

	it("没有过程块的消息不创建工作记录", () => {
		const groups = collectTurnActivities(
			[
				message("u1", "user", [{ type: "text", text: "你好" }]),
				message("a1", "assistant", [{ type: "text", text: "你好" }]),
			],
			false,
		);
		expect(groups.get("a1")?.ownerId).toBeNull();
		expect(groups.get("a1")?.blocks).toEqual([]);
	});
});
