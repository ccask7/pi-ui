import { useEffect, useState } from "react";
import { FiBox, FiCpu, FiPackage, FiServer } from "react-icons/fi";
import type { ClientMessage, UiAgentPreset, UiMcpServerInfo, UiPluginInfo, UiSettingsState } from "../types";
import { useT } from "../i18n";
import { presetShowsSkillCatalog } from "../../../server/tool-manager.js";
import { SkillsPanel } from "./SkillsPanel";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { PluginsPanel } from "./PluginsPanel";

function McpPanel({ servers, configPath }: { servers: UiMcpServerInfo[]; configPath: string }) {
	const t = useT();
	if (servers.length === 0) {
		return (
			<div className="capabilities-empty">
				<FiServer />
				<p>{t("mcpEmpty")}</p>
				{configPath && <code>{configPath}</code>}
			</div>
		);
	}
	return (
		<div className="mcp-list">
			{servers.map((server) => (
				<details className={`mcp-server ${server.status}`} key={server.name}>
					<summary>
						<span className="mcp-server-name">{server.name}</span>
						<span className={`mcp-status ${server.status}`}>
							{server.status === "running" ? t("mcpRunning") : t("mcpError")}
						</span>
						<span className="set-count">{t("mcpToolCount", { count: String(server.tools.length) })}</span>
					</summary>
					{server.error && <p className="mcp-error">{server.error}</p>}
					{server.tools.length > 0 && (
						<div className="mcp-tools">
							{server.tools.map((tool) => (
								<div className="mcp-tool" key={tool.name}>
									<strong>{tool.name}</strong>
									{tool.description && <span>{tool.description}</span>}
								</div>
							))}
						</div>
					)}
				</details>
			))}
		</div>
	);
}

export function CapabilitiesPanel({
	settings,
	agentPresets,
	mcpServers,
	mcpConfigPath,
	plugins,
	pluginGrants,
	pluginPermissions,
	onOpenPluginView,
	onOpenTools,
	send,
}: {
	settings: UiSettingsState | null;
	agentPresets: { presets: UiAgentPreset[]; defaultPreset: string } | null;
	mcpServers: UiMcpServerInfo[];
	mcpConfigPath: string;
	plugins: UiPluginInfo[];
	pluginGrants: { pluginId: string; paths: string[] }[];
	pluginPermissions: {
		pluginId: string;
		family: "net" | "llm";
		hosts?: string[];
		models?: string[];
		session?: boolean;
		reason?: string;
	}[];
	onOpenPluginView: (id: string) => void;
	onOpenTools: () => void;
	send: (msg: ClientMessage) => boolean;
}) {
	const t = useT();
	const [tab, setTab] = useState<"plugins" | "skills" | "mcp">("skills");
	useEffect(() => {
		send({ type: "list_mcp_servers" });
	}, [send]);
	const presetId = agentPresets?.defaultPreset ?? null;
	const presetName = agentPresets?.presets.find((preset) => preset.id === presetId)?.name ?? presetId ?? "";
	const presetWarning =
		presetId && presetId !== "standard" && !presetShowsSkillCatalog(presetId)
			? t("skillsHiddenByPreset", { name: presetName })
			: undefined;

	return (
		<section className="capabilities-panel" aria-label={t("pluginEntry")}>
			<div className="capabilities-tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "skills"}
					className={tab === "skills" ? "active" : ""}
					onClick={() => setTab("skills")}
				>
					<FiCpu /> {t("settingsSkills")}
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "plugins"}
					className={tab === "plugins" ? "active" : ""}
					onClick={() => setTab("plugins")}
				>
					<FiBox /> {t("settingsExtensions")}
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "mcp"}
					className={tab === "mcp" ? "active" : ""}
					onClick={() => setTab("mcp")}
				>
					<FiServer /> MCP
				</button>
			</div>
			<div className="capabilities-body" role="tabpanel">
				{tab === "plugins" ? (
					settings ? (
						<div className="capabilities-plugin-groups">
							<section className="capabilities-plugin-group capabilities-extension-group">
								<h2>
									<FiPackage />
									{t("extensionPackages")}
									<span className="set-count">{settings.extensions.length}</span>
								</h2>
								<ExtensionsPanel settings={settings} send={send} />
							</section>
							<section className="capabilities-plugin-group capabilities-ui-group">
								<h2>
									<FiBox />
									{t("settingsUiPlugins")}
									<span className="set-count">{plugins.length}</span>
								</h2>
								<PluginsPanel
									plugins={plugins}
									settings={settings}
									pluginGrants={pluginGrants}
									pluginPermissions={pluginPermissions}
									send={send}
									onOpenPluginView={onOpenPluginView}
									onOpenTools={onOpenTools}
								/>
							</section>
						</div>
					) : (
						<div className="capabilities-empty">{t("loadingSession")}</div>
					)
				) : tab === "skills" ? (
					settings ? (
						<SkillsPanel
							settings={settings}
							presetWarning={presetWarning}
							onPatch={(patch) => send({ type: "set_settings", ...patch })}
						/>
					) : (
						<div className="capabilities-empty">{t("loadingSession")}</div>
					)
				) : (
					<McpPanel servers={mcpServers} configPath={mcpConfigPath} />
				)}
			</div>
		</section>
	);
}
