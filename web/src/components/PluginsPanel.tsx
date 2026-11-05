import { useState } from "react";
import { FiFolder, FiKey, FiMonitor, FiRefreshCw } from "react-icons/fi";
import type { UiPluginInfo, UiSettingsState, ClientMessage } from "../types";
import { useT } from "../i18n";
import { PluginIcon } from "../plugin-icon";
import { countPluginPhases, pluginPhase, type PluginPhase } from "../plugin-phase";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { ToggleRow } from "./SettingsControls";
import { BrowserControlSettings } from "./BrowserControl";
import { Modal } from "./Modal";

function phaseLabelKey(phase: PluginPhase) {
	if (phase === "active") return "pluginPhaseActive";
	if (phase === "disabled") return "pluginPhaseDisabled";
	if (phase === "failed") return "pluginPhaseFailed";
	return "pluginPhaseIdle";
}

function InvDot({ phase, label }: { phase: PluginPhase; label: string }) {
	return <span className={`inv-dot ${phase}`} title={label} aria-label={label} />;
}

function PluginInventoryStrip({ plugins, disabledIds }: { plugins: UiPluginInfo[]; disabledIds: ReadonlySet<string> }) {
	const t = useT();
	const counts = countPluginPhases(plugins, disabledIds);
	const labels: Record<PluginPhase, string> = {
		active: t("pluginPhaseActive"),
		disabled: t("pluginPhaseDisabled"),
		failed: t("pluginPhaseFailed"),
		idle: t("pluginPhaseIdle"),
	};
	return (
		<div className="plugin-inventory-strip">
			{(["active", "disabled", "failed", "idle"] as const).map((phase) => (
				<span key={phase}>
					<InvDot phase={phase} label={labels[phase]} /> {labels[phase]} {counts[phase]}
				</span>
			))}
		</div>
	);
}

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
	pluginGrants: { pluginId: string; paths: string[] }[];
	pluginPermissions: {
		pluginId: string;
		family: "net" | "llm";
		hosts?: string[];
		models?: string[];
		session?: boolean;
		reason?: string;
	}[];
	send: (msg: ClientMessage) => boolean;
	onOpenPluginView: (id: string) => void;
	onOpenTools: () => void;
}) {
	const t = useT();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = plugins.find((plugin) => plugin.id === selectedId) ?? null;
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
				<PluginInventoryStrip plugins={plugins} disabledIds={disabledPlugins} />
				<button
					type="button"
					className="set-uninstall"
					title={t("pluginRescanHint")}
					onClick={() => send({ type: "plugins_reload" })}
				>
					<FiRefreshCw />
					{t("pluginRescan")}
				</button>
			</div>
			{plugins.length === 0 ? (
				<p className="set-empty">{t("noUiPlugins")}</p>
			) : (
				<div className="plugin-compact-list">
					{plugins.map((plugin) => {
						const phase = pluginPhase(plugin, disabledPlugins.has(plugin.id));
						const description = plugin.description?.trim() || plugin.source || plugin.id;
						return (
							<div className="plugin-compact-row" key={plugin.id}>
								<button
									type="button"
									className="plugin-compact-main"
									onClick={() => setSelectedId(plugin.id)}
									aria-label={`${plugin.name} · ${description}`}
								>
									<PluginIcon icon={plugin.icon} iconSvg={plugin.iconSvg} />
									<span className="plugin-compact-copy">
										<strong>{plugin.name}</strong>
										<span>{description}</span>
									</span>
									<InvDot phase={phase} label={t(phaseLabelKey(phase))} />
								</button>
								<button
									type="button"
									className={`set-switch ${phase === "active" ? "on" : ""}`}
									role="switch"
									aria-checked={phase === "active"}
									disabled={Boolean(plugin.error)}
									title={phase === "active" ? t("settingsEnabled") : t("settingsDisabled")}
									onClick={() => togglePlugin(plugin)}
								>
									<span className="set-switch-knob" />
								</button>
							</div>
						);
					})}
				</div>
			)}

			<details className="plugin-secondary-section">
				<summary>
					<FiFolder />
					{t("pluginGrantsTitle")}
					<span className="set-count">{pluginGrants.reduce((count, grant) => count + grant.paths.length, 0)}</span>
				</summary>
				<div className="set-note">{t("pluginGrantsHint")}</div>
				{pluginGrants.length === 0 ? (
					<p className="set-empty">{t("pluginGrantsEmpty")}</p>
				) : (
					pluginGrants.map((grant) => (
						<div key={grant.pluginId} className="set-grant-row">
							<div className="set-catalog-title">
								<span>{grant.pluginId}</span>
							</div>
							{grant.paths.map((path) => (
								<div key={path} className="set-grant-path">
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
			<details className="plugin-secondary-section">
				<summary>
					<FiKey />
					{t("pluginPermsTitle")}
					<span className="set-count">{pluginPermissions.length}</span>
				</summary>
				<div className="set-note">{t("pluginPermsHint")}</div>
				{pluginPermissions.length === 0 ? (
					<p className="set-empty">{t("pluginPermsEmpty")}</p>
				) : (
					pluginPermissions.map((grant, index) => (
						<div key={`${grant.pluginId}|${grant.family}|${index}`} className="set-grant-row">
							<div className="set-catalog-title">
								<span>{grant.pluginId}</span>
								<span className="set-catalog-source">
									{grant.family === "net" ? t("pluginPermNet") : t("pluginPermLlm")}
									{grant.session ? ` · ${t("pluginPermSession")}` : ""}
								</span>
							</div>
							{(grant.hosts ?? []).map((host) => (
								<div key={host} className="set-grant-path">
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
							{(grant.models ?? []).map((model) => (
								<div key={model} className="set-grant-path">
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
							{!(grant.hosts ?? []).length && !(grant.models ?? []).length && (
								<div className="set-grant-path">
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
							{grant.reason && ((grant.hosts ?? []).length > 0 || (grant.models ?? []).length > 0) && (
								<div className="set-note">{grant.reason}</div>
							)}
						</div>
					))
				)}
			</details>
			<details className="plugin-secondary-section">
				<summary>
					<FiMonitor />
					{t("browserControl")}
				</summary>
				<BrowserControlSettings />
			</details>

			{selected && (
				<Modal
					title={selected.name}
					icon={<PluginIcon icon={selected.icon} iconSvg={selected.iconSvg} />}
					className="plugin-detail-modal"
					onClose={() => setSelectedId(null)}
				>
					<div className="modal-body plugin-detail-body">
						<ToggleRow
							title={selected.name}
							subtitle={selected.description || selected.id}
							enabled={!disabledPlugins.has(selected.id) && !selected.error}
							onToggle={() => !selected.error && togglePlugin(selected)}
						/>
						<div className="plugin-detail-meta">
							<div>
								<span>ID</span>
								<code>{selected.id}</code>
							</div>
							{selected.version && (
								<div>
									<span>Version</span>
									<span>{selected.version}</span>
								</div>
							)}
							<div>
								<span>{t("pluginSource")}</span>
								<span>{selected.source || t("uiPluginNoSource")}</span>
							</div>
							<div>
								<span>{t("pluginPermsTitle")}</span>
								<span>{selected.permissions?.join(", ") || "—"}</span>
							</div>
						</div>
						{selected.error && <p className="mcp-error">{selected.error}</p>}
						{selected.view !== false && (
							<div className="set-row">
								<span>{t("pluginViewsTitle")}</span>
								<button
									type="button"
									className="btn"
									disabled={Boolean(selected.error)}
									onClick={() => onOpenPluginView(selected.id)}
								>
									{t("pluginViewOpen")}
								</button>
							</div>
						)}
						{selected.agentTools && selected.agentTools.length > 0 && (
							<div className="set-row" title={t("pluginToolOffHint")}>
								<span>
									{t("pluginToolsSection")} ({selected.agentTools.length})
									{selected.agentTools.some((tool) => disabledPluginTools.has(tool.name))
										? ` · ${t("settingsDisabled")}`
										: ""}
								</span>
								<button type="button" className="set-uninstall" onClick={onOpenTools}>
									{t("settingsTools")} →
								</button>
							</div>
						)}
						{selected.wantsDom && (
							<div className="set-row" title={t("pluginDomDesc")}>
								<span>{selected.domGranted ? t("pluginDomGranted") : t("pluginDomNeed")}</span>
								<button
									type="button"
									className={`set-uninstall${selected.domGranted ? "" : " confirm"}`}
									onClick={() =>
										send({ type: "plugin_dom_consent", pluginId: selected.id, granted: !selected.domGranted })
									}
								>
									{selected.domGranted ? t("pluginDomRevoke") : t("pluginDomGrant")}
								</button>
							</div>
						)}
						{selected.settingsSchema && selected.settingsSchema.length > 0 && (
							<div className="plugin-detail-settings">
								<h3>
									{t("pluginSettingsTitle")} ({selected.settingsSchema.length})
								</h3>
								<PluginSettingsForm plugin={selected} models={settings?.subagentModels ?? []} />
							</div>
						)}
					</div>
				</Modal>
			)}
		</div>
	);
}
