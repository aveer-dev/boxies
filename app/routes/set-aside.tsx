// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { BookmarkSimpleIcon } from "@phosphor-icons/react";
import PileColumn from "~/components/columns/PileColumn";
import { PILE_SET_ASIDE } from "~/lib/piles";

/**
 * Column 3 for `/set-aside` (+ the reader for `:emailId`): the Set Aside
 * pile (AVE-201), mail to keep handy until you take it out. Unlike Reply
 * Later there's no reply owed, so no Focus & Reply and no reminders.
 */
export default function SetAsideRoute() {
	return (
		<PileColumn
			pileId={PILE_SET_ASIDE}
			title="Set Aside"
			icon={BookmarkSimpleIcon}
			emptyTitle="Nothing set aside"
			emptyDescription="Keep mail you need handy, like tickets or a document you're waiting on."
			removeLabel="Remove from Set Aside"
			onRemove={(email, actions) => actions.toggleSetAside(email)}
		/>
	);
}
