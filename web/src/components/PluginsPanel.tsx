import { useState } from "react";
import { FiChevronRight, FiFolder, FiMonitor, FiRefreshCw } from "react-icons/fi";
import type { UiPluginInfo, UiSettingsState, ClientMessage } from "../types";
import { useT } from "../i18n";
import { PluginIcon } from "../plugin-icon";
import { PluginDetailModal, type PluginGrants, type PluginPermissions } from "./PluginDetailModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { BrowserControlSettings } from "./BrowserControl";

/**
 * 「界面插件」列表：每行只有 **图标 + 名称 + 一句介绍 + 开关**。
 *
 * 点整行打开该插件的详情弹窗（配置、AI 工具、视图入口、目录/网络/模型授权都在那里），
 * 列表本身不再常驻任何授权或浏览器设置区块。
 */
export function PluginsPanel({
	plugins,
	settings,
	pluginGrants,
	pluginPermissions,
	send,
	onOpenPluginView,
	onOpenTools,
}: {
	plugins: UiPluginInfo[];
	settings: UiSettingsState | null;
	pluginGrants: PluginGrants;
	pluginPermissions: PluginPermissions;
	send: (msg: ClientMessage) => boolean;
	onOpenPluginView: (id: string) => void;
	onOpenTools: () => void;
}) {
	const t = useT();
	const [detail, setDetail] = useState<UiPluginInfo | null>(null);
	const [uninstalling, setUninstalling] = useState<UiPluginInfo | null>(null);
	const disabledPlugins = new Set(settings?.disabledPlugins ?? []);
	// 插件目录已经不在、但授权还留着的条目（手动删目录 / 旧版卸载没清授权）：
	// 详情弹窗只能展示存在的插件，这些孤儿授权得在列表下面单独收，不然永远撤不掉。
	const knownIds = new Set(plugins.map((p) => p.id));
	const orphanGrants = pluginGrants.filter((g) => !knownIds.has(g.pluginId) && g.paths.length > 0);
	const orphanPerms = pluginPermissions.filter((p) => !knownIds.has(p.pluginId));

	const togglePlugin = (plugin: UiPluginInfo) => {
		const next = new Set(disabledPlugins);
		if (next.has(plugin.id)) next.delete(plugin.id);
		else next.add(plugin.id);
		send({ type: "set_settings", disabledPlugins: [...next] });
	};

	return (
		<div className="capabilities-plugins">
			<div className="plugin-list-toolbar">
				<button
					type="button"
					className="plugin-rescan"
					title={t("pluginRescanHint")}
					aria-label={t("pluginRescan")}
					onClick={() => send({ type: "plugins_reload" })}
				>
					<FiRefreshCw />
				</button>
			</div>
			{plugins.length === 0 ? (
				<p className="set-empty">{t("noUiPlugins")}</p>
			) : (
				<div className="set-list">
					{plugins.map((plugin) => {
						const enabled = !disabledPlugins.has(plugin.id) && !plugin.error;
						return (
							<div
								key={plugin.id}
								className={`plugin-row${enabled ? "" : " off"}`}
								role="button"
								tabIndex={0}
								aria-label={t("pluginDetailOpen", { name: plugin.name })}
								onClick={() => setDetail(plugin)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										setDetail(plugin);
									}
								}}
							>
								<PluginIcon icon={plugin.icon} iconSvg={plugin.iconSvg} />
								<div className="plugin-row-text">
									<div className="plugin-row-name">
										{plugin.name}
										{plugin.version && <span className="plugin-row-version">v{plugin.version}</span>}
									</div>
									<div className="plugin-row-desc">{plugin.description?.trim() || plugin.id}</div>
								</div>
								<button
									type="button"
									className={`set-switch ${enabled ? "on" : ""}`}
									role="switch"
									aria-checked={enabled}
									aria-label={plugin.name}
									disabled={Boolean(plugin.error)}
									title={enabled ? t("settingsEnabled") : t("settingsDisabled")}
									onClick={(event) => {
										event.stopPropagation();
										togglePlugin(plugin);
									}}
								>
									<span className="set-switch-knob" />
								</button>
								<FiChevronRight className="plugin-row-arrow" />
							</div>
						);
					})}
				</div>
			)}

			{(orphanGrants.length > 0 || orphanPerms.length > 0) && (
				<details className="plugin-auth-section">
					<summary>
						<FiFolder />
						{t("pluginGrantsOrphan")}
					</summary>
					<p className="plugin-auth-hint">{t("pluginGrantsOrphanHint")}</p>
					{orphanGrants.map((grant) => (
						<div key={grant.pluginId} className="plugin-auth-grant">
							<div className="plugin-auth-title">
								<span>{grant.pluginId}</span>
							</div>
							{grant.paths.map((path) => (
								<div key={path} className="plugin-auth-row">
									<span className="set-catalog-source">{path}</span>
									<button
										type="button"
										className="set-uninstall"
										onClick={() => send({ type: "plugin_path_revoke", pluginId: grant.pluginId, path })}
									>
										{t("pluginGrantsRevoke")}
									</button>
								</div>
							))}
						</div>
					))}
					{orphanPerms.map((grant, index) => {
						const hosts = grant.hosts ?? [];
						const models = grant.models ?? [];
						return (
							<div key={`${grant.pluginId}|${grant.family}|${index}`} className="plugin-auth-grant">
								<div className="plugin-auth-title">
									<span>{grant.pluginId}</span>
									<span className="set-catalog-source">
										{grant.family === "net" ? t("pluginPermNet") : t("pluginPermLlm")}
										{grant.session ? ` · ${t("pluginPermSession")}` : ""}
									</span>
								</div>
								{hosts.map((host) => (
									<div key={host} className="plugin-auth-row">
										<span className="set-catalog-source">{host}</span>
										<button
											type="button"
											className="set-uninstall"
											onClick={() =>
												send({ type: "plugin_permission_revoke", pluginId: grant.pluginId, family: "net", host })
											}
										>
											{t("pluginGrantsRevoke")}
										</button>
									</div>
								))}
								{models.map((model) => (
									<div key={model} className="plugin-auth-row">
										<span className="set-catalog-source">{model}</span>
										<button
											type="button"
											className="set-uninstall"
											onClick={() =>
												send({ type: "plugin_permission_revoke", pluginId: grant.pluginId, family: "llm", model })
											}
										>
											{t("pluginGrantsRevoke")}
										</button>
									</div>
								))}
								{hosts.length === 0 && models.length === 0 && (
									<div className="plugin-auth-row">
										<span className="set-catalog-source">{grant.reason ?? t("pluginPermUnscoped")}</span>
										<button
											type="button"
											className="set-uninstall"
											onClick={() =>
												send({ type: "plugin_permission_revoke", pluginId: grant.pluginId, family: grant.family })
											}
										>
											{t("pluginGrantsRevoke")}
										</button>
									</div>
								)}
							</div>
						);
					})}
				</details>
			)}

			{/* 浏览器操作（page-picker 扩展 / browser_page 工具）：设置里唯一的入口。
			    设置弹窗里那块同名区块在 `tab === "plugins"` 分支下，而那个页签早已没有导航项。 */}
			<details className="plugin-auth-section">
				<summary>
					<FiMonitor />
					{t("browserControl")}
				</summary>
				<BrowserControlSettings />
			</details>

			{detail && (
				<PluginDetailModal
					plugin={plugins.find((p) => p.id === detail.id) ?? detail}
					settings={settings}
					pluginGrants={pluginGrants}
					pluginPermissions={pluginPermissions}
					send={send}
					onClose={() => setDetail(null)}
					onOpenPluginView={onOpenPluginView}
					onOpenTools={() => {
						setDetail(null);
						onOpenTools();
					}}
					onUninstall={() => {
						setUninstalling(detail);
						setDetail(null);
					}}
				/>
			)}

			{uninstalling && (
				<ConfirmDialog
					title={t("uninstallExt")}
					confirmLabel={t("uninstallConfirm")}
					danger
					onClose={() => setUninstalling(null)}
					onConfirm={() => send({ type: "plugins_uninstall", id: uninstalling.id })}
				>
					{t("pluginUninstallBody", { name: uninstalling.name })}
				</ConfirmDialog>
			)}
		</div>
	);
}
