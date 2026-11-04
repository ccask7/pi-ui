import type { UiContentBlock, UiMessage } from "./types";

export interface TurnActivity {
	/** 同一轮所有助手消息中的思考与工具调用，保持原始顺序。 */
	blocks: UiContentBlock[];
	/** 唯一工作记录挂在该消息上，其他助手消息只隐藏自己的过程块。 */
	ownerId: string | null;
	startedAt: number;
	/** 只有最后一个用户回合可以处于运行中。 */
	streaming: boolean;
	/** 整个回合只在这条消息上显示一次 PI 消息头。 */
	headerId: string;
	/** 回合结束后最后一条非空正文是最终回答；运行中暂不定最终回答。 */
	finalTextId: string | null;
	/** 用于折叠/展开整个回合。 */
	messageIds: string[];
	/** 历史区域的一条聚合摘要，预览最终回答并统计全部过程块。 */
	summary: UiMessage;
}

interface MutableTurn {
	messages: UiMessage[];
	blocks: UiContentBlock[];
	ownerId: string | null;
	headerId: string | null;
	startedAt: number;
}

function isActivity(block: UiContentBlock): boolean {
	return block.type === "thinking" || block.type === "toolCall";
}

function hasText(message: UiMessage): boolean {
	return message.content.some(
		(block) => block.type === "text" && "text" in block && typeof block.text === "string" && !!block.text.trim(),
	);
}

function hasVisibleContent(message: UiMessage): boolean {
	return hasText(message) || !!message.errorMessage || message.content.some(isActivity);
}

/** 历史折叠只按用户回合计数，避免大量工具结果让短对话过早折叠。 */
export function findRecentTurnStart(
	messages: readonly UiMessage[],
	collapseMinTurns: number,
	keepRecentTurns: number,
): number {
	const userIndexes: number[] = [];
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role === "user") userIndexes.push(i);
	}
	if (userIndexes.length <= collapseMinTurns) return 0;
	return userIndexes[Math.max(0, userIndexes.length - keepRecentTurns)] ?? 0;
}

/** 将协议上的多条 assistant 消息归并成 UI 上的一个用户回合。
 * 工具结果和附件等穿插消息不会切断回合；只有下一条用户消息会开启新回合。 */
export function collectTurnActivities(
	messages: readonly UiMessage[],
	isStreaming: boolean,
): ReadonlyMap<string, TurnActivity> {
	const turns: MutableTurn[] = [];
	let current: MutableTurn | null = null;
	for (const message of messages) {
		if (message.role === "user") {
			current = null;
			continue;
		}
		if (message.role !== "assistant") continue;
		if (!current) {
			current = { messages: [], blocks: [], ownerId: null, headerId: null, startedAt: message.timestamp ?? Date.now() };
			turns.push(current);
		}
		current.messages.push(message);
		if (current.headerId === null && hasVisibleContent(message)) current.headerId = message.id;
		for (const block of message.content) {
			if (!isActivity(block)) continue;
			if (current.ownerId === null) {
				current.ownerId = message.id;
				current.startedAt = message.timestamp ?? Date.now();
			}
			current.blocks.push(block);
		}
	}
	const result = new Map<string, TurnActivity>();
	const lastTurn = turns.at(-1);
	for (const turn of turns) {
		const streaming = isStreaming && turn === lastTurn;
		const finalMessage = streaming ? undefined : [...turn.messages].reverse().find(hasText);
		const allContent = turn.messages.flatMap((message) => message.content);
		const finalContent = finalMessage?.content.filter((block) => block.type === "text") ?? [];
		const first = turn.messages[0];
		const last = turn.messages.at(-1) ?? first;
		const headerId = turn.headerId ?? first.id;
		const activity: TurnActivity = {
			blocks: turn.blocks,
			ownerId: turn.ownerId,
			startedAt: turn.startedAt,
			streaming,
			headerId,
			finalTextId: finalMessage?.id ?? null,
			messageIds: turn.messages.map((message) => message.id),
			summary: {
				...last,
				id: headerId,
				role: "assistant",
				// CollapsedMessage 取第一段正文做预览：把最终回答置前，过程统计仍使用完整内容。
				content: [...finalContent, ...allContent],
			},
		};
		for (const message of turn.messages) result.set(message.id, activity);
	}
	return result;
}
