import { memo, useEffect, useState } from "react";
import { FiAlertTriangle, FiShield } from "react-icons/fi";
import type { PermissionOption } from "../types";
import { useT } from "../i18n";
import { appSend } from "../app-globals";
import { Dropdown, DropdownItem } from "./Dropdown";

interface Props {
	/** 快照当前会话权限值（null = 尚未拉取，回落默认展示）。 */
	current: string | null;
	/** 组合选项表（空 = 运行时未就绪/legacy，不渲染）。 */
	options: PermissionOption[];
	/** 新会话默认（三档之一）。 */
	defaultPreset: string;
	/** 会话切换时重置确认态。 */
	conversationId: string;
	/** 紧凑模式：只渲染一个下拉按钮（输入框工具条内，思考强度右侧）。 */
	compact?: boolean;
}

/** 前端三档顺序（官方 workspace-write 走 ask，无应答者是死路，不提供；
 *  custom 仅展示不可点）。 */
const OFFER_ORDER = ["read-only", "workspace-write-never", "danger-full-access"];

export type PermLabelKey = "permReadOnly" | "permWorkspaceWrite" | "permFullAccess";
export type PermDescKey = "permReadOnlyDesc" | "permWorkspaceWriteDesc" | "permFullAccessDesc";

/** 前端三档顺序（设置面板默认项共用）。 */
export const PERMISSION_ORDER = ["read-only", "workspace-write-never", "danger-full-access"];

export function permLabelKey(value: string): PermLabelKey {
	if (value === "read-only") return "permReadOnly";
	if (value === "danger-full-access") return "permFullAccess";
	return "permWorkspaceWrite";
}

export function permDescKey(value: string): PermDescKey {
	if (value === "read-only") return "permReadOnlyDesc";
	if (value === "danger-full-access") return "permFullAccessDesc";
	return "permWorkspaceWriteDesc";
}

export const PermissionBar = memo(function PermissionBar({
	current,
	options,
	defaultPreset,
	conversationId,
	compact = false,
}: Props) {
	const t = useT();
	const [open, setOpen] = useState(false);
	// 完全权限二次确认态（官方同款 confirm，内联两步，关菜单/切会话即撤防）。
	const [confirmFull, setConfirmFull] = useState(false);
	useEffect(() => {
		setConfirmFull(false);
		setOpen(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [conversationId]);

	const offered = OFFER_ORDER.filter((v) => options.some((o) => o.value === v));
	if (offered.length === 0) return null;
	const effective = current ?? defaultPreset;
	const isCustom = !!current && !offered.includes(current);

	const pick = (value: string) => {
		if (value === "danger-full-access" && value !== effective && !confirmFull) {
			setConfirmFull(true);
			return;
		}
		setConfirmFull(false);
		setOpen(false);
		if (value !== effective) appSend({ type: "permission_set", preset: value });
	};

	if (compact) {
		const label = isCustom ? t("permCustom") : t(permLabelKey(effective));
		const title = isCustom ? (current ?? label) : t(permDescKey(effective));
		return (
			<Dropdown
				trigger={
					<>
						<FiShield />
						<span className="chip-sub" title={title}>
							{label}
							{effective === "danger-full-access" && <FiAlertTriangle style={{ marginLeft: 3 }} />}
						</span>
					</>
				}
				open={open}
				onOpenChange={(v) => {
					setOpen(v);
					if (!v) setConfirmFull(false);
				}}
				direction="up"
				align="left"
			>
				{offered.map((v) => {
					const opt = options.find((o) => o.value === v);
					return (
						<DropdownItem
							key={v}
							active={v === effective}
							title={opt?.description ?? t(permDescKey(v))}
							onClick={() => pick(v)}
						>
							<span className="dd-preset-name">
								{t(permLabelKey(v))}
								{v === defaultPreset && <span className="dd-preset-tag">{t("agentPresetDefaultTag")}</span>}
								{v === "danger-full-access" && <span className="dd-preset-tag warn">{t("permFullAccessTag")}</span>}
							</span>
							<span className="dd-preset-desc">{t(permDescKey(v))}</span>
						</DropdownItem>
					);
				})}
				{confirmFull && <div className="dd-note warn">{t("permConfirmFull")}</div>}
			</Dropdown>
		);
	}

	return (
		<div className="preset-bar" data-testid="permission-bar">
			<span className="preset-bar-label">
				<FiShield />
				{t("permMode")}
			</span>
			<Dropdown
				trigger={
					<span title={isCustom ? current! : t(permDescKey(effective))}>
						{isCustom ? t("permCustom") : t(permLabelKey(effective))}
						{effective === "danger-full-access" && (
							<span className="dd-preset-tag warn">
								<FiAlertTriangle /> {t("permFullAccessTag")}
							</span>
						)}
					</span>
				}
				open={open}
				onOpenChange={(v) => {
					setOpen(v);
					if (!v) setConfirmFull(false);
				}}
			>
				{offered.map((v) => {
					const opt = options.find((o) => o.value === v);
					return (
						<DropdownItem
							key={v}
							active={v === effective}
							title={opt?.description ?? t(permDescKey(v))}
							onClick={() => pick(v)}
						>
							<span className="dd-preset-name">
								{t(permLabelKey(v))}
								{v === defaultPreset && <span className="dd-preset-tag">{t("agentPresetDefaultTag")}</span>}
								{v === "danger-full-access" && <span className="dd-preset-tag warn">{t("permFullAccessTag")}</span>}
							</span>
							<span className="dd-preset-desc">{t(permDescKey(v))}</span>
						</DropdownItem>
					);
				})}
			</Dropdown>
			{confirmFull && <span className="preset-bar-hint warn">{t("permConfirmFull")}</span>}
		</div>
	);
});
