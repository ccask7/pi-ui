import { FiCheck } from "react-icons/fi";
import { useI18n, useT } from "../i18n";

/** 语言切换（设置 → 通用）。语言包安装后自动出现在候选列表中。 */
export function LanguageSettings() {
	const t = useT();
	const { locale, setLocale, packs } = useI18n();

	return (
		<>
			<div className="set-note">{t("languageHint")}</div>
			<div className="set-list">
				{packs.map((l) => {
					const active = locale === l.code;
					return (
						<div key={l.code} className={`set-row${active ? " active" : ""}`}>
							<div className="set-row-info">
								<div className="set-row-name">
									{l.nativeName} <span className="set-row-desc">{l.code}</span>
								</div>
							</div>
							{active ? (
								<span className="set-locale-current">
									<FiCheck /> {t("localeCurrent")}
								</span>
							) : (
								<button type="button" className="btn" onClick={() => setLocale(l.code)}>
									{t("localeSwitch")}
								</button>
							)}
						</div>
					);
				})}
			</div>
		</>
	);
}
