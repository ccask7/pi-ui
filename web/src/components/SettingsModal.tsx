import { Fragment, useEffect, useRef, useState } from "react";
import {
	FiArchive,
	FiBox,
	FiChevronDown,
	FiChevronUp,
	FiClock,
	FiCpu,
	FiEdit3,
	FiEye,
	FiFileText,
	FiFolder,
	FiGitBranch,
	FiHelpCircle,
	FiImage,
	FiKey,
	FiMessageSquare,
	FiPackage,
	FiPlus,
	FiRefreshCw,
	FiSend,
	FiSettings,
	FiShield,
	FiSliders,
	FiTool,
	FiTrash2,
	FiUpload,
	FiMonitor,
	FiUsers,
	FiVolume2,
	FiX,
	FiZap,
	FiSun,
	FiGlobe,
} from "react-icons/fi";
import { CopyButton } from "./copy-button";
import { PluginIcon } from "../plugin-icon";
import { HintTip } from "./HintTip";
import { sortAgentPresets } from "./PresetBar";
import { PERMISSION_ORDER, permDescKey, permLabelKey } from "./PermissionBar";
import { PluginPage } from "./PluginPage";
import { PluginSettingsForm } from "./PluginSettingsForm";
import type {
	CommandDef,
	PermissionOption,
	SchedulerTaskView,
	UiAgentPreset,
	UiApprovalRule,
	UiExtensionInfo,
	UiPluginInfo,
	UiSettingsState,
	UiSkillInfo,
	UiSubagentTemplate,
} from "../types";
import { SchedulerPanel } from "./SchedulerPanel";
import { SoundSettingsPanel } from "./SoundSettings";
import { NotifyToggle } from "./NotifyToggle";
import { ToggleRow } from "./SettingsControls";
import { SkillsPanel } from "./SkillsPanel";
import { LanguageSettings } from "./LanguageSettings";
import { UpdateSettings } from "./UpdateSettings";
import { BrowserControlSettings } from "./BrowserControl";
import type { SoundSettings } from "../sounds";
import type { ThemeInfo } from "../theme";
import {
	clearPromptHistory,
	loadPromptHistory,
	loadPromptHistorySettings,
	savePromptHistorySettings,
} from "../prompt-history";
import { randomUuid } from "../uuid";
import { THINKING_VALUES } from "../thinking-levels";
import { formatTokenDraft, parseTokenInput } from "../token-input";
import { useWideChat, saveChatWidthSettings } from "../chat-width-settings";
import { usePresentAutoOpen, savePresentAutoOpen } from "../present-settings";
import { useProjectTitle, saveTitleSettings } from "../title-settings";
import { sanitizeWallpaperUrl, fileToWallpaperUrl, saveWallpaperSettings, useWallpaperSettings } from "../wallpaper";
import { saveWindowOpacity, saveWindowTransparent, useWindowOpacity, useWindowTransparent } from "../window-opacity";
import { useT, useI18n } from "../i18n";
import { buildUiSlots, withPluginViewItems, type UiSlotEntry } from "../ui-slots";
import { appSend, useAppGlobals } from "../app-globals";
import { countPluginPhases, pluginPhase, type PluginPhase } from "../plugin-phase";
import { QUICK_PHRASE_DEFAULTS } from "../quick-phrases";
import { DEFAULT_PROMPT_TEMPLATE, PROMPT_TOKENS, isReadonlyPromptSource } from "../../../server/prompt-composer.js";
import {
	AGENT_TOOL_CATALOG,
	filterToolsByPreset,
	presetShowsSkillCatalog,
	MARKERS_LIST_TOOL_NAME,
	SUBAGENT_TOOL_NAMES,
	TERMINAL_TOOL_NAMES,
} from "../../../server/tool-manager.js";

/**
 * 设置页「其他」组开关行的渲染口径：目录即页面。目录里加一行，页面自动多一行
 * （文案走目录项的 descKey/offHintKey）；不再手写 ToggleRow。唯一例外是 todo_list，
 * 它的行固定在上面的 markers 分区（单测 settings-tool-rows 把这个例外锁死）。
 */
const OTHER_AGENT_TOOLS = AGENT_TOOL_CATALOG.filter((e) => e.group === "other" && e.name !== MARKERS_LIST_TOOL_NAME);

/** 主题下拉的选项文案：名称（zh 用 name，其它语言优先 nameEn）+ 浅/深标注。
 *  与原顶栏「主题」下拉同一口径；themeLight/themeDark 已进 zh/en + 8 个语言包。 */
function themeOptionLabel(th: ThemeInfo, locale: string, t: (key: "themeLight" | "themeDark") => string): string {
	const base = locale === "zh" ? th.name : (th.nameEn ?? th.name);
	const scheme = th.scheme === "light" ? t("themeLight") : th.scheme === "dark" ? t("themeDark") : "";
	if (!scheme) return base;
	return locale === "zh" ? `${base}（${scheme}）` : `${base} (${scheme})`;
}

/** Minimal terminal-tab bridge (same shape SCMPanel uses). */
interface SettingsTerminalBridge {
	create: (meta: {
		id: string;
		conversationId: string;
		title: string;
		cwd: string;
		cols: number;
		rows: number;
		running: boolean;
		exitCode: number | null;
		command?: CommandDef;
	}) => void;
	restart: (id: string) => void;
	select: (id: string) => void;
}

interface SettingsModalProps {
	/** Optional direct entry used by the top-bar plugin menu. */
	initialSection?: "tools";
	chat: {
		settings: UiSettingsState | null;
		plugins: UiPluginInfo[];
		/** 插件重载纪元：作为插件 client bundle URL 的 ?e= 缓存击穿参数传给插件页（#146）。 */
		pluginsEpoch: number;
		/** 插件目录授权表（设置面板列出 + 可撤销）。 */
		pluginGrants: { pluginId: string; paths: string[] }[];
		/** 插件能力授权表（动态授权；设置面板列出 + 可撤销）。 */
		pluginPermissions: {
			pluginId: string;
			family: "net" | "llm";
			hosts?: string[];
			models?: string[];
			reason?: string;
			grantedAt: number;
			session?: boolean;
		}[];
		/** DSH engine: Agent 预设名录（null/空 = legacy，隐藏预设区）。 */
		agentPresets: { presets: UiAgentPreset[]; defaultPreset: string } | null;
		/** DSH engine: 权限预设选项表 + 新会话默认（null = 未就绪/legacy，隐藏权限区）。 */
		permissionPresets: { options: PermissionOption[]; defaultPreset: string } | null;
		/** Engine id ("pi" | "dsh") 与 PI_WEB_MANAGED 已移到全局（web/src/app-globals.ts）。 */
		terminals: {
			id: string;
			title: string;
			conversationId: string;
			running: boolean;
			exitCode: number | null;
			command?: CommandDef;
		}[];
		state?: { cwd: string; conversationId: string } | null;
		activeConversationId?: string | null;
		/** 内置定时任务（issue #184，全局列表；DSH 引擎下为空） */
		schedulerTasks: SchedulerTaskView[];
	};
	terminal: SettingsTerminalBridge;
	/** 声音提示（通用页：总开关/音量）——状态与播放都在 App 里。 */
	sound: SoundSettings;
	onSoundChange: (settings: SoundSettings) => void;
	/** 主题（界面设置页）：列表 + 当前选择 + 切换。 */
	themes: ThemeInfo[];
	theme: string | null;
	onThemeChange: (id: string | null) => void;
	reloadThemes: () => void;
	/** 打开插件视图（设置 → 插件页里的「打开」，顶栏插件菜单已删）。 */
	onOpenPluginView: (id: string) => void;
	/** Switch the top-level view to the terminal (uninstall runs there). */
	onSwitchToTerminal: () => void;
	onClose: () => void;
}

/** 各来源排序权重：append 置顶（最常用），可编辑居中，只读沉底（纯预览）。 */
function rankPromptToken(tk: string): number {
	if (tk === "append") return 0;
	return isReadonlyPromptSource(tk) ? 2 : 1;
}

/** 相位 → 文案 key（tt 绕行字面量约束，见文件顶部 tt 定义）。 */
function phaseLabelKey(ph: PluginPhase): string {
	if (ph === "active") return "pluginPhaseActive";
	if (ph === "disabled") return "pluginPhaseDisabled";
	if (ph === "failed") return "pluginPhaseFailed";
	return "pluginPhaseIdle";
}
/** 插件运行相位圆点（设置面板清单区 + 列表行标题用；颜色见 styles.css `.inv-dot`）。 */
function InvDot({ phase, label }: { phase: PluginPhase; label: string }) {
	return <span className={`inv-dot inv-dot-${phase}`} title={label} aria-label={label} />;
}

/** 插件清单汇总条（只读）：四相计数 + 各相圆点，明细在下方列表行里看。 */
function PluginInventoryStrip({ plugins, disabledIds }: { plugins: UiPluginInfo[]; disabledIds: ReadonlySet<string> }) {
	const t = useT();
	const counts = countPluginPhases(plugins, disabledIds);
	const labels: Record<PluginPhase, string> = {
		active: t("pluginPhaseActive"),
		disabled: t("pluginPhaseDisabled"),
		failed: t("pluginPhaseFailed"),
		idle: t("pluginPhaseIdle"),
	};
	const order: PluginPhase[] = ["active", "disabled", "failed", "idle"];
	return (
		<div className="set-note inv-strip">
			{order.map((ph) => (
				<span key={ph} className="inv-item" title={labels[ph]}>
					<InvDot phase={ph} label={labels[ph]} />
					{counts[ph]}
				</span>
			))}
		</div>
	);
}

/** 一行式表单行：标签左、控件（数字框/下拉）右，与开关共用右对齐线。 */
function FieldRow({
	label,
	tip,
	htmlFor,
	children,
}: {
	label: string;
	tip?: string;
	htmlFor?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="set-row set-field-row">
			<label className="set-row-name" htmlFor={htmlFor}>
				{label}
				{tip && <HintTip text={tip} />}
			</label>
			{children}
		</div>
	);
}

/** 设置弹窗的左侧分组导航（一次只显示一个区块，消灭长滚动）。
 *  插件自定义页（`settings.pages`）复用同一套导航：id 形如 `plugin-page:<条目全局 id>`
 *  —— 条目全局 id 本身是 `<pluginId>:<itemId>`，所以整串是 `plugin-page:<pluginId>:<itemId>`；
 *  一个插件可以贡献多页，故不用 `plugin-page:<pluginId>`（会撞车）。 */
type SettingsTab =
	| "general"
	| "prompt"
	| "prompt-history"
	| "scheduler"
	| "tools"
	| "approval-rules"
	| "question"
	| "display"
	| "appearance"
	| "quick"
	| "markers"
	| "skills"
	| "extensions"
	| "plugins"
	| "review"
	| "vision"
	| "presets"
	| "subagent-templates"
	| `plugin-page:${string}`;

export function SettingsModal({
	chat,
	terminal,
	initialSection,
	sound,
	onSoundChange,
	themes,
	theme,
	onThemeChange,
	reloadThemes,
	onOpenPluginView,
	onSwitchToTerminal,
	onClose,
}: SettingsModalProps) {
	const t = useT();
	const { locale } = useI18n();
	// 设置 → 通用：手动更新区域显示桌面壳版本；网页版保留服务端版本。
	const { appVersion } = useAppGlobals();
	// {{token}} 元数据文案键是动态的（promptTok_<token>[,_desc]），用 tt 跳过字面量类型。
	const tt = (k: string) => t(k as Parameters<typeof t>[0]);
	const settings = chat.settings;
	// 审批放行策略（仅内存、随对话走；审批弹窗的「允许同类 / 全部允许」在这里撤销）。
	const approvalPolicy = settings?.approvalPolicy;
	// 当前左侧导航选中的分组。
	const [tab, setTab] = useState<SettingsTab>(initialSection ?? "prompt");
	// 内容滚动容器：切换分组后回到顶部（各组高度不同，停留旧滚动位置会像没切换）。
	const bodyRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		bodyRef.current?.scrollTo({ top: 0 });
	}, [tab]);
	// 窄屏横滑导航：切换分组后把当前 chip 滚进可见区。
	const railRef = useRef<HTMLElement>(null);
	useEffect(() => {
		railRef.current?.querySelector(".settings-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [tab]);

	// Compose prompt — 组合模板（{{token}} 自由拼装）+ 各来源覆盖。本地草稿：
	// 模板聚焦中不覆盖；某个来源的覆盖框聚焦中不覆盖该 key（防回显打断输入）。
	const [promptTemplateDraft, setPromptTemplateDraft] = useState("");
	const [promptOverridesDraft, setPromptOverridesDraft] = useState<Record<string, string>>({});
	const templateFocus = useRef(false);
	const overrideFocus = useRef<string | null>(null);
	// 各来源展示顺序：append 置顶，其次可编辑来源，只读来源沉底（组内保持 PROMPT_TOKENS 原序）。
	const orderedPromptTokens = [...PROMPT_TOKENS].sort((a, b) => rankPromptToken(a) - rankPromptToken(b));
	// 未覆盖来源行内默认内容预览：点击预览进入覆盖输入（editingSource）；长文本展开/收起。
	const [editingSource, setEditingSource] = useState<string | null>(null);
	const [defaultOpen, setDefaultOpen] = useState<Record<string, boolean>>({});
	// Vision-bridge prompt draft — same local-edit/re-sync pattern as above.
	const [vbPromptDraft, setVbPromptDraft] = useState("");
	const [vbPromptMode, setVbPromptMode] = useState<"append" | "replace">("append");
	const vbPromptFocus = useRef(false);
	// 「AI 提交信息」提示词草稿（模式 + 文本；replace 且未改动内置默认 → 存空）。
	const [scmMsgDraft, setScmMsgDraft] = useState("");
	const [scmMsgMode, setScmMsgMode] = useState<"append" | "replace">("append");
	const scmMsgFocus = useRef(false);
	// Goal-review prompt is an independent draft: it does not change the main
	// agent system prompt and is only used by the isolated reviewer.
	const [reviewPromptDraft, setReviewPromptDraft] = useState("");
	const reviewPromptFocus = useRef(false);
	const [presetName, setPresetName] = useState("");
	// 正在编辑的子代理模板草稿（新建 = 空模板；null = 关闭编辑表单，表单在独立弹窗里渲染）。
	const [tplDraft, setTplDraft] = useState<UiSubagentTemplate | null>(null);
	// 弹窗标题用：新建 vs 编辑（draft 本身区分不出来）。
	const [tplIsNew, setTplIsNew] = useState(false);
	// 删除子代理模板的两步确认。
	const [confirmTplDelete, setConfirmTplDelete] = useState<string | null>(null);
	// 正在编辑的审批规则草稿。
	const [ruleDraft, setRuleDraft] = useState<UiApprovalRule | null>(null);
	const [ruleIsNew, setRuleIsNew] = useState(false);
	const [ruleToolsText, setRuleToolsText] = useState("");
	const [ruleError, setRuleError] = useState<string | null>(null);
	const [confirmRuleDelete, setConfirmRuleDelete] = useState<string | null>(null);
	const [confirmRuleReset, setConfirmRuleReset] = useState<string | null>(null);
	// Read-only viewer for the FULL system prompt actually in effect.
	const [showFullPrompt, setShowFullPrompt] = useState(false);
	// 宽屏聊天列开关（纯前端 localStorage，见 chat-width-settings.ts）。
	const wideChat = useWideChat();
	// present_files 卡片：AI 标了「先看这个」时要不要自动弹预览窗（纯前端偏好，localStorage）。
	const presentAutoOpen = usePresentAutoOpen();
	const projectTitle = useProjectTitle();
	// 聊天背景图（纯前端 localStorage，见 wallpaper.ts）：本地上传；压暗/模糊滑杆即时预览。
	const wallpaper = useWallpaperSettings();
	// 整体不透明度（纯前端 localStorage，见 window-opacity.ts）：窗口级透明，
	// 对齐 Windows Terminal 的 opacity；「窗口透明」是它的兜底开关。
	const windowOpacity = useWindowOpacity();
	const windowTransparent = useWindowTransparent();
	const wallpaperFileRef = useRef<HTMLInputElement>(null);
	const [wallpaperUploading, setWallpaperUploading] = useState(false);
	const [wallpaperUploadError, setWallpaperUploadError] = useState(false);
	const onPickWallpaperFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		setWallpaperUploading(true);
		setWallpaperUploadError(false);
		try {
			const url = await fileToWallpaperUrl(file);
			const clean = url ? sanitizeWallpaperUrl(url) : "";
			if (!clean) {
				setWallpaperUploadError(true);
				return;
			}
			saveWallpaperSettings({ ...wallpaper, url: clean });
		} finally {
			setWallpaperUploading(false);
		}
	};
	// Prompt history settings (纯前端 localStorage，不经过 server).
	const [phSettings, setPhSettings] = useState(() => loadPromptHistorySettings());
	const [phCount, setPhCount] = useState(() => {
		try {
			return loadPromptHistory().length;
		} catch {
			return 0;
		}
	});
	const [phClearConfirm, setPhClearConfirm] = useState(false);
	const refreshPhCount = () => {
		try {
			setPhCount(loadPromptHistory().length);
		} catch {
			setPhCount(0);
		}
	};
	useEffect(() => {
		if (tab === "prompt-history") refreshPhCount();
	}, [tab]);
	useEffect(() => {
		if (!phClearConfirm) return;
		const id = window.setTimeout(() => setPhClearConfirm(false), 3000);
		return () => window.clearTimeout(id);
	}, [phClearConfirm]);
	// Two-step uninstall confirm: which extension id is awaiting confirmation.
	const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
	/** 界面插件配置展开态（插件 id → 展开；默认折叠）。 */
	const [settingsOpen, setSettingsOpen] = useState<Record<string, boolean>>({});
	// 快捷短语新增输入框草稿（Enter / 添加按钮提交）。
	const [quickNew, setQuickNew] = useState("");
	// 快捷短语行内编辑（null = 未在编辑；输入框受控于 value，回显不打断输入）。
	const [quickEdit, setQuickEdit] = useState<{ index: number; value: string } | null>(null);

	useEffect(() => {
		if (!settings) return;
		if (!templateFocus.current) setPromptTemplateDraft(settings.promptTemplate ?? "");
		setPromptOverridesDraft((prev) => {
			const next: Record<string, string> = {};
			for (const [k, v] of Object.entries(settings.promptOverrides ?? {})) next[k] = v ?? "";
			if (overrideFocus.current) next[overrideFocus.current] = prev[overrideFocus.current] ?? "";
			return next;
		});
		setVbPromptMode(settings.visionBridgePromptMode);
		if (vbPromptFocus.current) return;
		setVbPromptDraft(
			vbPromptMode === "append" || settings.visionBridgePrompt
				? settings.visionBridgePrompt
				: settings.visionBridgeDefaultPrompt || "",
		);
		// 「AI 提交信息」提示词：replace 且存的是空（= 内置默认）时预填默认文本。
		setScmMsgMode(settings.scmCommitMsgPromptMode);
		if (!scmMsgFocus.current) {
			setScmMsgDraft(
				settings.scmCommitMsgPromptMode === "append" || settings.scmCommitMsgPrompt
					? settings.scmCommitMsgPrompt
					: settings.scmCommitMsgDefaultPrompt || "",
			);
		}
		if (!reviewPromptFocus.current) setReviewPromptDraft(settings.reviewPrompt);
	}, [settings, vbPromptMode, scmMsgMode]);

	const [idleMsDraft, setIdleMsDraft] = useState<string>(String(settings?.terminalBashIdleMs ?? 15000));
	useEffect(() => {
		setIdleMsDraft(String(settings?.terminalBashIdleMs ?? 15000));
	}, [settings?.terminalBashIdleMs]);
	const [maxMsDraft, setMaxMsDraft] = useState<string>(String(settings?.terminalBashMaxForegroundMs ?? 60000));
	useEffect(() => {
		setMaxMsDraft(String(settings?.terminalBashMaxForegroundMs ?? 60000));
	}, [settings?.terminalBashMaxForegroundMs]);
	// 工具看门狗超时（分钟，默认 20 分钟；0 = 禁用）。
	const [watchdogMinDraft, setWatchdogMinDraft] = useState<string>(
		String(Math.round((settings?.toolWatchdogTimeoutMs ?? 1200000) / 60_000)),
	);
	useEffect(() => {
		setWatchdogMinDraft(String(Math.round((settings?.toolWatchdogTimeoutMs ?? 1200000) / 60_000)));
	}, [settings?.toolWatchdogTimeoutMs]);
	// 模型报错自动重试次数：本地草稿（失焦/回车提交，0 = 失败即停）。
	const [retryDraft, setRetryDraft] = useState<string>(String(settings?.retryMaxAttempts ?? 6));
	useEffect(() => {
		setRetryDraft(String(settings?.retryMaxAttempts ?? 6));
	}, [settings?.retryMaxAttempts]);
	// 压缩软上限：本地草稿（空 = 关闭；失焦/回车提交）。
	const [softCapDraft, setSoftCapDraft] = useState<string>(
		settings?.softCapTokens && settings.softCapTokens > 0 ? formatTokenDraft(settings.softCapTokens) : "",
	);
	useEffect(() => {
		setSoftCapDraft(
			settings?.softCapTokens && settings.softCapTokens > 0 ? formatTokenDraft(settings.softCapTokens) : "",
		);
	}, [settings?.softCapTokens]);

	/** 宿主 UI 布局（issue #146 完整版）：所有挂载点的最终条目 = 内置 + 插件贡献 +
	 *  插件 arrange + 既有用户偏好。
	 *  刻意放在 tabs 之前（也就跑在上面的 `if (!settings) return null` 之前）：插件自定义页
	 *  （settings.pages）也是导航的一项，得先算出来；而引用它的回落 effect 是 hook，
	 *  不能写在条件 return 之后。 */
	const uiSlots = buildUiSlots(withPluginViewItems(chat.plugins), {
		locale,
		t: (key: string) => t(key as Parameters<typeof t>[0]),
		disabledPlugins: chat.settings?.disabledPlugins ?? [],
		layout: chat.settings?.uiLayout,
	});

	/** `settings.pages` 里可渲染的插件页（导航一项 = 一页）。跳过：宿主条目（该槽位按契约是
	 *  插件专属）、被插件或用户隐藏的、纯分隔线，以及**查不到插件的**（清单还没推来 /
	 *  插件刚被卸载 / 被禁用）—— 宁可少一页，也不要点开才发现白屏（口径同右栏插件 tab）。
	 *  顺序严格按 uiSlots 给的结果（那边已按「插件 → arrange → 用户偏好」排好）。 */
	const pluginPages: { entry: UiSlotEntry; plugin: UiPluginInfo }[] = [];
	for (const entry of uiSlots["settings.pages"]) {
		if (entry.source === "host" || entry.hidden || entry.kind === "divider") continue;
		const plugin = chat.plugins.find((p) => p.id === entry.source.slice("plugin:".length));
		if (!plugin) continue;
		pluginPages.push({ entry, plugin });
	}
	/** 可打开的插件整页视图（原顶栏「插件」菜单的入口）。带 error 的置灰，与顶栏灰 tab 同口径。 */
	const pluginViewList = chat.plugins.filter((p) => p.view !== false);

	/** 导航 id ↔ 插件页的换算只写这一处（tab 状态、回落 effect、渲染块共用）。 */
	const pluginPageTabId = (entryId: string): SettingsTab => `plugin-page:${entryId}`;

	/** 正在看的插件页消失了（插件被卸载/禁用，或既有布局偏好隐藏了它）→ 回落到默认分区。
	 *  留着指向不存在的 tab，正文会空白一片，而导航里那项也没了——用户不知道该点哪。
	 *  用 effect 而不是渲染期纠正：纠正要改 state，渲染期不能改。 */
	useEffect(() => {
		if (!tab.startsWith("plugin-page:")) return;
		if (pluginPages.some((p) => pluginPageTabId(p.entry.id) === tab)) return;
		setTab("prompt");
	}, [tab, pluginPages]);

	if (!settings) return null;

	// 统一工具禁用名单（工具 tab 唯一写入口；旧 tab 的遗留单开关已迁入）。
	const disabledTools = new Set(settings.disabledAgentTools ?? []);
	const disabledToolsCount = disabledTools.size;

	// pi 引擎默认预设的二次过滤（server/tool-manager.ts filterToolsByPreset）：预设是
	// 禁用名单之外的第二层门控。默认预设为极简/代码/只读/纯对话时，大批开关看似开着
	// 实则对新对话不生效——此处算出实效，被过滤的行置灰并在顶部挂横幅（一键切回全功能）。
	const piPresetId = chat.agentPresets?.defaultPreset ?? null;
	const piPresetFiltering = !!piPresetId && piPresetId !== "standard";
	const piPresetAllowed: Set<string> = piPresetFiltering
		? new Set(
				filterToolsByPreset(
					[...AGENT_TOOL_CATALOG.map((e) => e.name), "bash", "read", "edit", "write"],
					piPresetId ?? undefined,
				),
			)
		: new Set(AGENT_TOOL_CATALOG.map((e) => e.name));
	const piPresetName = chat.agentPresets?.presets.find((pp) => pp.id === piPresetId)?.name ?? piPresetId ?? "";
	const isBlockedByPreset = (name: string) => piPresetFiltering && !piPresetAllowed.has(name);
	const subagentToolsBlocked = SUBAGENT_TOOL_NAMES.some(isBlockedByPreset);
	const subagentToolsEnabled = !subagentToolsBlocked && SUBAGENT_TOOL_NAMES.every((name) => !disabledTools.has(name));
	const blockedPresetCount = piPresetFiltering
		? AGENT_TOOL_CATALOG.filter((e) => !piPresetAllowed.has(e.name)).length
		: 0;
	// 非 standard 预设下插件工具一律不可用（见 tool-manager.ts 语义总表）：
	// 横幅计数把「实际被拦的已启用插件工具」也算上，行级开关同步置灰。
	const blockedPluginCount = piPresetFiltering
		? chat.plugins
				.flatMap((pp) => pp.agentTools ?? [])
				.filter((pt) => !(settings.disabledPluginTools ?? []).includes(pt.name)).length
		: 0;

	const tabs: {
		id: SettingsTab;
		icon: React.ReactNode;
		label: string;
		/** 有计数徽标（与各区块标题里的 set-count 同源）。 */
		count?: number;
		/** 插件自定义页：内容交给 PluginPage 渲染（内置分区没有这一项）。 */
		pluginPage?: { plugin: UiPluginInfo; entry: UiSlotEntry };
		/** 悬浮提示（插件条目的 `hint`）。 */
		hint?: string;
	}[] = [
		{ id: "general", icon: <FiSettings />, label: t("settingsGeneral") },
		{ id: "prompt", icon: <FiFileText />, label: t("settingsSystemPrompt") },
		{
			id: "prompt-history",
			icon: <FiClock />,
			label: t("settingsPromptHistory"),
			count: phCount,
		},
		// 内置定时任务（issue #184，全局列表）。
		{
			id: "scheduler" as const,
			icon: <FiClock />,
			label: t("settingsScheduler"),
			count: chat.schedulerTasks.length || undefined,
		},
		// 统一工具开关（tool-manager.ts 目录，逐工具）。
		{
			id: "tools" as const,
			icon: <FiTool />,
			label: t("settingsTools"),
			count: disabledToolsCount + (settings.disabledMarkers?.length ?? 0) || undefined,
		},
		{
			id: "approval-rules" as const,
			icon: <FiShield />,
			label: t("settingsApprovalRules"),
			count: (settings.approvalRules ?? []).length || undefined,
		},
		{ id: "display", icon: <FiMessageSquare />, label: t("settingsMessageDisplay") },
		{ id: "appearance", icon: <FiImage />, label: t("settingsAppearance") },
		{ id: "quick", icon: <FiSend />, label: t("quickPhrases"), count: settings.quickPhrases.length },
		{ id: "skills", icon: <FiCpu />, label: t("settingsSkills"), count: settings.skills.length },
		{ id: "review", icon: <FiZap />, label: t("settingsReview"), count: settings.reviewSkills.length },
		{ id: "vision" as const, icon: <FiEye />, label: t("settingsVisionBridge") },
		{ id: "presets", icon: <FiSliders />, label: t("settingsPresets"), count: settings.presets.length },
		// 子代理模板。
		{
			id: "subagent-templates" as const,
			icon: <FiUsers />,
			label: t("settingsSubagentTemplates"),
			count: (settings.subagentTemplates ?? []).length || undefined,
		},
		// 插件自定义设置页（settings.pages，issue #146）：排在内置分区之后。内容由
		// PluginPage 挂载插件自己的 client bundle 渲染（设置弹窗不关、主视图不切）。
		...pluginPages.map((p) => ({
			id: pluginPageTabId(p.entry.id),
			// 图标：插件给 emoji/单字符就照原样画；给的是宿主图标词表名（或没给）时用通用盒图标，
			// 绝不把 "folder" 这样的词当文字显出来（口径同 SlotTabs.isGlyphIcon）。
			icon: p.entry.iconSvg ? (
				<PluginIcon iconSvg={p.entry.iconSvg} />
			) : p.entry.icon && !/[a-z]/i.test(p.entry.icon) ? (
				<span>{p.entry.icon}</span>
			) : (
				<FiBox />
			),
			label: p.entry.label,
			pluginPage: { plugin: p.plugin, entry: p.entry },
		})),
	];

	/** 当前选中的插件页（tab 形如 `plugin-page:<条目全局 id>`）。找不到 = null：上面的 effect
	 *  会把 tab 纠回默认分区，这里先什么都不画，免得白屏时还留着上一页的错误提示。 */
	const activePluginPage = tab.startsWith("plugin-page:")
		? (pluginPages.find((p) => pluginPageTabId(p.entry.id) === tab) ?? null)
		: null;

	const disabledExts = new Set(settings.disabledExtensions);

	const setPartial = (patch: {
		promptMode?: "append" | "replace";
		customSystemPrompt?: string;
		promptTemplate?: string;
		promptOverrides?: Record<string, string>;
		disabledSkills?: string[];
		disabledExtensions?: string[];
		disabledPlugins?: string[];
		/** 统一工具禁用名单（工具 tab 逐工具开关；遗留单开关仍可用，会折回此名单）。 */
		disabledAgentTools?: string[];
		/** 插件 AI 工具禁用名单（工具名；live 生效无需 reload）。 */
		disabledPluginTools?: string[];
		terminalToolsEnabled?: boolean;
		terminalBash?: boolean;
		terminalBashIdleMs?: number;
		terminalBashMaxForegroundMs?: number;
		toolWatchdogTimeoutMs?: number;
		/** read 工具读目录开关（默认开；行为开关，live 生效无需 reload，见 server/read-tool.ts）。 */
		readDirEnabled?: boolean;
		/** 工具执行审批总开关（默认开；纯运行开关，live 生效无需 reload）。 */
		toolApprovalEnabled?: boolean;
		editSoftEnabled?: boolean;
		questionnaireEnabled?: boolean;
		goalModeEnabled?: boolean;
		parallelReminderEnabled?: boolean;
		thinkingWrap?: boolean;
		toolsWrap?: boolean;
		toolImagesEnabled?: boolean;
		skillsFullText?: string[];
		quickPhrases?: string[];
		quickPhrasesEnabled?: boolean;
		visionBridgeEnabled?: boolean;
		visionBridgeModel?: string | null;
		visionBridgePromptMode?: "append" | "replace";
		visionBridgePrompt?: string;
		scmCommitMsgPromptMode?: "append" | "replace";
		scmCommitMsgPrompt?: string;
		subagentDefaultModel?: string | null;
		retryMaxAttempts?: number;
		softCapTokens?: number;
		reviewPrompt?: string;
		reviewDisabledSkills?: string[];
		markersEnabled?: boolean;
		disabledMarkers?: string[];
	}) => appSend({ type: "set_settings", ...patch });

	/** 提交快捷短语行内编辑（空 = 取消；与原值相同 = 无操作；其余走服务端归一化）。 */
	const commitQuickEdit = () => {
		if (!quickEdit || !settings) return;
		const v = quickEdit.value.trim();
		const i = quickEdit.index;
		setQuickEdit(null);
		if (!v || v === settings.quickPhrases[i]) return;
		const next = [...settings.quickPhrases];
		next[i] = v;
		setPartial({ quickPhrases: next });
	};

	const disabledPlugins = new Set(settings.disabledPlugins ?? []);
	const togglePlugin = (p: UiPluginInfo) => {
		const next = new Set(disabledPlugins);
		if (next.has(p.id)) next.delete(p.id);
		else next.add(p.id);
		setPartial({ disabledPlugins: [...next] });
	};

	const toggleExtension = (e: UiExtensionInfo) => {
		const next = new Set(disabledExts);
		if (next.has(e.id)) next.delete(e.id);
		else next.add(e.id);
		setPartial({ disabledExtensions: [...next] });
	};

	// 子代理是一套能力：一个开关同时控制创建、管理和交接工具。
	const toggleSubagentTools = () => {
		const next = new Set(disabledTools);
		for (const name of SUBAGENT_TOOL_NAMES) {
			if (subagentToolsEnabled) next.add(name);
			else next.delete(name);
		}
		setPartial({ disabledAgentTools: [...next] });
	};
	// 统一工具开关（工具 tab 逐工具；与 toggleSkill 同模式）。
	const toggleAgentTool = (name: string) => {
		const next = new Set(disabledTools);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		setPartial({ disabledAgentTools: [...next] });
	};
	// 插件 AI 工具开关（插件 tab 按插件分组 + 工具 tab 汇总区共用；live 生效）。
	const disabledPluginTools = new Set(settings.disabledPluginTools ?? []);
	const togglePluginTool = (name: string) => {
		const next = new Set(disabledPluginTools);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		setPartial({ disabledPluginTools: [...next] });
	};
	const pluginToolGroups = chat.plugins
		.map((p) => ({ plugin: p, tools: [...(p.agentTools ?? [])].sort((a, b) => a.name.localeCompare(b.name)) }))
		.filter((g) => g.tools.length > 0);

	// ---- markers ----
	const markersEnabled = settings.markersEnabled ?? true;
	const disabledMarkers = new Set(settings.disabledMarkers ?? []);
	const toggleMarker = (name: string) => {
		const next = new Set(disabledMarkers);
		const currentlyEnabled = !next.has(name);
		if (currentlyEnabled) next.add(name);
		else next.delete(name);
		setPartial({ disabledMarkers: [...next] });
	};

	/** Run a maintenance command (extension uninstall / UI-plugin install or
	 *  uninstall) in a VISIBLE terminal tab (same reuse pattern as SCM write
	 *  ops) so the user sees exactly what happened. On exit the App watcher
	 *  sends extensions_reload / plugins_reload to re-discover the lists. */
	const runTerminalCommand = (title: string, command: string) => {
		const cmd: CommandDef = {
			name: title,
			command,
			cwd: "${pwd}",
		};
		let targetId: string;
		const existing = chat.terminals.find((tm) => tm.title === title);
		if (existing) {
			terminal.restart(existing.id);
			appSend({
				type: "run_command",
				terminalId: existing.id,
				conversationId: existing.conversationId,
				command: cmd,
				cols: 80,
				rows: 24,
			});
			targetId = existing.id;
		} else {
			targetId = randomUuid();
			terminal.create({
				id: targetId,
				conversationId: chat.activeConversationId || chat.state?.conversationId || "",
				title,
				cwd: chat.state?.cwd ?? "",
				cols: 80,
				rows: 24,
				running: true,
				exitCode: null,
				command: cmd,
			});
		}
		terminal.select(targetId);
		onSwitchToTerminal();
		onClose();
	};

	/** Uninstall a `pi install`-ed package: run `pi remove npm:<pkg>` in a
	 *  visible terminal tab (see runTerminalCommand). */
	const runUninstall = (pkgName: string) => {
		setConfirmUninstall(null);
		runTerminalCommand(`${t("uninstallTitle")} ${pkgName}`, `pi remove npm:${pkgName}`);
	};

	const toggleReviewSkill = (s: UiSkillInfo) => {
		const disabled = new Set(settings.reviewSkills.filter((x) => !x.enabled).map((x) => x.name));
		if (disabled.has(s.name)) disabled.delete(s.name);
		else disabled.add(s.name);
		setPartial({ reviewDisabledSkills: [...disabled] });
	};

	const commitTemplate = () => setPartial({ promptTemplate: promptTemplateDraft });

	const commitOverride = (token: string) => {
		setPartial({ promptOverrides: { [token]: promptOverridesDraft[token] ?? "" } });
	};

	const resetOverride = (token: string) => {
		if (overrideFocus.current === token) overrideFocus.current = null;
		setEditingSource(null);
		setPromptOverridesDraft((p) => {
			const n = { ...p };
			delete n[token];
			return n;
		});
		setPartial({ promptOverrides: { [token]: "" } });
	};

	/** 来源默认内容预览的长文本展开/收起。 */
	const toggleDefault = (tk: string) => setDefaultOpen((p) => ({ ...p, [tk]: !p[tk] }));

	/** 覆盖输入时一键把默认（自动）内容填进覆盖框 —— 只想改一小部分时用它打底（填
	 *  入后该来源内容固定，不再随每次对话自动重新生成）。 */
	const seedFromDefault = (tk: string, def: string) => {
		setPromptOverridesDraft((p) => ({ ...p, [tk]: def }));
		setEditingSource(tk);
	};

	const resetAllPrompt = () => {
		templateFocus.current = false;
		overrideFocus.current = null;
		setPromptTemplateDraft(DEFAULT_PROMPT_TEMPLATE);
		setPromptOverridesDraft({});
		setPartial({ promptTemplate: DEFAULT_PROMPT_TEMPLATE, promptOverrides: {} });
	};

	const appendTokenToTemplate = (token: string) => {
		setPromptTemplateDraft((prev) => (prev.trim() ? `${prev}\n\n{{${token}}}` : `{{${token}}}`));
	};

	const hasPromptCustom =
		(promptTemplateDraft.trim() && promptTemplateDraft.trim() !== DEFAULT_PROMPT_TEMPLATE) ||
		Object.values(promptOverridesDraft).some((v) => v.trim());

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
				<button type="button" className="modal-close" aria-label={t("close")} onClick={onClose}>
					<FiX />
				</button>
				<div className="modal-head">
					<FiSettings className="modal-head-icon" />
					<h2>{t("settingsTitle")}</h2>
					{/* 长说明收起为「？」悬浮提示，不再平铺占版面 */}
					<HintTip text={t("settingsDesc")} />
				</div>

				{/* Scrollable body — head above and the actions bar below stay
				    fixed; only these sections scroll. */}
				<div className="settings-layout">
					<nav className="settings-rail" aria-label={t("settingsTitle")} ref={railRef}>
						{tabs.map((tb) => (
							<button
								key={tb.id}
								type="button"
								data-tab={tb.id}
								className={`settings-tab${tab === tb.id ? " active" : ""}`}
								aria-current={tab === tb.id ? "true" : undefined}
								title={tb.hint ?? tb.label}
								onClick={() => setTab(tb.id)}
							>
								<span className="settings-tab-icon">{tb.icon}</span>
								<span className="settings-tab-label">{tb.label}</span>
								{tb.count !== undefined && <span className="set-count">{tb.count}</span>}
							</button>
						))}
					</nav>
					<div className="modal-body" ref={bodyRef}>
						{/* ---- 通用（声音 / 语言）--------------------------------------- */}
						{tab === "general" && (
							<>
								<div className="set-section">
									<div className="set-section-title">
										<FiVolume2 className="set-section-icon" />
										{t("sound")}
									</div>
									<SoundSettingsPanel settings={sound} onChange={onSoundChange} />
									<NotifyToggle />
								</div>
								<div className="set-section">
									<div className="set-section-title">
										<FiGlobe className="set-section-icon" />
										{t("language")}
									</div>
									<LanguageSettings />
								</div>
								<UpdateSettings appVersion={appVersion} />
							</>
						)}

						{/* ---- system prompt -------------------------------------------- */}
						{tab === "prompt" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiZap className="set-section-icon" />
									{t("settingsSystemPrompt")}
									<HintTip text={`${t("promptComposeHint")}\n${t("promptComposeDesc")}`} />
								</div>
								<div className="set-field">
									<label className="set-field-label">{t("promptTemplateLabel")}</label>
									<textarea
										className="set-prompt-input"
										rows={6}
										spellCheck={false}
										placeholder={DEFAULT_PROMPT_TEMPLATE}
										value={promptTemplateDraft}
										onFocus={() => (templateFocus.current = true)}
										onBlur={() => {
											templateFocus.current = false;
											commitTemplate();
										}}
										onChange={(e) => setPromptTemplateDraft(e.target.value)}
									/>
									<div className="compose-toolbar">
										<span className="set-field-label set-muted">{t("promptInsertTokens")}</span>
										{orderedPromptTokens.map((tk) => (
											<button
												key={tk}
												type="button"
												className="token-chip"
												title={tt(`promptTok_${tk}_desc`)}
												onClick={() => appendTokenToTemplate(tk)}
											>
												{`{{${tk}}}`}
											</button>
										))}
									</div>
								</div>
								{/* 各来源覆盖：留空 = 用自动内容；未覆盖时行内直接展示该来源当前的默认（自动）内容 */}
								<div className="set-field">
									<label className="set-field-label">{t("promptSourcesLabel")}</label>
									{orderedPromptTokens.map((tk) => {
										const v = promptOverridesDraft[tk] ?? "";
										// 该来源当前默认（自动）内容：会话未就绪时为空对象 → def = ""。
										const def = settings.promptSourceDefaults?.[tk] ?? "";
										const editing = editingSource === tk;
										const isLong = def.split("\n").length > 6 || def.length > 480;
										if (isReadonlyPromptSource(tk)) {
											const shown = v.trim() ? v : def;
											return (
												<div className="override-row readonly" key={tk}>
													<div className="override-row-head">
														{`{{${tk}}}`}
														<span className="set-muted">
															{tt(`promptTok_${tk}`)} <HintTip text={tt(`promptTok_${tk}_desc`)} />
														</span>
														{v.trim() ? (
															<button
																type="button"
																className="set-btn-mini"
																title={t("promptReadonlyLockedHint")}
																onClick={() => resetOverride(tk)}
															>
																{t("promptResetSource")}
															</button>
														) : (
															<span className="set-muted">{t("promptReadonlyBadge")}</span>
														)}
													</div>
													<div
														className={`source-default readonly${shown.trim() ? "" : " empty"}`}
														title={t("promptReadonlyTitle")}
													>
														{shown.trim() ? (
															<>
																<pre
																	className={`source-default-text${
																		isLong ? (defaultOpen[tk] ? " expanded" : " clamped") : ""
																	}`}
																>
																	{shown}
																</pre>
																{isLong && (
																	<span
																		className="source-default-toggle"
																		role="button"
																		tabIndex={0}
																		onClick={(e) => {
																			e.stopPropagation();
																			toggleDefault(tk);
																		}}
																		onKeyDown={(e) => {
																			if (e.key === "Enter" || e.key === " ") {
																				e.preventDefault();
																				e.stopPropagation();
																				toggleDefault(tk);
																			}
																		}}
																	>
																		{defaultOpen[tk] ? t("promptSourceCollapse") : t("promptSourceExpand")}
																	</span>
																)}
															</>
														) : (
															<span className="source-default-empty">{t("promptSourceDefaultEmpty")}</span>
														)}
													</div>
												</div>
											);
										}
										return (
											<div className="override-row" key={tk}>
												<div className="override-row-head">
													{`{{${tk}}}`}
													<span className="set-muted">
														{tt(`promptTok_${tk}`)} <HintTip text={tt(`promptTok_${tk}_desc`)} />
													</span>
													{v.trim() ? (
														<button type="button" className="set-btn-mini" onClick={() => resetOverride(tk)}>
															{t("promptResetSource")}
														</button>
													) : (
														<span className="set-muted">{t("promptAutoBadge")}</span>
													)}
												</div>
												{v.trim() || editing ? (
													<>
														<textarea
															className="set-prompt-input override-input"
															rows={Math.min(10, Math.max(1, v.split("\n").length))}
															autoFocus={editing}
															placeholder={t("promptOverridePlaceholder")}
															value={v}
															onFocus={(e) => {
																overrideFocus.current = tk;
																setEditingSource(tk);
																// 刚点预览载入默认文本时把光标放到末尾，方便直接接着改。
																const el = e.currentTarget as HTMLTextAreaElement;
																if (el.value && el.value === def)
																	el.setSelectionRange(el.value.length, el.value.length);
															}}
															onBlur={() => {
																if (overrideFocus.current === tk) overrideFocus.current = null;
																const val = promptOverridesDraft[tk] ?? "";
																if (val.trim() && val === def) {
																	// 点击预览载入默认后原样失焦（没改任何字）→ 不产生覆盖，仍用自动内容。
																	resetOverride(tk);
																	return;
																}
																commitOverride(tk);
																if (!val.trim()) setEditingSource(null);
															}}
															onChange={(e) => setPromptOverridesDraft((p) => ({ ...p, [tk]: e.target.value }))}
														/>
														{/* 编辑覆盖内容时，下方始终展示该来源的默认（自动）内容，方便对照/复制/只改一小部分。 */}
														<div className="override-edit-foot">
															<div className="override-edit-foot-head">
																<span className="set-muted">{t("promptSourceRefLabel")}</span>
																{isLong && (
																	<button
																		type="button"
																		className="source-default-toggle"
																		onClick={() => toggleDefault(tk)}
																	>
																		{defaultOpen[tk] ? t("promptSourceCollapse") : t("promptSourceExpand")}
																	</button>
																)}
															</div>
															{def.trim() ? (
																<pre
																	className={`source-default-text${
																		isLong ? (defaultOpen[tk] ? " expanded" : " clamped") : ""
																	}`}
																>
																	{def}
																</pre>
															) : (
																<span className="source-default-empty">{t("promptSourceDefaultEmpty")}</span>
															)}
															{!v.trim() && def.trim() && (
																<button
																	type="button"
																	className="override-seed-btn"
																	title={t("promptSourceSeedTip")}
																	onClick={() => seedFromDefault(tk, def)}
																>
																	{t("promptSourceSeedButton")}
																</button>
															)}
														</div>
													</>
												) : (
													// 未覆盖：行内展示默认（自动）内容；点击 = 载入默认文本开始编辑（不改就失焦则回到自动内容）。
													<div
														className="source-default"
														title={t("promptSourceDefaultEditHint")}
														role="button"
														tabIndex={0}
														onClick={() => seedFromDefault(tk, def)}
														onKeyDown={(e) => {
															if (e.key === "Enter" || e.key === " ") {
																e.preventDefault();
																seedFromDefault(tk, def);
															}
														}}
													>
														{def.trim() ? (
															<>
																<pre
																	className={`source-default-text${
																		isLong ? (defaultOpen[tk] ? " expanded" : " clamped") : ""
																	}`}
																>
																	{def}
																</pre>
																{isLong && (
																	<span
																		className="source-default-toggle"
																		role="button"
																		tabIndex={0}
																		onClick={(e) => {
																			e.stopPropagation();
																			toggleDefault(tk);
																		}}
																		onKeyDown={(e) => {
																			if (e.key === "Enter" || e.key === " ") {
																				e.preventDefault();
																				e.stopPropagation();
																				toggleDefault(tk);
																			}
																		}}
																	>
																		{defaultOpen[tk] ? t("promptSourceCollapse") : t("promptSourceExpand")}
																	</span>
																)}
															</>
														) : (
															<span className="source-default-empty">{t("promptSourceDefaultEmpty")}</span>
														)}
													</div>
												)}
											</div>
										);
									})}
									<div className="compose-toolbar">
										<button type="button" className="set-btn" onClick={resetAllPrompt} disabled={!hasPromptCustom}>
											{t("promptResetAll")}
										</button>
									</div>
								</div>
								<button
									type="button"
									className="set-view-prompt-btn"
									aria-expanded={showFullPrompt}
									onClick={() => setShowFullPrompt((v) => !v)}
								>
									{t("settingsViewPrompt")} {showFullPrompt ? "▴" : "▾"}
								</button>
								{showFullPrompt && (
									<div className="set-prompt-view">
										<div className="set-prompt-view-head">
											<span>{t("settingsViewPrompt")}</span>
											<HintTip text={t("settingsViewPromptHint")} />
											<CopyButton text={settings.effectiveSystemPrompt} />
										</div>
										{settings.effectiveSystemPrompt ? (
											<pre className="set-prompt-view-text">{settings.effectiveSystemPrompt}</pre>
										) : (
											<p className="set-empty">{t("settingsViewPromptEmpty")}</p>
										)}
									</div>
								)}
							</div>
						)}

						{/* ---- AI 提交信息（SCM 面板的 scm_commitmsg 生成提示词） ---- */}
						{tab === "prompt" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiGitBranch className="set-section-icon" />
									{t("scmCommitMsgSettingsTitle")}
									<HintTip text={t("scmCommitMsgSettingsDesc")} />
								</div>
								<FieldRow label={t("visionBridgePromptMode")}>
									<select
										className="set-select"
										value={scmMsgMode}
										onChange={(e) => {
											const mode = e.target.value as "append" | "replace";
											setScmMsgMode(mode);
											setPartial({ scmCommitMsgPromptMode: mode });
										}}
									>
										<option value="append">{t("promptModeAppend")}</option>
										<option value="replace">{t("promptModeReplace")}</option>
									</select>
								</FieldRow>
								<textarea
									className="set-prompt-input"
									rows={4}
									placeholder={t("scmCommitMsgPromptPlaceholder")}
									value={scmMsgDraft}
									onFocus={() => (scmMsgFocus.current = true)}
									onBlur={() => {
										scmMsgFocus.current = false;
										// 与系统提示词同一契约：replace 下未改动的内置默认存空（用默认）。
										const text =
											scmMsgMode === "replace" &&
											settings.scmCommitMsgDefaultPrompt &&
											scmMsgDraft === settings.scmCommitMsgDefaultPrompt
												? ""
												: scmMsgDraft;
										setPartial({
											scmCommitMsgPromptMode: scmMsgMode,
											scmCommitMsgPrompt: text,
										});
									}}
									onChange={(e) => setScmMsgDraft(e.target.value)}
								/>
								<p className="set-hint">{t("scmCommitMsgSettingsHint")}</p>
							</div>
						)}

						{/* ---- prompt history -------------------------------------------- */}
						{tab === "scheduler" && (
							<SchedulerPanel
								tasks={chat.schedulerTasks}
								cwd={chat.state?.cwd ?? ""}
								models={settings.subagentModels}
							/>
						)}
						{tab === "prompt-history" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiClock className="set-section-icon" />
									{t("settingsPromptHistory")}
									<HintTip text={t("settingsPromptHistoryDesc")} />
									<span className="set-count">{t("promptHistoryCount", { n: String(phCount) })}</span>
								</div>
								{phCount === 0 ? (
									<p className="set-empty">{t("promptHistoryEmpty")}</p>
								) : (
									<p className="set-hint">{t("promptHistoryCount", { n: String(phCount) })}</p>
								)}
								<FieldRow label={t("promptHistoryMax")} tip={t("promptHistoryMaxHint")} htmlFor="ph-max">
									<input
										id="ph-max"
										className="set-input"
										type="number"
										min={1}
										max={500}
										step={1}
										value={String(phSettings.maxEntries)}
										onChange={(e) => {
											const v = Math.floor(Number(e.target.value) || 0);
											const next = { ...phSettings, maxEntries: v };
											setPhSettings(next);
										}}
										onBlur={() => {
											const norm = { ...phSettings };
											if (!Number.isFinite(norm.maxEntries) || norm.maxEntries < 1) norm.maxEntries = 1;
											if (norm.maxEntries > 500) norm.maxEntries = 500;
											norm.maxEntries = Math.floor(norm.maxEntries);
											setPhSettings(norm);
											savePromptHistorySettings(norm);
											refreshPhCount();
										}}
									/>
								</FieldRow>
								<div className="set-field" style={{ marginTop: 12 }}>
									<button
										type="button"
										className={`set-uninstall${phClearConfirm ? " confirm" : ""}`}
										disabled={phCount === 0}
										title={phCount === 0 ? t("promptHistoryEmpty") : t("promptHistoryClear")}
										onClick={() => {
											if (!phClearConfirm) {
												setPhClearConfirm(true);
												return;
											}
											clearPromptHistory();
											setPhClearConfirm(false);
											refreshPhCount();
										}}
									>
										<FiTrash2 /> {phClearConfirm ? t("promptHistoryClearConfirm") : t("promptHistoryClear")}
									</button>
									{phCount > 0 && (
										<span className="set-hint" style={{ marginLeft: 8 }}>
											{t("promptHistoryCount", { n: String(phCount) })}
										</span>
									)}
								</div>
								<p className="set-hint">
									<FiArchive style={{ verticalAlign: "-2px", marginRight: 4 }} />
									{t("settingsPromptHistoryDesc")}
								</p>
							</div>
						)}

						{/* ---- agent tools (unified tool_manage) ------------------------- */}
						{tab === "tools" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiTool className="set-section-icon" />
									{t("settingsTools")}
								</div>
								{piPresetFiltering && (
									<p className="set-catalog-hint warn">
										{t("toolsPresetBanner", { name: piPresetName, count: blockedPresetCount + blockedPluginCount })}{" "}
										<button
											type="button"
											className="chip"
											onClick={() => appSend({ type: "agent_preset_default", preset: "standard" })}
										>
											{t("toolsBackToStandard")}
										</button>
									</p>
								)}
								<ToggleRow
									title={t("readDirEnabled")}
									tip={t("readDirEnabledDesc")}
									enabled={settings.readDirEnabled !== false}
									onToggle={() => setPartial({ readDirEnabled: settings.readDirEnabled === false })}
								/>
								<ToggleRow
									title={t("toolApprovalEnabled")}
									tip={t("toolApprovalEnabledDesc")}
									enabled={settings.toolApprovalEnabled !== false}
									onToggle={() => setPartial({ toolApprovalEnabled: settings.toolApprovalEnabled === false })}
									action={
										<button
											type="button"
											className="tpl-chip"
											onClick={() => setTab("approval-rules")}
											title={t("settingsApprovalRulesDesc")}
										>
											<FiShield /> {t("manageApprovalRules")}
										</button>
									}
								/>
								{/* 已记住的放行（本对话）：只存内存，撤销就在设置里（审批弹窗本身不再出现） */}
								{approvalPolicy?.allowAll || (approvalPolicy?.categories.length ?? 0) > 0 ? (
									<div className="set-field" style={{ marginTop: 8 }}>
										<div className="set-field-label">
											{t("toolApprovalPolicyTitle")}
											<HintTip text={t("toolApprovalPolicyHint")} />
										</div>
										{approvalPolicy?.allowAll && (
											<div className="set-row">
												<span className="set-hint">{t("toolApprovalPolicyAllowAll")}</span>
												<button
													type="button"
													className="btn"
													onClick={() => appSend({ type: "set_approval_policy", allowAll: false })}
												>
													{t("toolApprovalPolicyRevoke")}
												</button>
											</div>
										)}
										{(approvalPolicy?.categories ?? []).map((c) => (
											<div className="set-row" key={c.id}>
												<span className="set-hint">{locale === "zh" ? c.label : c.labelEn}</span>
												<button
													type="button"
													className="btn"
													onClick={() =>
														appSend({
															type: "set_approval_policy",
															categories: (approvalPolicy?.categories ?? [])
																.filter((x) => x.id !== c.id)
																.map((x) => x.id),
														})
													}
												>
													{t("toolApprovalPolicyRevoke")}
												</button>
											</div>
										))}
									</div>
								) : null}
								<FieldRow
									label={t("toolWatchdogTimeout")}
									tip={t("toolWatchdogTimeoutDesc")}
									htmlFor="tool-watchdog-timeout"
								>
									<input
										id="tool-watchdog-timeout"
										className="set-input"
										type="number"
										min={0}
										step={1}
										placeholder={t("toolWatchdogOff")}
										value={watchdogMinDraft}
										onChange={(e) => setWatchdogMinDraft(e.target.value)}
										onBlur={() => {
											const raw = watchdogMinDraft.trim();
											const min = raw === "" ? 20 : Math.max(0, Math.floor(Number(raw) || 0));
											setWatchdogMinDraft(String(min));
											const ms = min * 60_000;
											if (ms !== settings.toolWatchdogTimeoutMs) {
												setPartial({ toolWatchdogTimeoutMs: ms });
											}
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter") (e.target as HTMLInputElement).blur();
										}}
									/>
								</FieldRow>
								<div className="set-field-label">{t("toolsSectionTerminal")}</div>
								{TERMINAL_TOOL_NAMES.map((n) => {
									const blocked = isBlockedByPreset(n);
									return (
										<ToggleRow
											key={n}
											title={n}
											tip={t("settingsTerminalToolsDesc")}
											subtitle={blocked ? t("toolsBlockedByPreset", { name: piPresetName }) : undefined}
											enabled={!blocked && !disabledTools.has(n)}
											disabled={blocked}
											onToggle={() => toggleAgentTool(n)}
										/>
									);
								})}
								<ToggleRow
									title={t("terminalBashTakeover")}
									tip={t("terminalBashTakeoverDesc")}
									enabled={settings.terminalBash}
									onToggle={() => setPartial({ terminalBash: !settings.terminalBash })}
								/>
								{settings.terminalBash && (
									<>
										<FieldRow label={t("terminalBashIdleMs")} tip={t("terminalBashIdleMsDesc")} htmlFor="tb-idle-ms">
											<input
												id="tb-idle-ms"
												className="set-input"
												type="number"
												min={0}
												step={1000}
												value={idleMsDraft}
												onChange={(e) => setIdleMsDraft(e.target.value)}
												onBlur={() => {
													const n = Math.max(0, Math.floor(Number(idleMsDraft) || 0));
													setIdleMsDraft(String(n));
													if (n !== settings.terminalBashIdleMs) {
														setPartial({ terminalBashIdleMs: n });
													}
												}}
											/>
										</FieldRow>
										<FieldRow
											label={t("terminalBashMaxForegroundMs")}
											tip={t("terminalBashMaxForegroundMsDesc")}
											htmlFor="tb-max-ms"
										>
											<input
												id="tb-max-ms"
												className="set-input"
												type="number"
												min={0}
												step={1000}
												value={maxMsDraft}
												onChange={(e) => setMaxMsDraft(e.target.value)}
												onBlur={() => {
													const n = Math.max(0, Math.floor(Number(maxMsDraft) || 0));
													setMaxMsDraft(String(n));
													if (n !== settings.terminalBashMaxForegroundMs) {
														setPartial({ terminalBashMaxForegroundMs: n });
													}
												}}
											/>
										</FieldRow>
									</>
								)}
								<ToggleRow
									title={t("toolsSectionSubagent")}
									tip={t("toolsSubagentDepHint")}
									subtitle={subagentToolsBlocked ? t("toolsBlockedByPreset", { name: piPresetName }) : undefined}
									enabled={subagentToolsEnabled}
									disabled={subagentToolsBlocked}
									onToggle={toggleSubagentTools}
								/>
								<div className="set-field-label">
									{t("settingsMarkers")}
									<HintTip text={`${t("settingsMarkersDesc")}\n${t("markerRenameTip")}`} />
								</div>
								<ToggleRow
									title={t("markersEnabled")}
									tip={`${t("markersEnabledDesc")}\n${t("markersOffHint")}`}
									enabled={markersEnabled}
									onToggle={() => setPartial({ markersEnabled: !markersEnabled })}
								/>
								{markersEnabled && (settings.markers?.length ?? 0) === 0 && (
									<p className="set-empty">{t("loading")}...</p>
								)}
								{markersEnabled &&
									settings.markers &&
									settings.markers.length > 0 &&
									settings.markers.map((m) => (
										<ToggleRow
											key={m.name}
											title={
												m.name === "todo"
													? t("markerGroupTodo")
													: m.name === "notify"
														? t("markerGroupNotify")
														: m.name === "conv"
															? t("markerGroupRename")
															: m.name
											}
											tip={m.guidance.join("\n")}
											enabled={m.enabled}
											onToggle={() => toggleMarker(m.name)}
										/>
									))}
								<ToggleRow
									title={MARKERS_LIST_TOOL_NAME}
									tip={`${t("todoListEnabledDesc")}\n${t("todoListOffHint")}`}
									subtitle={
										isBlockedByPreset(MARKERS_LIST_TOOL_NAME)
											? t("toolsBlockedByPreset", { name: piPresetName })
											: undefined
									}
									enabled={!isBlockedByPreset(MARKERS_LIST_TOOL_NAME) && !disabledTools.has(MARKERS_LIST_TOOL_NAME)}
									disabled={isBlockedByPreset(MARKERS_LIST_TOOL_NAME)}
									onToggle={() => toggleAgentTool(MARKERS_LIST_TOOL_NAME)}
								/>
								<div className="set-field-label">{t("toolsSectionOther")}</div>
								{OTHER_AGENT_TOOLS.map((tool) => {
									const blocked = isBlockedByPreset(tool.name);
									return (
										<ToggleRow
											key={tool.name}
											title={tool.name}
											tip={`${tt(tool.descKey ?? tool.name)}\n${tt(tool.offHintKey ?? tool.name)}`}
											subtitle={blocked ? t("toolsBlockedByPreset", { name: piPresetName }) : undefined}
											enabled={!blocked && !disabledTools.has(tool.name)}
											disabled={blocked}
											onToggle={() => toggleAgentTool(tool.name)}
										/>
									);
								})}
								<div className="set-field-label">
									{t("toolsSectionPlugin")}
									<HintTip text={t("toolsPluginHint")} />
								</div>
								{pluginToolGroups.length === 0 ? (
									<p className="set-empty">{chat.plugins.length === 0 ? t("noUiPlugins") : t("pluginToolsEmpty")}</p>
								) : (
									pluginToolGroups.map((g) => (
										<div key={g.plugin.id}>
											<div className="set-row-desc">
												{g.plugin.icon ? `${g.plugin.icon} ` : ""}
												{g.plugin.name} · {g.plugin.id}
											</div>
											{g.tools.map((tool) => (
												<ToggleRow
													key={tool.name}
													title={tool.label && tool.label !== tool.name ? `${tool.label} (${tool.name})` : tool.name}
													tip={
														tool.description ? `${tool.description}\n${t("pluginToolOffHint")}` : t("pluginToolOffHint")
													}
													subtitle={piPresetFiltering ? t("toolsBlockedByPreset", { name: piPresetName }) : undefined}
													enabled={!piPresetFiltering && !disabledPluginTools.has(tool.name)}
													disabled={piPresetFiltering}
													onToggle={() => togglePluginTool(tool.name)}
												/>
											))}
										</div>
									))
								)}
							</div>
						)}

						{/* ---- questionnaire (DSH only; pi moved into Tools) -------------- */}
						{tab === "question" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiHelpCircle className="set-section-icon" />
									{t("settingsQuestionnaire")}
								</div>
								<ToggleRow
									title={t("questionnaireEnabled")}
									tip={`${t("questionnaireEnabledDesc")}\n${t("questionnaireOffHint")}`}
									enabled={settings.questionnaireEnabled}
									onToggle={() => setPartial({ questionnaireEnabled: !settings.questionnaireEnabled })}
								/>
							</div>
						)}

						{/* ---- message display ----------------------------------------- */}
						{tab === "display" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiMessageSquare className="set-section-icon" />
									{t("settingsMessageDisplay")}
								</div>
								<FieldRow label={t("softCapTokens")} tip={t("softCapHint")} htmlFor="soft-cap-max">
									<input
										id="soft-cap-max"
										className="set-input"
										type="text"
										placeholder={t("softCapOff")}
										value={softCapDraft}
										onChange={(e) => setSoftCapDraft(e.target.value)}
										onBlur={() => {
											const n = parseTokenInput(softCapDraft);
											setSoftCapDraft(formatTokenDraft(n));
											if (n !== (settings.softCapTokens ?? 0)) {
												setPartial({ softCapTokens: n });
											}
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter") (e.target as HTMLInputElement).blur();
										}}
									/>
								</FieldRow>
								<FieldRow label={t("modelRetryAttempts")} tip={t("modelRetryHint")} htmlFor="model-retry-max">
									<input
										id="model-retry-max"
										className="set-input"
										type="number"
										min={0}
										max={100}
										step={1}
										value={retryDraft}
										onChange={(e) => setRetryDraft(e.target.value)}
										onBlur={() => {
											const n = Math.min(100, Math.max(0, Math.floor(Number(retryDraft) || 0)));
											setRetryDraft(String(n));
											if (n !== settings.retryMaxAttempts) {
												setPartial({ retryMaxAttempts: n });
											}
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter") (e.target as HTMLInputElement).blur();
										}}
									/>
								</FieldRow>
								<ToggleRow
									title={t("thinkingWrap")}
									tip={t("thinkingWrapDesc")}
									enabled={settings.thinkingWrap ?? false}
									onToggle={() => setPartial({ thinkingWrap: !(settings.thinkingWrap ?? false) })}
								/>
								<ToggleRow
									title={t("toolsWrap")}
									tip={t("toolsWrapDesc")}
									enabled={settings.toolsWrap ?? false}
									onToggle={() => setPartial({ toolsWrap: !(settings.toolsWrap ?? false) })}
								/>
								<ToggleRow
									title={t("toolImages")}
									tip={t("toolImagesDesc")}
									enabled={settings.toolImagesEnabled ?? true}
									onToggle={() => setPartial({ toolImagesEnabled: !(settings.toolImagesEnabled ?? true) })}
								/>
								<ToggleRow
									title={t("presentAutoOpen")}
									tip={t("presentAutoOpenDesc")}
									enabled={presentAutoOpen}
									onToggle={() => savePresentAutoOpen(!presentAutoOpen)}
								/>
								<ToggleRow
									title={t("parallelReminderEnabled")}
									tip={`${t("parallelReminderEnabledDesc")}\n${t("parallelReminderOffHint")}`}
									enabled={settings.parallelReminderEnabled ?? true}
									onToggle={() => setPartial({ parallelReminderEnabled: !(settings.parallelReminderEnabled ?? true) })}
								/>
								<hr className="set-sep" />
								<ToggleRow
									title={t("wideChat")}
									tip={t("wideChatDesc")}
									enabled={wideChat}
									onToggle={() => saveChatWidthSettings({ wide: !wideChat })}
								/>
								<ToggleRow
									title={t("projectTitle")}
									tip={t("projectTitleDesc")}
									enabled={projectTitle}
									onToggle={() => saveTitleSettings({ projectName: !projectTitle })}
								/>
							</div>
						)}

						{/* ---- 界面设置（外观）：聊天背景图 + 面板透明度 ------------------- */}
						{/* ---- 主题（从顶栏「主题」下拉搬来）---------------------------- */}
						{tab === "appearance" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiSun className="set-section-icon" />
									{t("theme")}
									<HintTip text={t("themeHint")} />
								</div>
								<FieldRow label={t("theme")}>
									<select
										className="set-select"
										value={theme ?? ""}
										onFocus={() => {
											// 挂载那次拉取撞上服务端重启会扑空：列表还空就补拉一次
											if (themes.length === 0) reloadThemes();
										}}
										onChange={(e) => onThemeChange(e.target.value || null)}
									>
										<option value="">{t("themeDefault")}</option>
										{themes.map((th) => (
											<option key={th.id} value={th.id}>
												{themeOptionLabel(th, locale, t)}
											</option>
										))}
									</select>
								</FieldRow>
								<div className="set-note">{t("themeRememberHint")}</div>
							</div>
						)}

						{tab === "appearance" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiImage className="set-section-icon" />
									{t("settingsAppearance")}
								</div>
								<div className="set-row">
									<div className="set-row-info">
										<div className="set-row-name">
											{t("wallpaperTitle")}
											<HintTip text={t("wallpaperDesc")} />
										</div>
										<div className="compose-toolbar">
											<button
												type="button"
												className="set-save-btn"
												disabled={wallpaperUploading}
												onClick={() => wallpaperFileRef.current?.click()}
											>
												<FiUpload /> {t("wallpaperUpload")}
											</button>
											<input
												ref={wallpaperFileRef}
												type="file"
												accept="image/*"
												hidden
												onChange={onPickWallpaperFile}
											/>
										</div>
										{wallpaperUploadError && <p className="set-hint">{t("wallpaperUploadFailed")}</p>}
										<div className="wallpaper-sliders">
											<label className="wallpaper-slider" title={t("wallpaperPanelOpacityDesc")}>
												<span>{t("wallpaperPanelOpacity")}</span>
												<input
													type="range"
													min={0}
													max={100}
													step={1}
													value={wallpaper.panelOpacity}
													onChange={(e) =>
														saveWallpaperSettings({ ...wallpaper, panelOpacity: Number(e.target.value) })
													}
												/>
												<output>{wallpaper.panelOpacity}%</output>
											</label>
											<label className="wallpaper-slider">
												<span>{t("wallpaperDim")}</span>
												<input
													type="range"
													min={0}
													max={95}
													step={1}
													value={wallpaper.dim}
													onChange={(e) => saveWallpaperSettings({ ...wallpaper, dim: Number(e.target.value) })}
												/>
												<output>{wallpaper.dim}%</output>
											</label>
											<label className="wallpaper-slider">
												<span>{t("wallpaperBlur")}</span>
												<input
													type="range"
													min={0}
													max={24}
													step={1}
													value={wallpaper.blur}
													onChange={(e) => saveWallpaperSettings({ ...wallpaper, blur: Number(e.target.value) })}
												/>
												<output>{wallpaper.blur}px</output>
											</label>
										</div>
									</div>
									{wallpaper.url && (
										<div className="wallpaper-current">
											<img className="wallpaper-preview" src={wallpaper.url} alt="" />
											<button
												type="button"
												className="wallpaper-clear"
												onClick={() => {
													saveWallpaperSettings({ ...wallpaper, url: "" });
												}}
											>
												{t("wallpaperClear")}
											</button>
										</div>
									)}
								</div>
							</div>
						)}

						{/* ---- 整体不透明度（窗口级，--window-opacity）+ 兜底开关 ---- */}
						{tab === "appearance" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiSun className="set-section-icon" />
									{t("windowOpacityTitle")}
									<HintTip text={t("windowOpacityDesc")} />
								</div>
								<div className="set-row">
									<div className="set-row-info">
										<div className="wallpaper-sliders">
											<label className="wallpaper-slider">
												<span>{t("windowOpacityLabel")}</span>
												<input
													type="range"
													min={0}
													max={100}
													step={1}
													value={windowOpacity}
													disabled={!windowTransparent}
													onChange={(e) => saveWindowOpacity(Number(e.target.value))}
												/>
												<output>{windowOpacity}%</output>
											</label>
										</div>
									</div>
								</div>
								<ToggleRow
									title={t("windowTransparentTitle")}
									tip={t("windowTransparentDesc")}
									enabled={windowTransparent}
									onToggle={() => saveWindowTransparent(!windowTransparent)}
								/>
							</div>
						)}

						{/* ---- 快捷短语（输入框上方一键发送） ------------------------------ */}
						{tab === "quick" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiSend className="set-section-icon" />
									{t("quickPhrases")}
									<HintTip text={t("quickPhrasesDesc")} />
									<span className="set-count">{settings.quickPhrases.length}</span>
								</div>
								<ToggleRow
									title={t("quickPhrasesEnabled")}
									tip={t("quickPhrasesDesc")}
									enabled={settings.quickPhrasesEnabled}
									onToggle={() => setPartial({ quickPhrasesEnabled: !settings.quickPhrasesEnabled })}
								/>
								{!settings.quickPhrasesEnabled && <p className="set-hint">{t("quickPhrasesOffHint")}</p>}
								<div className="set-preset-save">
									<input
										className="set-input"
										placeholder={t("quickPhrasesPlaceholder")}
										value={quickNew}
										maxLength={200}
										onChange={(e) => setQuickNew(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && quickNew.trim()) {
												setPartial({ quickPhrases: [...settings.quickPhrases, quickNew.trim()] });
												setQuickNew("");
											}
										}}
									/>
									<button
										type="button"
										className="set-save-btn"
										disabled={!quickNew.trim()}
										onClick={() => {
											setPartial({ quickPhrases: [...settings.quickPhrases, quickNew.trim()] });
											setQuickNew("");
										}}
									>
										<FiPlus /> {t("quickPhrasesAdd")}
									</button>
								</div>
								{settings.quickPhrases.length === 0 ? (
									<p className="set-empty">{t("quickPhrasesEmpty")}</p>
								) : (
									<div className="set-list">
										{settings.quickPhrases.map((p, i) => (
											<div className="set-row" key={`${i}:${p}`}>
												{quickEdit?.index === i ? (
													<div className="set-row-info">
														<input
															className="set-input"
															autoFocus
															value={quickEdit.value}
															maxLength={200}
															placeholder={t("quickPhrasesEditPh")}
															onChange={(e) => setQuickEdit({ index: i, value: e.target.value })}
															onKeyDown={(e) => {
																if (e.key === "Enter") commitQuickEdit();
																else if (e.key === "Escape") setQuickEdit(null);
															}}
															onBlur={commitQuickEdit}
														/>
													</div>
												) : (
													<>
														<div className="set-row-info">
															<div className="set-row-name" title={p}>
																{p}
															</div>
														</div>
														<div className="set-row-actions">
															<button
																type="button"
																className="set-icon-btn"
																title={t("quickPhrasesEdit")}
																onClick={() => setQuickEdit({ index: i, value: p })}
															>
																<FiEdit3 />
															</button>
															<button
																type="button"
																className="set-icon-btn"
																title={t("quickPhrasesMoveUp")}
																disabled={i === 0}
																onClick={() => {
																	const next = [...settings.quickPhrases];
																	[next[i - 1], next[i]] = [next[i], next[i - 1]];
																	setPartial({ quickPhrases: next });
																}}
															>
																↑
															</button>
															<button
																type="button"
																className="set-icon-btn"
																title={t("quickPhrasesMoveDown")}
																disabled={i === settings.quickPhrases.length - 1}
																onClick={() => {
																	const next = [...settings.quickPhrases];
																	[next[i], next[i + 1]] = [next[i + 1], next[i]];
																	setPartial({ quickPhrases: next });
																}}
															>
																↓
															</button>
															<button
																type="button"
																className="set-icon-btn danger"
																title={t("quickPhrasesDelete")}
																onClick={() =>
																	setPartial({ quickPhrases: settings.quickPhrases.filter((_, j) => j !== i) })
																}
															>
																<FiTrash2 />
															</button>
														</div>
													</>
												)}
											</div>
										))}
									</div>
								)}
								<div className="compose-toolbar">
									<button
										type="button"
										className="dd-refresh"
										onClick={() => {
											setQuickEdit(null);
											setPartial({ quickPhrases: QUICK_PHRASE_DEFAULTS[locale] ?? QUICK_PHRASE_DEFAULTS.en });
										}}
									>
										{t("quickPhrasesReset")}
									</button>
								</div>
							</div>
						)}

						{/* ---- skills --------------------------------------------------- */}
						{tab === "skills" && (
							<SkillsPanel
								settings={settings}
								onPatch={setPartial}
								presetWarning={
									piPresetFiltering && !presetShowsSkillCatalog(piPresetId ?? undefined)
										? t("skillsHiddenByPreset", { name: piPresetName })
										: undefined
								}
							/>
						)}

						{/* ---- extensions ------------------------------------------------ */}
						{tab === "extensions" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiPackage className="set-section-icon" />
									{t("settingsExtensions")}
									<span className="set-count">{settings.extensions.length}</span>
								</div>
								{settings.extensions.length === 0 ? (
									<p className="set-empty">{t("noExtensions")}</p>
								) : (
									<div className="set-list">
										{settings.extensions.map((e) => {
											const pkgName = e.id.startsWith("npm:") ? e.id.slice(4) : null;
											return (
												<ToggleRow
													key={e.id}
													title={e.name}
													subtitle={e.path}
													enabled={e.enabled}
													onToggle={() => toggleExtension(e)}
													action={
														pkgName ? (
															confirmUninstall === e.id ? (
																<button
																	type="button"
																	className="set-uninstall confirm"
																	title={t("uninstallConfirmHint")}
																	onClick={() => runUninstall(pkgName)}
																>
																	{t("uninstallConfirm")}
																</button>
															) : (
																<button
																	type="button"
																	className="set-uninstall"
																	title={t("uninstallHint")}
																	onClick={() => setConfirmUninstall(e.id)}
																>
																	<FiTrash2 />
																	{t("uninstallExt")}
																</button>
															)
														) : undefined
													}
												/>
											);
										})}
									</div>
								)}
							</div>
						)}

						{/* 插件目录授权（issue #146）：插件访问工作区外目录要经用户确认，
						    这里列出已授权目录并支持逐条撤销（插件自己也能 requestAccess）。 */}
						{/* ---- 浏览器操作（page-picker / browser_page 工具，原顶栏芯片 + 弹窗）--- */}
						{tab === "plugins" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiMonitor className="set-section-icon" />
									{t("browserControl")}
								</div>
								<BrowserControlSettings />
							</div>
						)}

						{/* ---- 插件视图（原顶栏「插件」菜单的入口，菜单已删）------------- */}
						{tab === "plugins" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiBox className="set-section-icon" />
									{t("pluginViewsTitle")}
									<span className="set-count">{pluginViewList.length}</span>
								</div>
								<div className="set-note">{t("pluginViewsHint")}</div>
								{pluginViewList.length === 0 ? (
									<p className="set-empty">{t("pluginViewsEmpty")}</p>
								) : (
									<div className="set-list">
										{pluginViewList.map((p) => (
											<div key={p.id} className="set-row">
												<div className="set-row-info">
													<div className="set-row-name">{p.name}</div>
													<div className="set-row-desc">
														{p.id}
														{p.error ? ` · ${p.error}` : ""}
													</div>
												</div>
												<button
													type="button"
													className="btn"
													disabled={Boolean(p.error)}
													onClick={() => onOpenPluginView(p.id)}
												>
													{t("pluginViewOpen")}
												</button>
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{tab === "plugins" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiFolder className="set-section-icon" />
									{t("pluginGrantsTitle")}
									<span className="set-count">{chat.pluginGrants.reduce((n, g) => n + g.paths.length, 0)}</span>
								</div>
								<div className="set-note">{t("pluginGrantsHint")}</div>
								{chat.pluginGrants.length === 0 ? (
									<p className="set-empty">{t("pluginGrantsEmpty")}</p>
								) : (
									<div className="set-list">
										{chat.pluginGrants.map((g) => (
											<div key={g.pluginId} className="set-grant-row">
												<div className="set-catalog-title">
													<span>{g.pluginId}</span>
												</div>
												{g.paths.map((p) => (
													<div key={p} className="set-grant-path">
														<span className="set-catalog-source">{p}</span>
														<button
															type="button"
															className="set-uninstall"
															onClick={() => appSend({ type: "plugin_path_revoke", pluginId: g.pluginId, path: p })}
														>
															{t("pluginGrantsRevoke")}
														</button>
													</div>
												))}
											</div>
										))}
									</div>
								)}
							</div>
						)}
						{tab === "plugins" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiKey className="set-section-icon" />
									{t("pluginPermsTitle")}
									<span className="set-count">{(chat.pluginPermissions ?? []).length}</span>
								</div>
								<div className="set-note">{t("pluginPermsHint")}</div>
								{(chat.pluginPermissions ?? []).length === 0 ? (
									<p className="set-empty">{t("pluginPermsEmpty")}</p>
								) : (
									<div className="set-list">
										{(chat.pluginPermissions ?? []).map((g, i) => (
											<div key={`${g.pluginId}|${g.family}|${i}`} className="set-grant-row">
												<div className="set-catalog-title">
													<span>{g.pluginId}</span>
													<span className="set-catalog-source">
														{g.family === "net" ? t("pluginPermNet") : t("pluginPermLlm")}
														{g.session ? ` · ${t("pluginPermSession")}` : ""}
													</span>
												</div>
												{(g.hosts ?? []).map((h) => (
													<div key={h} className="set-grant-path">
														<span className="set-catalog-source">{h}</span>
														<button
															type="button"
															className="set-uninstall"
															onClick={() =>
																appSend({
																	type: "plugin_permission_revoke",
																	pluginId: g.pluginId,
																	family: "net",
																	host: h,
																})
															}
														>
															{t("pluginGrantsRevoke")}
														</button>
													</div>
												))}
												{(g.models ?? []).map((m) => (
													<div key={m} className="set-grant-path">
														<span className="set-catalog-source">{m}</span>
														<button
															type="button"
															className="set-uninstall"
															onClick={() =>
																appSend({
																	type: "plugin_permission_revoke",
																	pluginId: g.pluginId,
																	family: "llm",
																	model: m,
																})
															}
														>
															{t("pluginGrantsRevoke")}
														</button>
													</div>
												))}
												{!(g.hosts ?? []).length && !(g.models ?? []).length && (
													<div className="set-grant-path">
														<span className="set-catalog-source">{g.reason ?? t("pluginPermUnscoped")}</span>
														<button
															type="button"
															className="set-uninstall"
															onClick={() =>
																appSend({ type: "plugin_permission_revoke", pluginId: g.pluginId, family: g.family })
															}
														>
															{t("pluginGrantsRevoke")}
														</button>
													</div>
												)}
												{g.reason && ((g.hosts ?? []).length > 0 || (g.models ?? []).length > 0) && (
													<div className="set-note">{g.reason}</div>
												)}
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{/* ---- UI plugins（<dataDir>/plugins，纯 UI 隐藏） ----------------- */}
						{tab === "plugins" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiBox className="set-section-icon" />
									{t("pluginListTab")}
									<span className="set-count">{chat.plugins.length}</span>
									<button
										type="button"
										className="set-uninstall"
										title={t("pluginRescanHint")}
										onClick={() => appSend({ type: "plugins_reload" })}
									>
										<FiRefreshCw />
										{t("pluginRescan")}
									</button>
								</div>
								{chat.plugins.length > 0 && (
									<PluginInventoryStrip plugins={chat.plugins} disabledIds={disabledPlugins} />
								)}
								{chat.plugins.length === 0 ? (
									<p className="set-empty">{t("noUiPlugins")}</p>
								) : (
									<div className="set-list set-list-flat">
										{chat.plugins.map((p) => (
											<Fragment key={p.id}>
												<ToggleRow
													key={p.id}
													title={
														<>
															<InvDot
																phase={pluginPhase(p, disabledPlugins.has(p.id))}
																label={tt(phaseLabelKey(pluginPhase(p, disabledPlugins.has(p.id))))}
															/>
															<PluginIcon icon={p.icon} iconSvg={p.iconSvg} /> {p.name}
														</>
													}
													subtitle={
														(p.error
															? `${p.id} · ${p.error}`
															: p.source
																? `${p.id} · ${p.source}`
																: `${p.id} · ${t("uiPluginNoSource")}`) +
														(p.permissions?.length ? ` · ${t("uiPluginPerms")}: ${p.permissions.join(", ")}` : "")
													}
													enabled={!disabledPlugins.has(p.id) && !p.error}
													onToggle={() => !p.error && togglePlugin(p)}
												/>
												{/* 注册的 AI 工具开关统一收口到「工具」tab 汇总区，这里只保留一行入口（免得已装列表太长；DSH 无工具 tab 则不显示） */}
												{p.agentTools && p.agentTools.length > 0 && (
													<div className="set-row" title={t("pluginToolOffHint")}>
														<span className="set-ui-source">
															{t("pluginToolsSection")} ({p.agentTools.length})
															{p.agentTools.some((tool) => disabledPluginTools.has(tool.name))
																? ` · ${t("settingsDisabled")}`
																: ""}
														</span>
														<div className="set-row-actions">
															<button type="button" className="set-uninstall" onClick={() => setTab("tools")}>
																{t("settingsTools")} →
															</button>
														</div>
													</div>
												)}
												{/* 特权 DOM：声明了 dom 能力的插件，bundle 默认 403，需用户逐个授权 */}
												{p.wantsDom && (
													<div className="set-row" title={t("pluginDomDesc")}>
														<span className="set-ui-source">
															{p.domGranted ? t("pluginDomGranted") : t("pluginDomNeed")}
														</span>
														<div className="set-row-actions">
															<button
																type="button"
																className={`set-uninstall${p.domGranted ? "" : " confirm"}`}
																title={t("pluginDomDesc")}
																onClick={() =>
																	appSend({
																		type: "plugin_dom_consent",
																		pluginId: p.id,
																		granted: !p.domGranted,
																	})
																}
															>
																{p.domGranted ? t("pluginDomRevoke") : t("pluginDomGrant")}
															</button>
														</div>
													</div>
												)}
												{/* 声明式设置：manifest settings schema → 自动渲染表单（可折叠，默认折叠） */}
												{p.settingsSchema && p.settingsSchema.length > 0 && (
													<div className="set-row set-settings-row">
														<button
															type="button"
															className="set-diag-toggle"
															onClick={() => setSettingsOpen((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
														>
															<FiSliders />
															{t("pluginSettingsTitle")} ({p.settingsSchema.length}) ·{" "}
															{settingsOpen[p.id] ? t("pluginSettingsHide") : t("pluginSettingsShow")}
														</button>
														{settingsOpen[p.id] && (
															<PluginSettingsForm plugin={p} models={settings?.subagentModels ?? []} />
														)}
													</div>
												)}
											</Fragment>
										))}
									</div>
								)}
							</div>
						)}

						{/* ---- goal review ----------------------------------------------- */}
						{tab === "review" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiZap className="set-section-icon" />
									{t("settingsReview")}
									<HintTip text={t("settingsReviewDesc")} />
									<span className="set-count">{settings.reviewSkills.length}</span>
								</div>
								<ToggleRow
									title={t("goalModeEnabled")}
									tip={`${t("goalModeEnabledDesc")}\n${t("goalModeOffHint")}`}
									enabled={settings.goalModeEnabled}
									onToggle={() => setPartial({ goalModeEnabled: !settings.goalModeEnabled })}
								/>
								<textarea
									className="set-prompt-input"
									rows={5}
									placeholder={t("reviewPromptPlaceholder")}
									value={reviewPromptDraft}
									onFocus={() => (reviewPromptFocus.current = true)}
									onBlur={() => {
										reviewPromptFocus.current = false;
										setPartial({ reviewPrompt: reviewPromptDraft });
									}}
									onChange={(e) => setReviewPromptDraft(e.target.value)}
								/>
								<div className="set-field-label">{t("settingsReviewSkills")}</div>
								{settings.reviewSkills.length === 0 ? (
									<p className="set-empty">{t("noSkills")}</p>
								) : (
									<div className="set-list">
										{settings.reviewSkills.map((s) => (
											<ToggleRow
												key={`review-${s.name}`}
												title={s.name}
												subtitle={s.description}
												enabled={s.enabled}
												onToggle={() => toggleReviewSkill(s)}
											/>
										))}
									</div>
								)}
							</div>
						)}

						{/* ---- vision bridge ---------------------------------------------- */}
						{tab === "vision" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiEye className="set-section-icon" />
									{t("settingsVisionBridge")}
								</div>
								<ToggleRow
									title={t("visionBridgeEnabled")}
									tip={`${t("settingsVisionBridgeDesc")}\n${t("visionBridgeOffHint")}`}
									enabled={settings.visionBridgeEnabled}
									onToggle={() => setPartial({ visionBridgeEnabled: !settings.visionBridgeEnabled })}
								/>
								{settings.visionBridgeEnabled && (
									<FieldRow label={t("visionBridgeModel")}>
										<select
											className="set-select"
											value={settings.visionBridgeModel ?? ""}
											onChange={(e) => setPartial({ visionBridgeModel: e.target.value || null })}
										>
											<option value="">{t("visionBridgeAuto")}</option>
											{settings.visionModels.map((m) => (
												<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
													{m.label}
												</option>
											))}
										</select>
									</FieldRow>
								)}
								{settings.visionBridgeEnabled && (
									<FieldRow label={t("visionBridgePromptMode")}>
										<select
											className="set-select"
											value={vbPromptMode}
											onChange={(e) => {
												const mode = e.target.value as "append" | "replace";
												setVbPromptMode(mode);
												setPartial({ visionBridgePromptMode: mode });
											}}
										>
											<option value="append">{t("promptModeAppend")}</option>
											<option value="replace">{t("promptModeReplace")}</option>
										</select>
									</FieldRow>
								)}
								{settings.visionBridgeEnabled && (
									<textarea
										className="set-prompt-input"
										rows={4}
										placeholder={t("visionBridgePromptPlaceholder")}
										value={vbPromptDraft}
										onFocus={() => (vbPromptFocus.current = true)}
										onBlur={() => {
											vbPromptFocus.current = false;
											// Same contract as the system prompt: an unmodified copy of
											// the built-in default is stored as empty (use default).
											const text =
												vbPromptMode === "replace" &&
												settings.visionBridgeDefaultPrompt &&
												vbPromptDraft === settings.visionBridgeDefaultPrompt
													? ""
													: vbPromptDraft;
											setPartial({
												visionBridgePromptMode: vbPromptMode,
												visionBridgePrompt: text,
											});
										}}
										onChange={(e) => setVbPromptDraft(e.target.value)}
									/>
								)}
								{settings.visionBridgeEnabled &&
									(settings.visionModels.length === 0 ? (
										<p className="set-hint">{t("visionBridgeNoModels")}</p>
									) : (
										<p className="set-hint">
											{t("visionBridgeCurrent", {
												model: settings.visionBridgeModel ?? t("visionBridgeAuto"),
											})}
										</p>
									))}
							</div>
						)}

						{tab === "presets" && chat.agentPresets && chat.agentPresets.presets.length > 0 && (
							<div className="set-section">
								<div className="set-section-title">
									<FiCpu className="set-section-icon" />
									{t("agentPreset")}
									<HintTip text={t("dshDefaultPresetDesc")} />
									<span className="set-count">{chat.agentPresets.presets.length}</span>
								</div>
								<div className="set-mode-row">
									<label className="set-field-label">{t("dshDefaultPreset")}</label>
									<select
										className="set-select"
										value={chat.agentPresets.defaultPreset}
										onChange={(e) => appSend({ type: "agent_preset_default", preset: e.target.value })}
									>
										{sortAgentPresets(chat.agentPresets.presets).map((p) => (
											<option key={p.id} value={p.id} disabled={!!p.broken}>
												{p.name ?? p.id}
												{p.trust === "user" ? ` · ${t("agentPresetUser")}` : ""}
											</option>
										))}
									</select>
								</div>
								<div className="set-list">
									{sortAgentPresets(chat.agentPresets.presets).map((p) => (
										<div className="set-row" key={p.id}>
											<div className="set-row-info">
												<div className="set-row-name">
													{p.name ?? p.id}
													{p.trust === "user" && <span className="dd-preset-tag">{t("agentPresetUser")}</span>}
													{p.id === chat.agentPresets!.defaultPreset && (
														<span className="dd-preset-tag">{t("agentPresetDefaultTag")}</span>
													)}
													{p.broken && <span className="dd-preset-tag warn">{t("agentPresetBroken")}</span>}
												</div>
												{p.description && !p.broken && <div className="set-row-desc">{p.description}</div>}
												{p.broken && <div className="set-row-desc">{p.broken}</div>}
											</div>
										</div>
									))}
								</div>
								<p className="set-hint">{t("agentPresetUserNote")}</p>
							</div>
						)}
						{tab === "presets" && chat.permissionPresets && chat.permissionPresets.options.length > 0 && (
							<div className="set-section">
								<div className="set-section-title">
									<FiShield className="set-section-icon" />
									{t("permMode")}
									<HintTip text={t("permDefaultDesc")} />
								</div>
								<div className="set-mode-row">
									<label className="set-field-label">{t("permDefault")}</label>
									<select
										className="set-select"
										value={chat.permissionPresets.defaultPreset}
										onChange={(e) => appSend({ type: "permission_default", preset: e.target.value })}
									>
										{PERMISSION_ORDER.filter((v) => chat.permissionPresets!.options.some((o) => o.value === v)).map(
											(v) => (
												<option key={v} value={v}>
													{t(permLabelKey(v))}
												</option>
											),
										)}
									</select>
								</div>
								<div className="set-list">
									{PERMISSION_ORDER.filter((v) => chat.permissionPresets!.options.some((o) => o.value === v)).map(
										(v) => (
											<div className="set-row" key={v}>
												<div className="set-row-info">
													<div className="set-row-name">
														{t(permLabelKey(v))}
														{v === chat.permissionPresets!.defaultPreset && (
															<span className="dd-preset-tag">{t("agentPresetDefaultTag")}</span>
														)}
													</div>
													<div className="set-row-desc">{t(permDescKey(v))}</div>
												</div>
											</div>
										),
									)}
								</div>
							</div>
						)}
						{tab === "presets" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiSettings className="set-section-icon" />
									{t("settingsPresets")}
									<span className="set-count">{settings.presets.length}</span>
								</div>
								<div className="set-preset-save">
									<input
										className="set-input"
										placeholder={t("presetNamePlaceholder")}
										value={presetName}
										onChange={(e) => setPresetName(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && presetName.trim()) {
												appSend({ type: "save_preset", name: presetName.trim() });
												setPresetName("");
											}
										}}
									/>
									<button
										type="button"
										className="set-save-btn"
										disabled={!presetName.trim()}
										onClick={() => {
											appSend({ type: "save_preset", name: presetName.trim() });
											setPresetName("");
										}}
									>
										<FiPlus /> {t("saveAsPreset")}
									</button>
								</div>
								{settings.presets.length === 0 ? (
									<p className="set-empty">{t("noPresets")}</p>
								) : (
									<div className="set-list">
										{settings.presets.map((p) => (
											<div className="set-row" key={p.name}>
												<div className="set-row-info">
													<div className="set-row-name">{p.name}</div>
													<div className="set-row-desc">
														{p.promptMode === "replace" ? t("promptModeReplace") : t("promptModeAppend")}
														{p.disabledSkills.length > 0 && ` · ${t("settingsSkills")} ${p.disabledSkills.length}`}
														{p.disabledExtensions.length > 0 &&
															` · ${t("settingsExtensions")} ${p.disabledExtensions.length}`}
													</div>
												</div>
												<div className="set-row-actions">
													<button
														type="button"
														className="set-uninstall"
														onClick={() => appSend({ type: "apply_preset", name: p.name })}
													>
														{t("applyPreset")}
													</button>
													<button
														type="button"
														className="set-icon-btn danger"
														title={t("deletePreset")}
														onClick={() => appSend({ type: "delete_preset", name: p.name })}
													>
														<FiTrash2 />
													</button>
												</div>
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{/* ---- subagent templates（全局共享；DSH 引擎隐藏该分区） ---------- */}
						{tab === "subagent-templates" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiUsers className="set-section-icon" />
									{t("settingsSubagentTemplates")}
									<HintTip text={t("settingsSubagentTemplatesDesc")} />
									<span className="set-count">{settings.subagentTemplates.length}</span>
									<button
										type="button"
										className="set-save-btn"
										title={t("subagentTemplateNew")}
										onClick={() => {
											setTplDraft({
												name: "",
												description: "",
												promptMode: "replace",
												systemPrompt: "",
												enabledSkills: [],
												enabledExtensions: [],
												model: "",
												thinkingLevel: "",
												enabled: true,
											});
											setTplIsNew(true);
										}}
									>
										<FiPlus /> {t("subagentTemplateNew")}
									</button>
								</div>

								{/* ---- 默认模型：全部子代理的兜底（模板/显式 model 参数优先） ---------- */}
								<FieldRow label={t("subagentDefaultModelLabel")} tip={t("subagentDefaultModelHint")}>
									<select
										className="set-select"
										value={settings.subagentDefaultModel ?? ""}
										onChange={(e) => setPartial({ subagentDefaultModel: e.target.value || null })}
									>
										<option value="">{t("subagentFollowMain")}</option>
										{settings.subagentModels.map((m) => (
											<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
												{m.label}
											</option>
										))}
									</select>
								</FieldRow>
								{settings.subagentModels.length === 0 && <p className="set-hint">{t("subagentNoModels")}</p>}

								{/* ---- 编辑器：独立弹窗（新建 / 编辑同表单，列表页保持干净） ---------- */}
								{tplDraft && (
									<div className="modal-backdrop tpl-modal-backdrop" onClick={() => setTplDraft(null)}>
										<div className="modal tpl-modal" onClick={(e) => e.stopPropagation()}>
											<button
												type="button"
												className="modal-close"
												aria-label={t("close")}
												onClick={() => setTplDraft(null)}
											>
												<FiX />
											</button>
											<div className="modal-head">
												<FiUsers className="modal-head-icon" />
												<h2>
													{tplIsNew ? t("subagentTemplateNew") : `${t("subagentTemplateEdit")} · ${tplDraft.name}`}
												</h2>
											</div>
											<div className="modal-body">
												<div className="tpl-fields">
													<input
														className="set-input"
														placeholder={t("tplNamePlaceholder")}
														value={tplDraft.name}
														onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })}
													/>
													<input
														className="set-input"
														placeholder={t("tplDescriptionPlaceholder")}
														value={tplDraft.description}
														onChange={(e) => setTplDraft({ ...tplDraft, description: e.target.value })}
													/>
													<input
														className="set-input"
														placeholder={t("tplDescriptionEnPlaceholder")}
														value={tplDraft.descriptionEn ?? ""}
														onChange={(e) => setTplDraft({ ...tplDraft, descriptionEn: e.target.value })}
													/>
												</div>
												<div className="set-mode-row">
													<label className="set-field-label">{t("tplPromptModeLabel")}</label>
													<select
														className="set-select"
														value={tplDraft.promptMode}
														onChange={(e) =>
															setTplDraft({ ...tplDraft, promptMode: e.target.value as "append" | "replace" })
														}
													>
														<option value="replace">{t("promptModeReplace")}</option>
														<option value="append">{t("promptModeAppend")}</option>
													</select>
												</div>
												<div className="set-mode-row">
													<label className="set-field-label">{t("tplModelLabel")}</label>
													<select
														className="set-select"
														value={tplDraft.model ?? ""}
														onChange={(e) => setTplDraft({ ...tplDraft, model: e.target.value })}
													>
														<option value="">{t("subagentFollowMain")}</option>
														{settings.subagentModels.map((m) => (
															<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
																{m.label}
															</option>
														))}
													</select>
												</div>
												<div className="set-mode-row">
													<label className="set-field-label">
														{t("tplThinkingLabel")} <HintTip text={t("tplThinkingHint")} />
													</label>
													<select
														className="set-select"
														value={tplDraft.thinkingLevel ?? ""}
														onChange={(e) => setTplDraft({ ...tplDraft, thinkingLevel: e.target.value })}
													>
														<option value="">{t("tplThinkingFollowMain")}</option>
														{THINKING_VALUES.map((v) => (
															<option key={v} value={v}>
																{t(`thinking.${v}`)}
															</option>
														))}
													</select>
												</div>
												<textarea
													className="set-prompt-input"
													rows={4}
													placeholder={`${t("tplSystemPromptLabel")}${locale === "zh" ? "：" : ": "}${t(
														"tplSystemPromptPlaceholder",
													)}`}
													value={tplDraft.systemPrompt}
													onChange={(e) => setTplDraft({ ...tplDraft, systemPrompt: e.target.value })}
												/>
												<textarea
													className="set-prompt-input"
													rows={4}
													placeholder={`${t("tplSystemPromptLabel")}: ${t("tplSystemPromptEnPlaceholder")}`}
													value={tplDraft.systemPromptEn ?? ""}
													onChange={(e) => setTplDraft({ ...tplDraft, systemPromptEn: e.target.value })}
												/>
												<div className="tpl-pick-block">
													<div className="tpl-pick-head">
														<span>
															{t("tplSkillsLabel")} · {t("tplWhitelistHint")}
														</span>
													</div>
													{settings.skills.length === 0 ? (
														<p className="set-hint">{t("noSkills")}</p>
													) : (
														<div className="tpl-pick">
															{settings.skills.map((s) => (
																<label
																	key={s.name}
																	className={`tpl-chip${tplDraft.enabledSkills.includes(s.name) ? " on" : ""}`}
																>
																	<input
																		type="checkbox"
																		checked={tplDraft.enabledSkills.includes(s.name)}
																		onChange={(e) => {
																			const on = e.target.checked;
																			setTplDraft({
																				...tplDraft,
																				enabledSkills: on
																					? [...tplDraft.enabledSkills, s.name]
																					: tplDraft.enabledSkills.filter((n) => n !== s.name),
																			});
																		}}
																	/>
																	{s.name}
																</label>
															))}
														</div>
													)}
												</div>
												<div className="tpl-pick-block">
													<div className="tpl-pick-head">
														<span>
															{t("tplExtensionsLabel")} · {t("tplWhitelistHint")}
														</span>
													</div>
													{settings.extensions.length === 0 ? (
														<p className="set-hint">{t("noExtensions")}</p>
													) : (
														<div className="tpl-pick">
															{settings.extensions.map((x) => (
																<label
																	key={x.id}
																	className={`tpl-chip${tplDraft.enabledExtensions.includes(x.id) ? " on" : ""}`}
																>
																	<input
																		type="checkbox"
																		checked={tplDraft.enabledExtensions.includes(x.id)}
																		onChange={(e) => {
																			const on = e.target.checked;
																			setTplDraft({
																				...tplDraft,
																				enabledExtensions: on
																					? [...tplDraft.enabledExtensions, x.id]
																					: tplDraft.enabledExtensions.filter((id) => id !== x.id),
																			});
																		}}
																	/>
																	{x.name}
																</label>
															))}
														</div>
													)}
												</div>
											</div>
											<div className="modal-actions">
												<button
													type="button"
													className="set-save-btn"
													disabled={!tplDraft.name.trim()}
													onClick={() => {
														appSend({
															type: "save_subagent_template",
															template: { ...tplDraft, name: tplDraft.name.trim() },
														});
														setTplDraft(null);
													}}
												>
													{t("tplSave")}
												</button>
												<button type="button" className="dd-refresh" onClick={() => setTplDraft(null)}>
													{t("tplCancel")}
												</button>
											</div>
										</div>
									</div>
								)}

								{/* ---- 模板列表 ------------------------------------------------ */}
								{settings.subagentTemplates.length === 0 ? (
									<p className="set-empty">{t("noSubagentTemplates")}</p>
								) : (
									<div className="set-list set-list-flat">
										{settings.subagentTemplates.map((tp) => (
											<div className="set-row" key={tp.name}>
												<div className="set-row-info">
													<div className="set-row-name">
														{tp.name}
														{settings.subagentDefaultTemplates.includes(tp.name) && (
															<span className="tpl-badge default">{t("tplDefaultBadge")}</span>
														)}
														{!tp.enabled && <span className="tpl-badge">{t("subagentTemplateClosed")}</span>}
													</div>
													<div className="set-row-desc">
														{(locale !== "zh" && tp.descriptionEn ? tp.descriptionEn : tp.description) ||
															`${tp.promptMode === "replace" ? t("promptModeReplace") : t("promptModeAppend")}`}
														{tp.model ? ` · ${t("tplModelLabel")} ${tp.model}` : ` · ${t("subagentFollowMain")}`}
														{tp.thinkingLevel
															? ` · ${t("tplThinkingLabel")} ${tt(`thinking.${tp.thinkingLevel}`)}`
															: ""}
														{tp.enabledSkills.length > 0 && ` · ${t("tplSkillsLabel")} ${tp.enabledSkills.length}`}
														{tp.enabledExtensions.length > 0 &&
															` · ${t("tplExtensionsLabel")} ${tp.enabledExtensions.length}`}
														{!tp.description &&
															tp.enabledSkills.length === 0 &&
															tp.enabledExtensions.length === 0 &&
															` · ${t("tplInherit")}`}
													</div>
												</div>
												<div className="set-row-actions">
													<button
														type="button"
														className={`set-switch${tp.enabled ? " on" : ""}`}
														role="switch"
														aria-checked={tp.enabled}
														title={`${tp.enabled ? t("subagentTemplateDisable") : t("subagentTemplateEnable")} · ${t(
															"subagentTemplateOffHint",
														)}`}
														onClick={() =>
															appSend({ type: "save_subagent_template", template: { ...tp, enabled: !tp.enabled } })
														}
													>
														<span className="set-switch-knob" />
													</button>
													<button
														type="button"
														className="set-uninstall"
														title={t("subagentTemplateEdit")}
														onClick={() => {
															setTplDraft({ ...tp });
															setTplIsNew(false);
														}}
													>
														{t("subagentTemplateEdit")}
													</button>
													{confirmTplDelete === tp.name ? (
														<button
															type="button"
															className="set-uninstall confirm"
															title={t("uninstallConfirmHint")}
															onClick={() => {
																appSend({ type: "delete_subagent_template", name: tp.name });
																setConfirmTplDelete(null);
															}}
														>
															{t("uninstallConfirm")}
														</button>
													) : (
														<button
															type="button"
															className="set-icon-btn danger"
															title={t("tplDelete")}
															onClick={() => setConfirmTplDelete(tp.name)}
														>
															<FiTrash2 />
														</button>
													)}
												</div>
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{/* ---- approval rules（全局共享；DSH 引擎隐藏该分区） ---------- */}
						{tab === "approval-rules" && (
							<div className="set-section">
								<div className="set-section-title">
									<FiShield className="set-section-icon" />
									{t("settingsApprovalRules")}
									<HintTip text={t("settingsApprovalRulesDesc")} />
									<span className="set-count">{settings.approvalRules?.length ?? 0}</span>
									<button
										type="button"
										className="set-save-btn"
										title={t("approvalRuleNew")}
										onClick={() => {
											setRuleDraft({
												id: `custom.${randomUuid().slice(0, 8)}`,
												enabled: true,
												tools: ["bash"],
												field: "command",
												match: "regex",
												value: "",
												action: "ask",
												label: "",
												labelEn: "",
												reason: "",
												reasonEn: "",
											});
											setRuleToolsText("bash");
											setRuleIsNew(true);
											setRuleError(null);
										}}
									>
										<FiPlus /> {t("approvalRuleNew")}
									</button>
								</div>

								{/* ---- 编辑 / 新建表单 ---------- */}
								{ruleDraft && (
									<div className="rule-editor">
										<div className="set-section-title" style={{ fontSize: 13, marginBottom: 4 }}>
											{ruleIsNew ? t("approvalRuleNew") : `${t("approvalRuleEdit")} · ${ruleDraft.label}`}
										</div>
										<FieldRow label={t("approvalRuleLabel")}>
											<input
												className="set-input"
												value={ruleDraft.label}
												placeholder="例如：拦截 Docker 危险操作"
												onChange={(e) => setRuleDraft({ ...ruleDraft, label: e.target.value })}
											/>
										</FieldRow>
										<FieldRow label={t("approvalRuleTools")} tip={t("approvalRuleToolsTip")}>
											<input
												className="set-input"
												value={ruleToolsText}
												placeholder="bash, write, edit (或 * 通配)"
												onChange={(e) => {
													setRuleToolsText(e.target.value);
													const arr = e.target.value
														.split(",")
														.map((x) => x.trim().toLowerCase())
														.filter(Boolean);
													setRuleDraft({ ...ruleDraft, tools: arr.length > 0 ? arr : ["*"] });
												}}
											/>
										</FieldRow>
										<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
											<div style={{ flex: 1, minWidth: 160 }}>
												<FieldRow label={t("approvalRuleField")}>
													<select
														className="set-select"
														value={ruleDraft.field}
														onChange={(e) =>
															setRuleDraft({
																...ruleDraft,
																field: e.target.value as "command" | "path" | "params",
															})
														}
													>
														<option value="command">{t("approvalRuleFieldCommand")}</option>
														<option value="path">{t("approvalRuleFieldPath")}</option>
														<option value="params">{t("approvalRuleFieldParams")}</option>
													</select>
												</FieldRow>
											</div>
											<div style={{ flex: 1, minWidth: 160 }}>
												<FieldRow label={t("approvalRuleMatch")}>
													<select
														className="set-select"
														value={ruleDraft.match}
														onChange={(e) =>
															setRuleDraft({
																...ruleDraft,
																match: e.target.value as "regex" | "glob" | "contains" | "prefix" | "outside_workspace",
															})
														}
													>
														<option value="regex">{t("approvalRuleMatchRegex")}</option>
														<option value="glob">{t("approvalRuleMatchGlob")}</option>
														<option value="contains">{t("approvalRuleMatchContains")}</option>
														<option value="prefix">{t("approvalRuleMatchPrefix")}</option>
														<option value="outside_workspace">{t("approvalRuleMatchOutsideWs")}</option>
													</select>
												</FieldRow>
											</div>
											<div style={{ flex: 1, minWidth: 160 }}>
												<FieldRow label="命中动作">
													<select
														className="set-select"
														value={ruleDraft.action}
														onChange={(e) =>
															setRuleDraft({
																...ruleDraft,
																action: e.target.value as "ask" | "deny" | "allow",
															})
														}
													>
														<option value="ask">{t("approvalRuleActionAsk")}</option>
														<option value="deny">{t("approvalRuleActionDeny")}</option>
														<option value="allow">{t("approvalRuleActionAllow")}</option>
													</select>
												</FieldRow>
											</div>
										</div>
										{ruleDraft.match !== "outside_workspace" && (
											<FieldRow label={t("approvalRuleValue")} tip={t("approvalRuleValueTip")}>
												<input
													className="set-input"
													value={ruleDraft.value}
													placeholder="匹配表达式或关键字…"
													onChange={(e) => setRuleDraft({ ...ruleDraft, value: e.target.value })}
												/>
											</FieldRow>
										)}
										<FieldRow label={t("approvalRuleReason")}>
											<input
												className="set-input"
												value={ruleDraft.reason ?? ""}
												placeholder="例如：检测到删除镜像或容器操作"
												onChange={(e) => setRuleDraft({ ...ruleDraft, reason: e.target.value })}
											/>
										</FieldRow>
										<div className="set-row">
											<label
												className="set-checkbox-label"
												style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
											>
												<input
													type="checkbox"
													checked={ruleDraft.enabled}
													onChange={(e) => setRuleDraft({ ...ruleDraft, enabled: e.target.checked })}
												/>
												{t("approvalRuleEnabled")}
											</label>
										</div>
										{ruleError && <div style={{ color: "var(--red, #ef4444)", fontSize: 12 }}>{ruleError}</div>}
										<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
											<button
												type="button"
												className="btn"
												onClick={() => {
													setRuleDraft(null);
													setRuleError(null);
												}}
											>
												{t("cancel")}
											</button>
											<button
												type="button"
												className="btn btn-primary"
												onClick={() => {
													if (!ruleDraft.label.trim()) {
														setRuleError("请填写规则名称");
														return;
													}
													if (ruleDraft.match === "regex") {
														try {
															new RegExp(ruleDraft.value);
														} catch (err) {
															setRuleError(`正则表达式非法：${(err as Error).message}`);
															return;
														}
													}
													appSend({ type: "save_approval_rule", rule: ruleDraft });
													setRuleDraft(null);
													setRuleError(null);
												}}
											>
												{t("save")}
											</button>
										</div>
									</div>
								)}

								{/* ---- 规则列表 ---------- */}
								{(settings.approvalRules ?? []).length === 0 ? (
									<p className="set-hint">{t("approvalRuleEmpty")}</p>
								) : (
									<div className="set-list set-list-flat">
										{(settings.approvalRules ?? []).map((rule, idx) => {
											const isBuiltin = rule.builtin === true;
											return (
												<div
													className={`set-row${rule.enabled ? "" : " rule-row-disabled"}`}
													key={rule.id}
													style={{ alignItems: "flex-start", padding: "12px 0" }}
												>
													<div className="set-row-info">
														<div
															className="set-row-name"
															style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}
														>
															<span className={`rule-badge ${rule.action}`}>
																{rule.action === "deny"
																	? t("approvalRuleActionDeny")
																	: rule.action === "allow"
																		? t("approvalRuleActionAllow")
																		: t("approvalRuleActionAsk")}
															</span>
															<strong style={{ fontSize: 13 }}>
																{locale === "zh" ? rule.label : rule.labelEn || rule.label}
															</strong>
															{isBuiltin && <span className="tpl-badge">{t("approvalRuleBuiltin")}</span>}
															<span className="rule-meta-code">{rule.tools.join(", ")}</span>
														</div>
														<div
															className="set-hint"
															style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}
														>
															<div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
																<span style={{ opacity: 0.85, fontSize: 11, fontFamily: "var(--mono)" }}>
																	[{rule.field} · {rule.match}]
																</span>
																{rule.match !== "outside_workspace" && (
																	<code className="rule-pattern-code">{rule.value}</code>
																)}
															</div>
															{(rule.reason || rule.reasonEn) && (
																<div style={{ opacity: 0.75, fontSize: 11 }}>
																	{locale === "zh" ? rule.reason : rule.reasonEn || rule.reason}
																</div>
															)}
														</div>
													</div>
													<div className="set-row-actions" style={{ marginLeft: 12, flexShrink: 0 }}>
														{/* 启用/停用开关 */}
														<button
															type="button"
															className={`set-switch${rule.enabled ? " on" : ""}`}
															role="switch"
															aria-checked={rule.enabled}
															title={rule.enabled ? t("settingsEnabled") : t("settingsDisabled")}
															onClick={() =>
																appSend({
																	type: "save_approval_rule",
																	rule: { ...rule, enabled: !rule.enabled },
																})
															}
														>
															<span className="set-switch-knob" />
														</button>
														{/* 排序上移下移（自定义规则） */}
														{!isBuiltin && idx > 0 && (
															<button
																type="button"
																className="set-icon-btn"
																title={t("approvalRuleMoveUp")}
																onClick={() => {
																	const list = [...(settings.approvalRules ?? [])];
																	const temp = list[idx - 1];
																	list[idx - 1] = list[idx];
																	list[idx] = temp;
																	appSend({ type: "save_approval_rules", rules: list });
																}}
															>
																<FiChevronUp />
															</button>
														)}
														{!isBuiltin && idx < (settings.approvalRules?.length ?? 0) - 1 && (
															<button
																type="button"
																className="set-icon-btn"
																title={t("approvalRuleMoveDown")}
																onClick={() => {
																	const list = [...(settings.approvalRules ?? [])];
																	const temp = list[idx + 1];
																	list[idx + 1] = list[idx];
																	list[idx] = temp;
																	appSend({ type: "save_approval_rules", rules: list });
																}}
															>
																<FiChevronDown />
															</button>
														)}
														{isBuiltin &&
															(confirmRuleReset === rule.id ? (
																<button
																	type="button"
																	className="set-uninstall confirm"
																	onClick={() => {
																		appSend({ type: "reset_builtin_approval_rule", id: rule.id });
																		setConfirmRuleReset(null);
																	}}
																>
																	{t("uninstallConfirm")}
																</button>
															) : (
																<button
																	type="button"
																	className="set-icon-btn"
																	title={t("approvalRuleReset")}
																	onClick={() => setConfirmRuleReset(rule.id)}
																>
																	<FiRefreshCw />
																</button>
															))}
														<button
															type="button"
															className="set-icon-btn"
															title={t("approvalRuleEdit")}
															onClick={() => {
																setRuleDraft({ ...rule });
																setRuleToolsText(rule.tools.join(", "));
																setRuleIsNew(false);
																setRuleError(null);
															}}
														>
															<FiEdit3 />
														</button>
														{!isBuiltin &&
															(confirmRuleDelete === rule.id ? (
																<button
																	type="button"
																	className="set-uninstall confirm"
																	onClick={() => {
																		appSend({ type: "delete_approval_rule", id: rule.id });
																		setConfirmRuleDelete(null);
																	}}
																>
																	{t("uninstallConfirm")}
																</button>
															) : (
																<button
																	type="button"
																	className="set-icon-btn danger"
																	title={t("approvalRuleDelete")}
																	onClick={() => setConfirmRuleDelete(rule.id)}
																>
																	<FiTrash2 />
																</button>
															))}
													</div>
												</div>
											);
										})}
									</div>
								)}
							</div>
						)}
						{/* ---- 插件自定义页（settings.pages，issue #146） ------------------- */}
						{activePluginPage && (
							<PluginPage
								plugin={activePluginPage.plugin}
								epoch={chat.pluginsEpoch}
								send={appSend}
								className="set-plugin-page"
							/>
						)}
					</div>
				</div>

				<div className="modal-actions">
					<button type="button" className="dd-refresh" onClick={onClose}>
						{t("close")}
					</button>
				</div>
			</div>
		</div>
	);
}
