import { useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import type { ClientMessage, UiExtensionInfo, UiSettingsState } from "../types";
import { useT } from "../i18n";
import { ToggleRow } from "./SettingsControls";

export function ExtensionsPanel({
	settings,
	send,
}: {
	settings: UiSettingsState;
	send: (msg: ClientMessage) => boolean;
}) {
	const t = useT();
	const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
	const disabledExtensions = new Set(settings.disabledExtensions ?? []);
	const toggleExtension = (extension: UiExtensionInfo) => {
		const next = new Set(disabledExtensions);
		if (next.has(extension.id)) next.delete(extension.id);
		else next.add(extension.id);
		send({ type: "set_settings", disabledExtensions: [...next] });
	};
	const runUninstall = (pkgName: string) => {
		setConfirmUninstall(null);
		window.dispatchEvent(
			new CustomEvent("ccui:plugin-run-command", {
				detail: { title: `${t("uninstallTitle")} ${pkgName}`, command: `pi remove npm:${pkgName}` },
			}),
		);
	};

	return (
		<div className="capabilities-extensions">
			{settings.extensions.length === 0 ? (
				<p className="set-empty">{t("noExtensions")}</p>
			) : (
				<div className="set-list">
					{settings.extensions.map((extension) => {
						const pkgName = extension.id.startsWith("npm:") ? extension.id.slice(4) : null;
						return (
							<ToggleRow
								key={extension.id}
								title={extension.name}
								subtitle={extension.path}
								enabled={extension.enabled}
								onToggle={() => toggleExtension(extension)}
								action={
									pkgName ? (
										confirmUninstall === extension.id ? (
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
												onClick={() => setConfirmUninstall(extension.id)}
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
	);
}
