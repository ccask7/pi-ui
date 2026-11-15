import type { ReactNode } from "react";
import { useT } from "../i18n";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
	title: ReactNode;
	children: ReactNode;
	confirmLabel?: ReactNode;
	danger?: boolean;
	onConfirm: () => void;
	onClose: () => void;
}

/** Shared one-click-then-modal confirmation for destructive actions. */
export function ConfirmDialog({
	title,
	children,
	confirmLabel,
	danger = false,
	onConfirm,
	onClose,
}: ConfirmDialogProps) {
	const t = useT();
	return (
		<Modal title={title} onClose={onClose} className="confirm-dialog" backdropClassName="confirm-dialog-backdrop">
			<div className="confirm-dialog-body">{children}</div>
			<div className="dialog-actions">
				<button type="button" className="btn" onClick={onClose} autoFocus>
					{t("cancel")}
				</button>
				<button
					type="button"
					className={`btn${danger ? " danger" : " primary"}`}
					onClick={() => {
						onClose();
						onConfirm();
					}}
				>
					{confirmLabel ?? t("ok")}
				</button>
			</div>
		</Modal>
	);
}
