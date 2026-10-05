// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import ColumnCanvas from "~/components/columns/ColumnCanvas";
import { useColumnStack } from "~/hooks/useColumnStack";
import { useMailboxEvents } from "~/hooks/useMailboxEvents";
import { useMailbox } from "~/queries/mailboxes";
import { ApiError } from "~/services/api";

export default function MailboxRoute() {
	const { mailboxId, folder } = useParams<{ mailboxId: string; folder?: string }>();
	const [searchParams] = useSearchParams();
	const emailId = searchParams.get("email") || undefined;

	const navigate = useNavigate();
	const mailboxQuery = useMailbox(mailboxId);
	useMailboxEvents(mailboxId);

	const { initializeStack, selectedMailboxId, columns } = useColumnStack();

	useEffect(() => {
		if (mailboxId && (selectedMailboxId !== mailboxId || columns.length === 0)) {
			initializeStack(mailboxId, folder || "inbox", emailId);
		}
	}, [mailboxId, folder, emailId, selectedMailboxId, columns.length, initializeStack]);

	useEffect(() => {
		const err = mailboxQuery.error;
		if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
			navigate("/", { replace: true });
		}
	}, [mailboxQuery.error, navigate]);

	return <ColumnCanvas />;
}
