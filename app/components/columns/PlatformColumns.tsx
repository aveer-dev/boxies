// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import AgentSidebar from "~/components/AgentSidebar";
import ComposePanel from "~/components/ComposePanel";
import { useUIStore } from "~/hooks/useUIStore";
import ColumnPane from "./ColumnPane";

/** Compose (new, reply, forward, draft edit) opens right of the reader. */
export function ComposeColumn() {
	return (
		<ColumnPane
			id="compose"
			title="Compose"
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
	return (
		<ColumnPane
			id="agent"
			title="Assistant"
			onClose={closeAgentPanel}
			closeLabel="Close assistant"
			scrollBody={false}
			bodyClassName="pb-20"
			widthClassName="md:w-[400px]"
		>
			<AgentSidebar />
		</ColumnPane>
	);
}
