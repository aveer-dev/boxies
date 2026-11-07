// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader } from "@cloudflare/kumo";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { isSettingsPageId } from "~/components/settings/pages";
import { readLastMailbox } from "~/lib/last-mailbox";
import { useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";

/**
 * `/settings/:page?`: a settings link that names no mailbox, like the
 * "wasn't me" link in security emails (`/settings/sign-in`). Settings opens
 * beside a mailbox, so this goes to the last one used here (else the first);
 * with no mailbox at all, to the mailbox list.
 */
export default function AccountSettingsRoute() {
	const { page } = useParams<{ page?: string }>();
	const navigate = useNavigate();
	const { data: mailboxes, isFetched } = useMailboxes();
	const { data: me, isFetched: meFetched } = useQuery({
		queryKey: ["me"],
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});

	useEffect(() => {
		if (!isFetched || !meFetched) return;
		const ids = (mailboxes ?? []).map((m) => m.id);
		const remembered = readLastMailbox(me?.userId);
		const target = remembered && ids.includes(remembered) ? remembered : ids[0];
		if (!target) {
			navigate("/", { replace: true });
			return;
		}
		const sub = isSettingsPageId(page) ? `/${page}` : "";
		navigate(`/mailbox/${encodeURIComponent(target)}/settings${sub}`, { replace: true });
	}, [isFetched, meFetched, mailboxes, me?.userId, page, navigate]);

	return (
		<div className="flex min-h-screen items-center justify-center">
			<Loader />
		</div>
	);
}
