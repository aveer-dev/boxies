// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import AgentSidebar from "~/components/AgentSidebar";
import ComposePanel from "~/components/ComposePanel";
import { useUIStore } from "~/hooks/useUIStore";
import ColumnPane from "./ColumnPane";

/** Compose (new, reply, forward, draft edit) opens as a panel at the far right. */
export function ComposeColumn() {
	const session = useUIStore((s) => s.panelSession.compose);
	return (
		<ColumnPane
			id="compose"
			title="Compose"
			revealKey={session}
			hideHeader
			scrollBody={false}
			widthClassName="md:w-[600px]"
		>
			<ComposePanel />
		</ColumnPane>
	);
}

/** Agent chat + MCP tabs, toggled from the dock or AI Assist (⌘J). */
export function AgentColumn() {
	const closeAgentPanel = useUIStore((s) => s.closeAgentPanel);
	const session = useUIStore((s) => s.panelSession.agent);
	return (
		<ColumnPane
			id="agent"
			revealKey={session}
			title="Assistant"
			onClose={closeAgentPanel}
			closeLabel="Close assistant"
			scrollBody={false}
			bodyClassName="pb-[var(--dock-h)]"
			widthClassName="md:w-[400px]"
		>
			<AgentSidebar />
		</ColumnPane>
	);
}
