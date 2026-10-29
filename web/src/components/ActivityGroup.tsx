import { memo, useEffect, useRef, useState } from "react";
import { FiCheck, FiChevronDown, FiChevronRight, FiLoader, FiX } from "react-icons/fi";
import type { ToolStatus, UiContentBlock, UiMessage, UiThinkingBlock, UiToolCallBlock } from "../types";
import { useT } from "../i18n";
import type { UiSlotEntry } from "../ui-slots";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock, type ToolView } from "./ToolCallBlock";

function asThinking(block: UiContentBlock): UiThinkingBlock | null {
	return block.type === "thinking" && typeof (block as UiThinkingBlock).thinking === "string"
		? (block as UiThinkingBlock)
		: null;
}

function asToolCall(block: UiContentBlock): UiToolCallBlock | null {
	return block.type === "toolCall" &&
		typeof (block as UiToolCallBlock).id === "string" &&
		typeof (block as UiToolCallBlock).name === "string"
		? (block as UiToolCallBlock)
		: null;
}

/** Codex 风格的短耗时：汇总行只承担定位，不展示拥挤的长文本。 */
export function formatActivityDuration(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

interface ActivityGroupProps {
	blocks: UiContentBlock[];
	startedAt: number;
	toolResults: ReadonlyMap<string, UiMessage>;
	liveOutputs: ReadonlyMap<string, { toolName: string; text: string }>;
	toolStatuses: ReadonlyMap<string, ToolStatus>;
	streaming: boolean;
	onKillBash?: () => void;
	toolsWrap?: boolean;
	toolImages?: boolean;
	thinkingWrap?: boolean;
	forceOpen?: boolean;
	uiContextToolCall?: UiSlotEntry[];
	onUiAction?: (item: UiSlotEntry, value?: string) => void;
}

/** 一次助手回复里的思考与工具调用共用一个大收纳。内部仍使用原组件，
 * 因而工具结果、停止命令、子代理入口和插件右键菜单都保持原行为。 */
export const ActivityGroup = memo(function ActivityGroup({
	blocks,
	startedAt,
	toolResults,
	liveOutputs,
	toolStatuses,
	streaming,
	onKillBash,
	toolsWrap,
	toolImages,
	thinkingWrap,
	forceOpen = false,
	uiContextToolCall,
	onUiAction,
}: ActivityGroupProps) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [, setTick] = useState(0);
	const liveDurationRef = useRef(0);
	useEffect(() => {
		if (!streaming) return;
		const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
		return () => window.clearInterval(timer);
	}, [streaming]);
	const shown = open || forceOpen;
	const liveSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
	if (streaming) liveDurationRef.current = liveSeconds;
	// 历史消息没有独立的 turn 结束时间：最后一条工具结果是最可靠的结束点；
	// 纯思考的历史没有该时间，回退为 0，而不能拿“现在”算出几天前的假耗时。
	const lastToolResultAt = blocks.reduce((latest, block) => {
		const tool = asToolCall(block);
		return Math.max(latest, tool ? (toolResults.get(tool.id)?.timestamp ?? 0) : 0);
	}, 0);
	const completedSeconds =
		lastToolResultAt > startedAt ? (lastToolResultAt - startedAt) / 1000 : liveDurationRef.current;
	const elapsed = formatActivityDuration(streaming ? liveSeconds : completedSeconds);
	const latest = blocks.at(-1);
	const latestTool = latest ? asToolCall(latest) : null;
	const currentAction = latestTool ? latestTool.name : t("thinkingNow");
	const failed = blocks.some((block) => {
		const tool = asToolCall(block);
		if (!tool) return false;
		return toolResults.get(tool.id)?.isError || toolStatuses.get(tool.id)?.isError;
	});

	return (
		<div className={`activity-group${shown ? " open" : ""}${streaming ? " live" : ""}${failed ? " failed" : ""}`}>
			<button
				type="button"
				className="activity-head"
				aria-expanded={shown}
				title={shown ? t("collapseMsg") : t("expandMsg")}
				onClick={() => setOpen((value) => !value)}
			>
				<span className="activity-chevron">{shown ? <FiChevronDown /> : <FiChevronRight />}</span>
				<span className={`activity-state${streaming ? " running" : failed ? " error" : ""}`}>
					{streaming ? <FiLoader /> : failed ? <FiX /> : <FiCheck />}
				</span>
				<span className="activity-title">
					{streaming ? t("activityWorking", { action: currentAction }) : t("activityWorked", { duration: elapsed })}
				</span>
			</button>
			{shown && (
				<div className="activity-timeline">
					{blocks.map((block, index) => {
						const thinking = asThinking(block);
						if (thinking) {
							return (
								<ThinkingBlock
									key={`thinking-${index}`}
									thinking={thinking.thinking}
									streaming={streaming && index === blocks.length - 1}
									wrap={thinkingWrap}
									forceOpen={forceOpen}
								/>
							);
						}
						const tool = asToolCall(block);
						if (!tool) return null;
						const result = toolResults.get(tool.id);
						const live = liveOutputs.get(tool.id);
						const view: ToolView = {
							result,
							liveOutput: live?.text,
							streaming,
							status: toolStatuses.get(tool.id),
						};
						return (
							<ToolCallBlock
								key={tool.id}
								block={tool}
								view={view}
								onKillBash={onKillBash}
								wrap={toolsWrap}
								showImages={toolImages ?? true}
								forceOpen={forceOpen}
								uiContextToolCall={uiContextToolCall}
								onUiAction={onUiAction}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
});
