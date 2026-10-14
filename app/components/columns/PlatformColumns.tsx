// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import AgentSidebar from "~/components/AgentSidebar";
import ComposePanel from "~/components/ComposePanel";
import { type ComposeOptions, useUIStore } from "~/hooks/useUIStore";
import ColumnPane from "./ColumnPane";
import ReaderColumn from "./ReaderColumn";

/**
 * Compose (new, reply, forward, draft edit) opens as a panel at the far
 * right. Several can be open at once, each with its own draft.
 */
export function ComposeColumn({ panelKey, options }: { panelKey: string; options: ComposeOptions }) {
	const session = useUIStore((s) => s.panelSession[panelKey]);
	return (
		<ColumnPane
			id={panelKey}
			sizeId="compose"
			title="Compose"
			revealKey={session}
			hideHeader
			scrollBody={false}
		>
			<ComposePanel panelKey={panelKey} options={options} />
		</ColumnPane>
	);
}

/** A message opened in a column of its own (O, or the row menu), beside the reader. */
export function ExtraReaderColumn({ panelKey, emailId }: { panelKey: string; emailId: string }) {
	const closeReader = useUIStore((s) => s.closeReader);
	return <ReaderColumn emailId={emailId} columnId={panelKey} onClose={() => closeReader(panelKey)} />;
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
		>
			<AgentSidebar />
		</ColumnPane>
	);
}
