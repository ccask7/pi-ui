/** Singleton non-conversation pages hosted by the chat workspace tab strip. */
export type WorkspacePageId = "settings" | "plugins" | `main:${string}`;

export function mainPanelPluginId(page: WorkspacePageId | null): string | null {
	return page?.startsWith("main:") ? page.slice(5) : null;
}
