import { useMemo, useState } from "react";
import { FiEdit2, FiMessageSquare, FiX } from "react-icons/fi";
import type { ConversationSummary, ElsewhereRunning } from "../types";
import { useT } from "../i18n";

/**
 * 顶部标签栏（VS Code 式）：显示「运行的对话」，替代原先左栏的
 * 「运行的对话」分区——多个并行对话/子代理之间靠顶部横排标签切换，
 * 不再占用左栏纵向空间。
 *
 * 标签来源：本客户端在跑的对话（含子代理，`↳` 前缀标识嵌套层级）
 * + 其他客户端在跑的对话（只读样式，点两次 = 过户到本页）。
 *
 * 交互对齐编辑器标签的习惯：
 * - 单击 → 切换（`switch_conversation`）
 * - 双击标题 → 就地重命名
 * - X → 关闭（`dismiss_conversation`）；运行中/带子代理时两段确认
 * - 中键 → 同 X
 * - 有问卷在等答复 → `?` 角标（别处的会话点它直接抢答）
 */
interface ChatTabBarProps {
	conversations: ConversationSummary[];
	elsewhere: ElsewhereRunning[];
	activeConversationId: string;
	panelSend: (msg: ChatPanelMessage) => boolean;
}

/** 这里只用到面板消息的这几种（与 LeftPanel 的联合类型保持一致的子集）。 */
type ChatPanelMessage =
	| { type: "new_chat" }
	| { type: "switch_conversation"; id: string }
	| { type: "dismiss_conversation"; id: string; withFinishedSubagents?: boolean; force?: boolean }
	| { type: "rename_conversation"; id: string; name: string }
	| { type: "take_over_conversation"; owner: string; id: string }
	| { type: "peek_elsewhere_question"; owner: string; id: string };

interface TabRow {
	key: string;
	conv?: ConversationSummary;
	elsewhere?: ElsewhereRunning;
	depth: number;
}

/** 按 parentId 铺平（父在前、子随后，深度用于标题缩进提示）。 */
function flattenTabs(conversations: ConversationSummary[], elsewhere: ElsewhereRunning[]): TabRow[] {
	const byId = new Map(conversations.map((c) => [c.id, c]));
	const kids = new Map<string, ConversationSummary[]>();
	const roots: ConversationSummary[] = [];
	for (const c of conversations) {
		if (c.parentId && byId.has(c.parentId)) {
			const arr = kids.get(c.parentId) ?? [];
			arr.push(c);
			kids.set(c.parentId, arr);
		} else roots.push(c);
	}
	const rows: TabRow[] = [];
	const seen = new Set<string>();
	const append = (c: ConversationSummary, depth: number) => {
		if (seen.has(c.id)) return;
		seen.add(c.id);
		rows.push({ key: c.id, conv: c, depth });
		for (const child of kids.get(c.id) ?? []) append(child, depth + 1);
	};
	for (const root of roots) append(root, 0);
	for (const c of conversations) append(c, 0);
	elsewhere.forEach((w, i) => rows.push({ key: `elsewhere:${w.cwd}:${w.title}:${i}`, elsewhere: w, depth: 0 }));
	return rows;
}

/** 某个对话名下的子代理数量（含运行中/已结束，全部后代）。 */
function subagentCount(conversations: ConversationSummary[], id: string): number {
	const kids = new Map<string, ConversationSummary[]>();
	for (const c of conversations) {
		if (!c.parentId) continue;
		const arr = kids.get(c.parentId) ?? [];
		arr.push(c);
		kids.set(c.parentId, arr);
	}
	let n = 0;
	const walk = (parent: string) => {
		for (const child of kids.get(parent) ?? []) {
			n++;
			walk(child.id);
		}
	};
	walk(id);
	return n;
}

export function ChatTabBar({ conversations, elsewhere, activeConversationId, panelSend }: ChatTabBarProps) {
	const t = useT();
	const rows = useMemo(() => flattenTabs(conversations, elsewhere), [conversations, elsewhere]);
	/** 已「点过一次」的标签（关闭/过户的两段确认）。 */
	const [armed, setArmed] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");

	if (rows.length === 0) return null;

	const closeTab = (c: ConversationSummary, key: string) => {
		const risky = c.isStreaming || subagentCount(conversations, c.id) > 0;
		if (risky && armed !== key) {
			setArmed(key);
			return;
		}
		setArmed(null);
		panelSend({ type: "dismiss_conversation", id: c.id, ...(risky ? { force: true } : {}) });
	};

	const commitRename = (c: ConversationSummary) => {
		const name = renameDraft.trim();
		if (name && name !== c.title) panelSend({ type: "rename_conversation", id: c.id, name });
		setRenaming(null);
	};

	return (
		<div className="chat-tabs" role="tablist" aria-label={t("runningConversations")}>
			{rows.map((row) => {
				// ---- 别处的会话：只读标签，两次点击 = 过户 ----
				if (row.elsewhere) {
					const w = row.elsewhere;
					const canTakeover = Boolean(w.owner && w.convId);
					const confirming = armed === row.key;
					return (
						<div
							key={row.key}
							className={`chat-tab elsewhere${confirming ? " armed" : ""}`}
							title={`${t("elsewhereTip")}\n${w.cwd}`}
							onMouseLeave={() => setArmed((k) => (k === row.key ? null : k))}
						>
							<button
								type="button"
								className="chat-tab-main"
								disabled={!canTakeover}
								onClick={() => {
									if (!canTakeover || !w.owner || !w.convId) return;
									if (!confirming) {
										setArmed(row.key);
										return;
									}
									setArmed(null);
									panelSend({ type: "take_over_conversation", owner: w.owner, id: w.convId });
								}}
							>
								<span className="chat-tab-flag">{t("elsewhereBadge")}</span>
								<span className="chat-tab-title">{confirming ? t("takeoverConfirm") : w.title}</span>
								{w.hasQuestion && w.owner && w.convId && (
									<span
										className="chat-tab-badge question clickable"
										title={t("takeoverHasQuestion")}
										onClick={(e) => {
											e.stopPropagation();
											panelSend({ type: "peek_elsewhere_question", owner: w.owner!, id: w.convId! });
										}}
									>
										?
									</span>
								)}
								{w.isStreaming && <span className="chat-tab-dot streaming" title={t("streaming")} />}
							</button>
						</div>
					);
				}

				// ---- 本客户端的会话 ----
				const c = row.conv as ConversationSummary;
				const active = c.id === activeConversationId;
				const confirming = armed === row.key;
				return (
					<div
						key={row.key}
						className={`chat-tab${active ? " active" : ""}${confirming ? " armed" : ""}`}
						title={`${c.title}${c.cwd ? ` — ${c.cwd}` : ""}`}
						onMouseLeave={() => setArmed((k) => (k === row.key ? null : k))}
						onAuxClick={(e) => {
							// 中键 = 关闭（与编辑器标签一致）
							if (e.button === 1) {
								e.preventDefault();
								closeTab(c, row.key);
							}
						}}
					>
						<button
							type="button"
							className="chat-tab-main"
							role="tab"
							aria-selected={active}
							onClick={() => {
								setArmed(null);
								if (!active) panelSend({ type: "switch_conversation", id: c.id });
							}}
							onDoubleClick={() => {
								setRenameDraft(c.title);
								setRenaming(row.key);
							}}
						>
							{row.depth > 0 && <span className="chat-tab-indent">↳</span>}
							{c.isSubagent && <span className="chat-tab-flag">{t("subagentBadge")}</span>}
							{renaming === row.key ? (
								<input
									autoFocus
									className="chat-tab-rename"
									value={renameDraft}
									placeholder={t("renameSessionPlaceholder")}
									onClick={(e) => e.stopPropagation()}
									onDoubleClick={(e) => e.stopPropagation()}
									onChange={(e) => setRenameDraft(e.target.value)}
									onKeyDown={(e) => {
										e.stopPropagation();
										if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename(c);
										else if (e.key === "Escape") setRenaming(null);
									}}
									onBlur={() => setRenaming(null)}
								/>
							) : (
								<>
									{c.isEphemeral && <span className="chat-tab-flag">{t("ephemeralBadge")}</span>}
									<span className="chat-tab-title">{confirming ? t("dismissConversationConfirm") : c.title}</span>
									{c.error && <span className="chat-tab-dot error" title={t("convErrorBadge", { error: c.error })} />}
									{c.hasQuestion && (
										<span className="chat-tab-badge question" title={t("waitingQuestionBadge")}>
											?
										</span>
									)}
									{c.isStreaming && <span className="chat-tab-dot streaming" title={t("streaming")} />}
								</>
							)}
						</button>
						{renaming !== row.key && (
							<>
								<button
									type="button"
									className="chat-tab-act"
									title={t("renameSession")}
									onClick={(e) => {
										e.stopPropagation();
										setRenameDraft(c.title);
										setRenaming(row.key);
									}}
								>
									<FiEdit2 />
								</button>
								<button
									type="button"
									className="chat-tab-act close"
									title={t("dismissConversation")}
									onClick={(e) => {
										e.stopPropagation();
										closeTab(c, row.key);
									}}
								>
									<FiX />
								</button>
							</>
						)}
					</div>
				);
			})}
			<button
				type="button"
				className="chat-tab-new"
				title={t("newChat")}
				onClick={() => panelSend({ type: "new_chat" })}
			>
				<FiMessageSquare />
			</button>
		</div>
	);
}
