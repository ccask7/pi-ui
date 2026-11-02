import { FiVolume2 } from "react-icons/fi";
import type { SoundSettings } from "../sounds";
import { useT } from "../i18n";

interface SoundSettingsProps {
	settings: SoundSettings;
	onChange: (settings: SoundSettings) => void;
}

const SOUND_EVENTS: {
	kind: "done" | "error";
	labelKey: "sound.done" | "sound.error";
	descKey: "sound.done.desc" | "sound.error.desc";
}[] = [
	{ kind: "done", labelKey: "sound.done", descKey: "sound.done.desc" },
	{ kind: "error", labelKey: "sound.error", descKey: "sound.error.desc" },
];

export function SoundSettingsPanel({ settings, onChange }: SoundSettingsProps) {
	const t = useT();
	const toggle = (patch: Partial<SoundSettings>) => onChange({ ...settings, ...patch });

	return (
		<div className="sound-menu">
			<div className="dd-header">{t("soundHeader")}</div>

			<label className="sound-row sound-master">
				<span className="sound-label">
					<FiVolume2 className="sound-icon" />
					<span>{t("enableSound")}</span>
				</span>
				<input type="checkbox" checked={settings.enabled} onChange={(e) => toggle({ enabled: e.target.checked })} />
			</label>

			{SOUND_EVENTS.map(({ kind, labelKey, descKey }) => (
				<label key={kind} className={`sound-row ${settings.enabled ? "" : "disabled"}`}>
					<span className="sound-label">
						<span className="sound-name">{t(labelKey)}</span>
						<span className="sound-desc">{t(descKey)}</span>
					</span>
					<input
						type="checkbox"
						checked={settings[kind]}
						disabled={!settings.enabled}
						onChange={(e) => toggle({ [kind]: e.target.checked })}
					/>
				</label>
			))}

			<div className={`sound-volume ${settings.enabled ? "" : "disabled"}`}>
				<span className="sound-name">{t("volume")}</span>
				<input
					type="range"
					min={0}
					max={100}
					step={5}
					value={settings.volume}
					disabled={!settings.enabled}
					onChange={(e) => toggle({ volume: Number(e.target.value) })}
				/>
				<span className="sound-vol-num">{settings.volume}%</span>
			</div>
		</div>
	);
}
