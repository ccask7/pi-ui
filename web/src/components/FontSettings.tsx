import { FiType } from "react-icons/fi";
import { saveInterfaceFont, useInterfaceFont, type InterfaceFont } from "../font-settings";
import { useT } from "../i18n";

/** 设置 → 通用：正文字体切换。 */
export function FontSettings() {
	const t = useT();
	const font = useInterfaceFont();
	return (
		<div className="set-section">
			<div className="set-section-title">
				<FiType className="set-section-icon" />
				{t("interfaceFont")}
			</div>
			<div className="set-row">
				<div className="set-description">{t("interfaceFontDesc")}</div>
				<select
					className="set-select interface-font-select"
					aria-label={t("interfaceFont")}
					value={font}
					onChange={(event) => saveInterfaceFont(event.target.value as InterfaceFont)}
				>
					<option value="system">{t("interfaceFontSystem")}</option>
					<option value="sarasa-ui-sc">{t("interfaceFontSarasa")}</option>
				</select>
			</div>
		</div>
	);
}
