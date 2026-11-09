import { FiRefreshCw } from "react-icons/fi";
import type { UiPluginInfo, UiSettingsState, ClientMessage } from "../types";
import { useT } from "../i18n";
import { PluginIcon } from "../plugin-icon";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { ToggleRow } from "./SettingsControls";

export function PluginsPanel({
	plugins,
	settings,
	send,
	onOpenPluginView,
	onOpenTools,
}: {
	plugins: UiPluginInfo[];
	settings: UiSettingsState | null;
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
		</div>
	);
}
