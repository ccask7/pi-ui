import { Fragment, useState, type ReactNode } from "react";
import {
	FiFolder,
	FiFolderPlus,
	FiGitBranch,
	FiMenu,
	FiMessageSquare,
	FiSearch,
	FiSettings,
	FiLayers,
	FiTerminal,
} from "react-icons/fi";
import type { ChatState } from "../use-chat";
import { PluginIcon } from "../plugin-icon";
import { useI18n } from "../i18n";
import type { UiSlotEntry } from "../ui-slots";
import { openContextMenu } from "../context-menu-state";
import { appSend, useAppField } from "../app-globals";
import { ProjectPicker } from "./ProjectPicker";
import { focusComposer } from "../composer-bridge";

/**
 * 顶栏「⋯」溢出菜单（issue #162）：portal 到 document.body + `position: fixed`。
 *
 * 为什么：菜单的触发按钮坐在横滑容器里 —— 窄屏（≤768px）的 `.topbar-flow{overflow-x:auto}`
 * 会让纵向也变成裁剪（CSS Overflow 3 §3.1：只写一轴 auto，另一轴的 visible 也算 auto）。
 * 菜单往下展开（`top: 100%+6px`）正好落在被裁剪的轴上，`z-index` 再高也逃不出来。
 * 之前 `ContextMenu.tsx` 已经用同一招（portal + fixed + 实测钳制）解决过右键菜单的裁剪，
 * 这里照抄：视口坐标直接取触发按钮的 `getBoundingClientRect()`，先渲染再实测菜单尺寸后钳制。
 *
 * 行为：点外面 / Esc 关闭（与 Dropdown/ContextMenu 一致）；窗口缩放或滚动时重算锚点
 * （移动端横滑顶栏时菜单跟着走，而不是飘在原地）。
 */
interface TopBarProps {
	chat: ChatState;
	view: "chat" | "terminal" | "git" | `plugin:${string}`;
	onViewChange: (view: "chat" | "terminal" | "git" | `plugin:${string}`) => void;
	/** Installed optional plugins (<dataDir>/plugins) — one view tab each
	 *  (view:false renderer-only plugins are filtered out by the caller). */
	plugins: {
		id: string;
		name: string;
		icon?: string;
		iconSvg?: string;
		version?: string;
		description?: string;
		error?: string;
		view?: boolean;
	}[];
	/** 顶栏主栏条目（内置 + 插件的最终结果，已按用户偏好/插件 arrange 排好；由 App 计算）。 */
	uiPrimary?: UiSlotEntry[];
	/** 点击一个条目：view 由宿主切视图，其余（action/select）交给贡献它的插件
	 *  （select 切选项时第二个参数带选中的 value）。 */
	onUiAction?: (item: UiSlotEntry, value?: string) => void;
	/** 顶栏右键菜单的条目（contextmenu.topbar 槽位；插件可往里加项）。 */
	uiContextTopbar?: UiSlotEntry[];
	/** Open a side panel as a mobile drawer ("left" = history, "right" = files). */
	onOpenPanel: (side: "left" | "right") => void;
	/** Open the settings panel (system prompt / skills / extensions / presets). */
	onOpenSettings: () => void;
	/** Open the background-task panel (AI-started servers — stop individually or all). */
	onOpenBgTasks: () => void;
	/** Open the global search panel (sessions / projects / workspace files). */
	onOpenGlobalSearch: () => void;
}

export function TopBar({
	chat,
	view,
	plugins,
	uiPrimary,
	uiContextTopbar,
	onUiAction,
	onViewChange,
	onOpenPanel,
	onOpenSettings,
	onOpenBgTasks,
	onOpenGlobalSearch,
}: TopBarProps) {
	const { t } = useI18n();
	/* 「打开项目」按钮（host:open-project）的项目选择器：与左栏 📁+ 同一个组件、同一套行为
	   （浏览磁盘目录 / 选当前目录 / ＋新建项目后切过去）。cwd 与额外工作区根走全局 store
	   （整棵树都要的值，不再从 App 传参）。 */
	const [projectPickerOpen, setProjectPickerOpen] = useState(false);
	const cwd = useAppField("cwd");
	const workspaceRoots = useAppField("workspaceRoots");
	/* PI_WEB_TABS: an instance can be set up to offer only some tabs — the
	   server refuses the messages of the others anyway (server/tabs.ts), so
	   drawing them would only offer an action that comes back refused. No list
	   means every tab, which is the default. */
	const tabOn = (tab: string) => !chat.tabs || tab === "chat" || chat.tabs.includes(tab);
	/**
	 * 顶栏统一渲染（方案 A：**完全扁平**，桌面与手机同一份 slot 数据）——
	 * 所有条目都是 `.topbar-flow` 的直接子节点，**没有任何按种类包裹的容器**
	 * （不再有 .brand / .view-switch / .topbar-desktop，也不再有两端贴边的例外）：
	 * 宿主条目查 `hostNodes` 节点工厂，插件条目走 `renderPluginEntry` 通用渲染，
	 * align 只决定它落在两个 spacer 划出的三段（start / center / end）里的哪一段。
	 * 可见性/顺序/对齐/文案对**每一个**条目都生效（布局页勾选框、↑↓、align）。
	 *
	 * `uiPrimary` 完全没给（未接线 / 单测）时回退内置默认顺序、全部落 start 区：
	 * 没拿到 slot 数据就把顶栏清空是最糟的降级（与旧版 hostOn 同口径）。
	 */
	const FALLBACK_TOPBAR_IDS = [
		"host:history",
		"host:brand",
		"host:open-project",
		"host:chat",
		"host:terminal",
		"host:git",
		"host:search",
		"host:tasks",
		"host:settings",
		"host:new-ephemeral-chat",
		"host:files",
	];
	const topEntries: { id: string; entry: UiSlotEntry | null }[] =
		uiPrimary !== undefined
			? uiPrimary.map((e) => ({ id: e.id, entry: e }))
			: FALLBACK_TOPBAR_IDS.map((id) => ({ id, entry: null }));
	/** 报错插件的视图 tab：合并引擎整份丢弃了它们的贡献（含合成的 __view 条目），
	 *  但 tab 本体仍要置灰可点（与旧版 plugins-prop 直画一致）—— 以伪条目补回条目流尾部。 */
	const brokenViewEntries: UiSlotEntry[] = (tabOn("plugins") ? plugins : [])
		.filter((p) => p.view !== false && p.error && !topEntries.some((e) => e.id === `${p.id}:__view`))
		.map(
			(p) =>
				({
					id: `${p.id}:__view`,
					slot: "topbar.primary",
					source: `plugin:${p.id}`,
					label: p.name,
					kind: "view",
					view: `plugin:${p.id}`,
					order: 23,
					align: "end",
					hidden: false,
					userOverrides: [],
					arrangedBy: [],
				}) as UiSlotEntry,
		);
	// 视图门禁 / 白名单门禁在统一的条目流里过滤（见下面的 flowItems）。
	/** 右键一个顶栏条目 → 打开 contextmenu.topbar 槽位（插件可往里贡献菜单项）。 */
	const openItemMenu = (e: React.MouseEvent, id: string, label: string) => {
		e.preventDefault();
		openContextMenu({
			x: e.clientX,
			y: e.clientY,
			slot: "contextmenu.topbar",
			target: { id, label },
			entries: uiContextTopbar ?? [],
		});
	};

	/**
	 * 顶栏宿主内置条目的节点工厂（与 FooterBar 的 hostNodes 同模式）：`renderZoneFlow`
	 * 按 slot 顺序逐条查表，查不到 / 条件不满足（返回 null）即跳过、不占位。
	 * 可见性（slot 显隐）由调用方的条目流决定，TABS 白名单与视图门禁留在各工厂里。
	 */
	const hostNodes: Record<string, ReactNode> = {
		"host:brand": (
			<span className="brand">
				<span className="brand-logo">π</span>
				<span className="brand-name">ccui</span>
			</span>
		),
		// 打开项目：切整个工作区（set_cwd），与视图无关 —— 终端 / Git / 插件视图里同样常驻可点。
		"host:open-project": (
			<button
				type="button"
				className="chip open-project"
				data-tip={t("openProject")}
				onClick={() => setProjectPickerOpen(true)}
			>
				<FiFolderPlus />
				<span className="chip-sub">{t("openProject")}</span>
			</button>
		),
		// 面板抽屉开关只在 chat 视图渲染：抽屉节点躺在 chat 视图的面板树里
		// （App.tsx 的 .panel-drawer 是 `.view-pane` 的子节点，非 chat 视图整棵
		// display:none），所以终端 / Git / 插件视图里点它只会拉出一层遮罩、
		// 抽屉永远不出现 —— 而且顶栏这个 ☰ 会和终端面板自己的 ☰ 并排成两个。
		"host:history":
			view === "chat" && tabOn("history") ? (
				<button
					type="button"
					className="panel-toggle"
					data-tip={t("openHistory")}
					// 纯图标按钮：可访问名称只能走 aria-label（title 会和 data-tip
					// 的即时气泡叠成双提示，故顶栏直流内一律不用原生 title）。
					aria-label={t("openHistory")}
					onClick={() => onOpenPanel("left")}
				>
					<FiMenu />
				</button>
			) : null,
		"host:files":
			view === "chat" && tabOn("files") ? (
				// 文字显隐统一走顶栏文字总开关（.topbar.no-labels）。
				<button
					type="button"
					className="panel-toggle has-label"
					data-tip={t("openFiles")}
					// 文字总开关关掉后 span 会 display:none，可访问名称不能只靠可见文字。
					aria-label={t("openFiles")}
					onClick={() => onOpenPanel("right")}
				>
					<FiFolder />
					<span>{t("openFiles")}</span>
				</button>
			) : null,
		"host:new-ephemeral-chat": (
			<button
				type="button"
				className="chip newchat ephemeral-chat-btn"
				data-tip={t("newChatEphemeralTip")}
				onClick={() => {
					onViewChange("chat");
					appSend({ type: "new_chat", ephemeral: true });
					focusComposer();
				}}
			>
				{/* emoji 也是图标：必须带 .chip-emoji，否则顶栏「只显示图标」模式下会被
				    `.topbar.no-labels .chip > span` 连同文字标签一起藏掉，按钮变成空方块
				    （溢出菜单 portal 在 body 下不受影响 —— 所以是「折叠进 ⋯ 才看得见」）。 */}
				<span className="chip-emoji">🎭</span>
				<span>{t("newChatEphemeral")}</span>
			</button>
		),
		"host:chat": (
			<button
				type="button"
				role="tab"
				aria-selected={view === "chat"}
				className={`tb-tab${view === "chat" ? " active" : ""}`}
				data-tip={t("chat")}
				onClick={() => onViewChange("chat")}
			>
				<FiMessageSquare />
				<span>{t("chat")}</span>
			</button>
		),
		"host:terminal": tabOn("terminal") ? (
			<button
				type="button"
				role="tab"
				aria-selected={view === "terminal"}
				className={`tb-tab${view === "terminal" ? " active" : ""}`}
				data-tip={t("terminal")}
				onClick={() => onViewChange("terminal")}
			>
				<FiTerminal />
				<span>{t("terminal")}</span>
			</button>
		) : null,
		"host:git": tabOn("git") ? (
			<button
				type="button"
				role="tab"
				aria-selected={view === "git"}
				className={`tb-tab${view === "git" ? " active" : ""}`}
				data-tip={t("scmTab")}
				onClick={() => onViewChange("git")}
			>
				<FiGitBranch />
				<span>{t("scmTab")}</span>
			</button>
		) : null,
		"host:search": (
			<button type="button" className="chip" data-tip={t("searchGlobalTip")} onClick={onOpenGlobalSearch}>
				<FiSearch />
				<span className="chip-sub">{t("searchGlobal")}</span>
			</button>
		),
		"host:tasks": (
			<button type="button" className="chip bg-task-chip" data-tip={t("bgTasksTip")} onClick={onOpenBgTasks}>
				<FiLayers />
				<span className="chip-sub">{t("bgTasks")}</span>
				{chat.bgServers.length > 0 && <span className="bg-task-badge">{chat.bgServers.length}</span>}
			</button>
		),
		"host:settings": (
			<button type="button" className="chip" data-tip={t("settingsTitle")} onClick={onOpenSettings}>
				<FiSettings />
				<span className="chip-sub">{t("settings")}</span>
			</button>
		),
	};

	/** 桌面工具 chips 的可见性历史口径（不扩大）：只有 search / tasks / settings 这几个成员
	 *  的显隐还受 PI_WEB_TABS 白名单管（服务端会拒绝对应的消息，画出来只会给一个点了没反应用的按钮）。 */
	const TABS_GATED_IDS = new Set(["host:search", "host:tasks", "host:settings"]);
	/** TABS 白名单门禁（历史口径，不扩大）：search/tasks/settings 的显隐还受白名单管，
	 *  其余宿主入口只看 slot（各节点工厂内部自行判断，见 hostNodes）。 */
	const isTabGatedOff = (id: string) => TABS_GATED_IDS.has(id) && !tabOn(id.slice("host:".length));
	/**
	 * 插件条目的通用渲染（宿主只负责摆位置，插件不碰 DOM）：kind="view" 落成视图 tab，
	 * kind="select" 落成下拉框（切换回插件，附带选中的 value），其余落成按钮。
	 * 条件不满足（插件视图要求 plugins tab 开放）返回 null → 该条目连同位置一起不画。
	 */
	const renderPluginEntry = (entry: UiSlotEntry): ReactNode => {
		if (entry.kind === "view") {
			if (!tabOn("plugins")) return null;
			const target = entry.view ?? "";
			const meta = plugins.find((p) => `plugin:${p.id}` === entry.source);
			const tip = meta?.error ? `${entry.label}: ${meta.error}` : (entry.hint ?? entry.label);
			return (
				<button
					key={entry.id}
					type="button"
					role="tab"
					aria-selected={view === target}
					className={`tb-tab plugin-tab${view === target ? " active" : ""}${meta?.error ? " broken" : ""}`}
					data-tip={tip}
					onClick={() => onViewChange(target as typeof view)}
					onContextMenu={(e) => openItemMenu(e, entry.id, entry.label)}
				>
					<PluginIcon icon={entry.icon} iconSvg={entry.iconSvg} />
					<span>{entry.label}</span>
				</button>
			);
		}
		if (entry.kind === "select" && entry.options?.length) {
			return (
				<select
					key={entry.id}
					className="plugin-topbar-item plugin-topbar-select"
					title={entry.hint ?? entry.label}
					aria-label={entry.label}
					value={entry.options.some((o) => o.value === entry.value) ? (entry.value as string) : entry.options[0]!.value}
					onChange={(e) => onUiAction?.(entry, e.target.value)}
					onContextMenu={(e) => openItemMenu(e, entry.id, entry.label)}
				>
					{entry.options.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			);
		}
		return (
			<button
				key={entry.id}
				type="button"
				className="plugin-topbar-item"
				data-tip={entry.hint ?? entry.label}
				onClick={() => onUiAction?.(entry)}
				onContextMenu={(e) => openItemMenu(e, entry.id, entry.label)}
			>
				<PluginIcon icon={entry.icon} iconSvg={entry.iconSvg} />
				<span>{entry.label}</span>
			</button>
		);
	};
	/**
	 * 最终要画的条目，**按 slot 顺序**（= 布局页里看到的顺序）：
	 * 宿主条目查节点工厂、插件条目通用渲染；门禁（TABS 白名单 / 视图门禁）不满足或节点工厂
	 * 返回 null 的条目**不占位**。这就是顶栏的全部内容 —— 没有第二阶段的分组/重排。
	 */
	const flowItems: { id: string; entry: UiSlotEntry | null; node: ReactNode }[] = [];
	for (const it of topEntries) {
		if (it.entry?.hidden) continue; // uiPrimary 已滤过 hidden；这里只防脏数据（插件 arrange 会改）
		if (isTabGatedOff(it.id)) continue;
		const node = it.id.startsWith("host:") ? (hostNodes[it.id] ?? null) : it.entry ? renderPluginEntry(it.entry) : null;
		if (!node) continue;
		flowItems.push({ id: it.id, entry: it.entry, node });
	}
	// 报错插件的视图 tab（合并引擎整份丢弃了它们的贡献）以伪条目补回尾部。
	for (const b of brokenViewEntries) {
		const node = renderPluginEntry(b);
		if (node) flowItems.push({ id: b.id, entry: b, node });
	}
	/** 条目自己的对齐段（脏值回落 start，与合并引擎同口径）。 */
	const zoneOf = (it: { entry: UiSlotEntry | null }): "start" | "center" | "end" => it.entry?.align ?? "start";
	/** 三段落位（段内仍是 slot 顺序 → 布局页 ↑↓ 的效果与界面一致）。 */
	const segStart = flowItems.filter((it) => zoneOf(it) === "start");
	const segCenter = flowItems.filter((it) => zoneOf(it) === "center");
	const segEnd = flowItems.filter((it) => zoneOf(it) === "end");
	// 顶栏按钮文字总开关（设置 → 界面布局 → 顶栏，默认开）：关掉后顶栏只剩图标
	// （数字角标保留；溢出菜单里仍带文字；实现见 styles.css 的 .topbar.no-labels）。
	const hideTopbarText = chat.settings?.uiLayout?.topbarText === false;
	return (
		<header className={`topbar${hideTopbarText ? " no-labels" : ""}`} data-pi-anchor="topbar">
			{/* 单一扁直流：所有条目同级（没有按种类包裹的容器，也没有两端贴边的例外）。
			    两个 spacer 把条目分成 start / center / end 三段 —— 就是布局页里的「对齐方向」。 */}
			<div className="topbar-flow" role="toolbar" aria-label={t("viewSwitch")}>
				{segStart.map((it) => (
					<Fragment key={it.id}>{it.node}</Fragment>
				))}
				{(segCenter.length > 0 || segEnd.length > 0) && <span className="tb-spacer" aria-hidden="true" />}
				{segCenter.map((it) => (
					<Fragment key={it.id}>{it.node}</Fragment>
				))}
				{segEnd.length > 0 && <span className="tb-spacer" aria-hidden="true" />}
				{segEnd.map((it) => (
					<Fragment key={it.id}>{it.node}</Fragment>
				))}
			</div>
			{projectPickerOpen && (
				<ProjectPicker
					open
					currentCwd={cwd}
					pathCompletions={chat.pathCompletions ?? []}
					workspaceRoots={workspaceRoots}
					onClose={() => setProjectPickerOpen(false)}
					onSelectDirectory={(path) => appSend({ type: "set_cwd", path })}
					onCreateProject={(path) => appSend({ type: "make_dir", path, setAsCwd: true })}
				/>
			)}
		</header>
	);
}
