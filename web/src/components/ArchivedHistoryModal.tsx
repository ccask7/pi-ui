import { useState } from "react";
import { FiArchive, FiRotateCcw, FiTrash2 } from "react-icons/fi";
import type { SessionSummary } from "../types";
import { useT } from "../i18n";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";

interface ArchivedHistoryModalProps {
	sessions: SessionSummary[];
	onClose: () => void;
	onOpen: (path: string) => void;
	onRestore: (path: string) => void;
	onDelete: (path: string) => void;
}

export function ArchivedHistoryModal({ sessions, onClose, onOpen, onRestore, onDelete }: ArchivedHistoryModalProps) {
	const t = useT();
	const [deleting, setDeleting] = useState<SessionSummary | null>(null);
	return (
		<>
			<Modal title={t("archivedHistory")} icon={<FiArchive />} onClose={onClose} className="archived-history-modal">
				{sessions.length === 0 ? (
					<div className="panel-empty">{t("noArchivedSessions")}</div>
				) : (
					<div className="archived-history-list">
						{sessions.map((session) => {
							const name = session.name || session.firstMessage.trim() || t("emptyChat");
							return (
								<div className="archived-history-row" key={session.path}>
									<button type="button" className="archived-history-open" onClick={() => onOpen(session.path)}>
										<span className="archived-history-title">{name}</span>
										<span className="archived-project">{session.cwd || session.path}</span>
									</button>
									<button
										type="button"
										className="btn"
										title={t("unarchiveSession")}
										onClick={() => onRestore(session.path)}
									>
										<FiRotateCcw /> {t("unarchiveSession")}
									</button>
									<button
										type="button"
										className="set-icon-btn danger"
										title={t("delete")}
										onClick={() => setDeleting(session)}
									>
										<FiTrash2 />
									</button>
								</div>
							);
						})}
					</div>
				)}
			</Modal>
			{deleting && (
				<ConfirmDialog
					title={t("deleteSessionTitle")}
					confirmLabel={t("delete")}
					danger
					onClose={() => setDeleting(null)}
					onConfirm={() => onDelete(deleting.path)}
				>
					{t("deleteSessionConfirmBody", { name: deleting.name || deleting.firstMessage || deleting.path })}
				</ConfirmDialog>
			)}
		</>
	);
}
