import { FiCpu } from "react-icons/fi";
import type { UiSettingsState } from "../types";
import { useT } from "../i18n";
import { HintTip } from "./HintTip";
import { ToggleRow } from "./SettingsControls";

export function SkillsPanel({
	settings,
	onPatch,
	presetWarning,
}: {
	settings: UiSettingsState;
	onPatch: (patch: { disabledSkills?: string[]; skillsFullText?: string[] }) => void;
	presetWarning?: string;
}) {
	const t = useT();
	const disabledSkills = new Set(settings.disabledSkills);
	const fullTextSkills = new Set(settings.skillsFullText ?? []);
	const toggleSkill = (name: string) => {
		if (disabledSkills.has(name)) disabledSkills.delete(name);
		else disabledSkills.add(name);
		onPatch({ disabledSkills: [...disabledSkills] });
	};
	const toggleFullText = (name: string) => {
		if (fullTextSkills.has(name)) fullTextSkills.delete(name);
		else fullTextSkills.add(name);
		onPatch({ skillsFullText: [...fullTextSkills] });
	};

	return (
		<div className="set-section skills-panel">
			<div className="set-section-title">
				<FiCpu className="set-section-icon" />
				{t("settingsSkills")}
				<HintTip text={`${t("skillFullTextLabel")}：${t("skillFullTextDesc")}`} />
				<span className="set-count">{settings.skills.length}</span>
			</div>
			{presetWarning && <p className="set-catalog-hint warn">{presetWarning}</p>}
			{settings.skills.length === 0 ? (
				<p className="set-empty">{t("noSkills")}</p>
			) : (
				<div className="set-list">
					{settings.skills.map((skill) => (
						<ToggleRow
							key={skill.name}
							title={skill.name}
							subtitle={skill.description}
							enabled={skill.enabled}
							onToggle={() => toggleSkill(skill.name)}
							action={
								<button
									type="button"
									className={`tpl-chip${fullTextSkills.has(skill.name) ? " on" : ""}`}
									title={t("skillFullTextDesc")}
									onClick={() => toggleFullText(skill.name)}
								>
									{t("skillFullTextShort")}
								</button>
							}
						/>
					))}
				</div>
			)}
		</div>
	);
}
