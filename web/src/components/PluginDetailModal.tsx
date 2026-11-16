import { FiExternalLink, FiFolder, FiKey, FiTool } from "react-icons/fi";
import type { ClientMessage, UiPluginInfo, UiSettingsState } from "../types";
import { useT } from "../i18n";
import { Modal } from "./Modal";
import { PluginIcon } from "../plugin-icon";
import { PluginSettingsForm } from "./PluginSettingsForm";

/** 目录授权 / 能力授权（网络、模型）。 */
export type PluginGrants = { pluginId: string; paths: string[] }[];
export type PluginPermissions = {
	pluginId: string;
	family: "net" | "llm";
	hosts?: string[];
	models?: string[];
	session?: boolean;
	reason?: string;
}[];

/**
 * 单个 UI 插件的详情弹窗：开关、配置、工具、视图入口、以及它自己的授权。
 *
 * 列表页只留「名字 + 一句介绍 + 开关」，所有细节都收进这里 —— 授权类信息（目录 /
 * 网络 / 模型）不再常驻在插件列表下方。
 */
export function PluginDetailModal({
	plugin,
	settings,
	pluginGrants,
	pluginPermissions,
	send,
	onClose,
	onOpenPluginView,
	onOpenTools,
	onUninstall,
}: {
	plugin: UiPluginInfo;
	settings: UiSettingsState | null;
	pluginGrants: PluginGrants;
	pluginPermissions: PluginPermissions;
	send: (msg: ClientMessage) => boolean;
	onClose: () => void;
	onOpenPluginView: (id: string) => void;
	onOpenTools: () => void;
	onUninstall?: () => void;
}) {
	const t = useT();
	const disabled = settings?.disabledPlugins?.includes(plugin.id) ?? false;
	const enabled = !disabled && !plugin.error;
	const paths = pluginGrants.find((g) => g.pluginId === plugin.id)?.paths ?? [];
	const perms = pluginPermissions.filter((p) => p.pluginId === plugin.id);
	const tools = plugin.agentTools ?? [];

	const toggle = () => {
		const next = new Set(settings?.disabledPlugins ?? []);
		if (next.has(plugin.id)) next.delete(plugin.id);
		else next.add(plugin.id);
		send({ type: "set_settings", disabledPlugins: [...next] });
	};

	return (
		<Modal
			title={
				<span className="plugin-detail-title">
					<PluginIcon icon={plugin.icon} iconSvg={plugin.iconSvg} />
					{plugin.name}
					{plugin.version && <span className="plugin-detail-version">v{plugin.version}</span>}
				</span>
			}
			className="plugin-detail"
			onClose={onClose}
		>
			<div className="plugin-detail-body">
				<p className="plugin-detail-desc">{plugin.description?.trim() || plugin.id}</p>

				<div className="plugin-detail-row">
					<span>{t("pluginEnable")}</span>
					<button
						type="button"
						className={`set-switch ${enabled ? "on" : ""}`}
						role="switch"
						aria-checked={enabled}
						aria-label={t("pluginEnable")}
						disabled={Boolean(plugin.error)}
						onClick={toggle}
					>
						<span className="set-switch-knob" />
					</button>
				</div>

				{plugin.error && <p className="mcp-error">{plugin.error}</p>}

				<div className="plugin-detail-actions">
					{plugin.view !== false && (
						<button
							type="button"
							className="btn"
							disabled={Boolean(plugin.error) || disabled}
							onClick={() => {
								onClose();
								onOpenPluginView(plugin.id);
							}}
						>
							<FiExternalLink /> {t("pluginViewOpen")}
						</button>
					)}
					{tools.length > 0 && (
						<button type="button" className="btn" onClick={onOpenTools}>
							<FiTool /> {t("settingsTools")} ({tools.length})
						</button>
					)}
					{onUninstall && !plugin.bundled && (
						<button type="button" className="btn danger" onClick={onUninstall}>
							{t("uninstallExt")}
						</button>
					)}
				</div>

				{tools.length > 0 && (
					<section className="plugin-detail-section">
						<h3>{t("pluginToolsSection")}</h3>
						<div className="plugin-detail-tools">
							{tools.map((tool) => (
								<code key={tool.name} title={tool.description}>
									{tool.name}
								</code>
							))}
						</div>
					</section>
				)}

				{plugin.wantsDom && (
					<section className="plugin-detail-section">
						<h3>{t("pluginDomTitle")}</h3>
						<div className="plugin-detail-row">
							<span className="plugin-detail-hint">{t("pluginDomDesc")}</span>
							<button
								type="button"
								className={`btn${plugin.domGranted ? " danger" : ""}`}
								onClick={() => send({ type: "plugin_dom_consent", pluginId: plugin.id, granted: !plugin.domGranted })}
							>
								{plugin.domGranted ? t("pluginDomRevoke") : t("pluginDomGrant")}
							</button>
						</div>
					</section>
				)}

				{plugin.settingsSchema && plugin.settingsSchema.length > 0 && (
					<section className="plugin-detail-section">
						<h3>{t("pluginSettingsTitle")}</h3>
						<PluginSettingsForm plugin={plugin} models={settings?.subagentModels ?? []} />
					</section>
				)}

				{paths.length > 0 && (
					<section className="plugin-detail-section">
						<h3>
							<FiFolder /> {t("pluginGrantsTitle")}
						</h3>
						{paths.map((path) => (
							<div key={path} className="plugin-detail-row">
								<code className="plugin-detail-path">{path}</code>
								<button
									type="button"
									className="btn danger"
									onClick={() => send({ type: "plugin_path_revoke", pluginId: plugin.id, path })}
								>
									{t("pluginGrantsRevoke")}
								</button>
							</div>
						))}
					</section>
				)}

				{perms.length > 0 && (
					<section className="plugin-detail-section">
						<h3>
							<FiKey /> {t("pluginPermsTitle")}
						</h3>
						{perms.map((grant, index) => (
							<div key={`${grant.family}|${index}`} className="plugin-detail-grant">
								<div className="plugin-detail-row">
									<span className="plugin-detail-hint">
										{grant.family === "net" ? t("pluginPermNet") : t("pluginPermLlm")}
										{grant.session ? ` · ${t("pluginPermSession")}` : ""}
									</span>
								</div>
								{(grant.hosts ?? []).map((host) => (
									<div key={host} className="plugin-detail-row">
										<code className="plugin-detail-path">{host}</code>
										<button
											type="button"
											className="btn danger"
											onClick={() =>
												send({ type: "plugin_permission_revoke", pluginId: plugin.id, family: "net", host })
											}
										>
											{t("pluginGrantsRevoke")}
										</button>
									</div>
								))}
								{(grant.models ?? []).map((model) => (
									<div key={model} className="plugin-detail-row">
										<code className="plugin-detail-path">{model}</code>
										<button
											type="button"
											className="btn danger"
											onClick={() =>
												send({ type: "plugin_permission_revoke", pluginId: plugin.id, family: "llm", model })
											}
										>
											{t("pluginGrantsRevoke")}
										</button>
									</div>
								))}
								{(grant.hosts ?? []).length === 0 && (grant.models ?? []).length === 0 && (
									<div className="plugin-detail-row">
										<span className="plugin-detail-hint">{grant.reason ?? t("pluginPermUnscoped")}</span>
										<button
											type="button"
											className="btn danger"
											onClick={() =>
												send({
													type: "plugin_permission_revoke",
													pluginId: plugin.id,
													family: grant.family,
												})
											}
										>
											{t("pluginGrantsRevoke")}
										</button>
									</div>
								)}
								{grant.reason && (grant.hosts ?? []).length + (grant.models ?? []).length > 0 && (
									<p className="plugin-detail-hint">{grant.reason}</p>
								)}
							</div>
						))}
					</section>
				)}

				<footer className="plugin-detail-foot">
					<code>{plugin.id}</code>
					{plugin.source && <span>{plugin.source}</span>}
				</footer>
			</div>
		</Modal>
	);
}
