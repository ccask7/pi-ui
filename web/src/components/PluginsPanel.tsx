import { FiFolder, FiKey, FiMonitor, FiRefreshCw } from "react-icons/fi";
import type { UiPluginInfo, UiSettingsState, ClientMessage } from "../types";
import { useT } from "../i18n";
import { PluginIcon } from "../plugin-icon";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { ToggleRow } from "./SettingsControls";
import { BrowserControlSettings } from "./BrowserControl";

/** 目录授权 / 能力授权（网络、模型）——插件页里唯一能撤销它们的地方（设置页的旧插件页签已收），
 *  放在列表下方折叠区，平时不占地方。 */
type PluginGrants = { pluginId: string; paths: string[] }[];
type PluginPermissions = {
	pluginId: string;
	family: "net" | "llm";
	hosts?: string[];
	models?: string[];
	session?: boolean;
	reason?: string;
}[];

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
	const disabledPlugins = new Set(settings?.disabledPlugins ?? []);
	const disabledPluginTools = new Set(settings?.disabledPluginTools ?? []);
	const togglePlugin = (plugin: UiPluginInfo) => {
		const next = new Set(disabledPlugins);
		if (next.has(plugin.id)) next.delete(plugin.id);
		else next.add(plugin.id);
		send({ type: "set_settings", disabledPlugins: [...next] });
	};
	const grantCount = pluginGrants.reduce((count, grant) => count + grant.paths.length, 0);

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
						const hasDetails =
							Boolean(plugin.settingsSchema?.length) || Boolean(plugin.agentTools?.length) || plugin.wantsDom;
						return (
							<div className="plugin-simple-item" key={plugin.id}>
								<ToggleRow
									title={
										<>
											<PluginIcon icon={plugin.icon} iconSvg={plugin.iconSvg} />
											{plugin.name}
										</>
									}
									subtitle={plugin.description?.trim() || plugin.source || plugin.id}
									enabled={!disabledPlugins.has(plugin.id) && !plugin.error}
									disabled={Boolean(plugin.error)}
									onToggle={() => togglePlugin(plugin)}
									action={
										plugin.view !== false ? (
											<button
												type="button"
												className="set-uninstall"
												disabled={Boolean(plugin.error)}
												onClick={() => onOpenPluginView(plugin.id)}
											>
												{t("pluginViewOpen")}
											</button>
										) : undefined
									}
								/>
								{plugin.error && <p className="mcp-error">{plugin.error}</p>}
								{hasDetails && (
									<details className="plugin-inline-details">
										<summary>{t("pluginSettingsTitle")}</summary>
										<div className="plugin-inline-body">
											{plugin.agentTools && plugin.agentTools.length > 0 && (
												<div className="set-row" title={t("pluginToolOffHint")}>
													<span>
														{t("pluginToolsSection")} ({plugin.agentTools.length})
														{plugin.agentTools.some((tool) => disabledPluginTools.has(tool.name))
															? ` · ${t("settingsDisabled")}`
															: ""}
													</span>
													<button type="button" className="set-uninstall" onClick={onOpenTools}>
														{t("settingsTools")} →
													</button>
												</div>
											)}
											{plugin.wantsDom && (
												<div className="set-row" title={t("pluginDomDesc")}>
													<span>{plugin.domGranted ? t("pluginDomGranted") : t("pluginDomNeed")}</span>
													<button
														type="button"
														className={`set-uninstall${plugin.domGranted ? "" : " confirm"}`}
														onClick={() =>
															send({ type: "plugin_dom_consent", pluginId: plugin.id, granted: !plugin.domGranted })
														}
													>
														{plugin.domGranted ? t("pluginDomRevoke") : t("pluginDomGrant")}
													</button>
												</div>
											)}
											{plugin.settingsSchema && plugin.settingsSchema.length > 0 && (
												<PluginSettingsForm plugin={plugin} models={settings?.subagentModels ?? []} />
											)}
										</div>
									</details>
								)}
							</div>
						);
					})}
				</div>
			)}

			<details className="plugin-auth-section">
				<summary>
					<FiFolder />
					{t("pluginGrantsTitle")}
					<span className="set-count">{grantCount}</span>
				</summary>
				<p className="plugin-auth-hint">{t("pluginGrantsHint")}</p>
				{pluginGrants.length === 0 ? (
					<p className="set-empty">{t("pluginGrantsEmpty")}</p>
				) : (
					pluginGrants.map((grant) => (
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
					))
				)}
			</details>

			<details className="plugin-auth-section">
				<summary>
					<FiKey />
					{t("pluginPermsTitle")}
					<span className="set-count">{pluginPermissions.length}</span>
				</summary>
				<p className="plugin-auth-hint">{t("pluginPermsHint")}</p>
				{pluginPermissions.length === 0 ? (
					<p className="set-empty">{t("pluginPermsEmpty")}</p>
				) : (
					pluginPermissions.map((grant, index) => {
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
								{grant.reason && (hosts.length > 0 || models.length > 0) && (
									<p className="plugin-auth-hint">{grant.reason}</p>
								)}
							</div>
						);
					})
				)}
			</details>

			<details className="plugin-auth-section">
				<summary>
					<FiMonitor />
					{t("browserControl")}
				</summary>
				<BrowserControlSettings />
			</details>
		</div>
	);
}
