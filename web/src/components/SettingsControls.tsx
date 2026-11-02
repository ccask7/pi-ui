import type { ReactNode } from "react";
import { useT } from "../i18n";
import { HintTip } from "./HintTip";

/** Shared enable/disable row used by settings and the capabilities panel. */
export function ToggleRow({
	title,
	subtitle,
	tip,
	enabled,
	onToggle,
	action,
	disabled,
}: {
	title: ReactNode;
	subtitle?: string;
	tip?: string;
	enabled: boolean;
	onToggle: () => void;
	action?: ReactNode;
	disabled?: boolean;
}) {
	const t = useT();
	return (
		<div className="set-row">
			<div className="set-row-info">
				<div className="set-row-name">
					{title}
					{tip && <HintTip text={tip} />}
				</div>
				{subtitle && <div className="set-row-desc">{subtitle}</div>}
			</div>
			{action}
			<button
				type="button"
				className={`set-switch ${enabled ? "on" : ""}`}
				role="switch"
				aria-checked={enabled}
				disabled={disabled}
				title={enabled ? t("settingsEnabled") : t("settingsDisabled")}
				onClick={disabled ? undefined : onToggle}
			>
				<span className="set-switch-knob" />
			</button>
		</div>
	);
}
