// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Loader } from "@cloudflare/kumo";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import PrivateEmailLogo from "~/components/PrivateEmailLogo";
import api, { ApiError } from "~/services/api";

export function meta() {
	return [{ title: "Connect extension — Inboxies" }];
}

/**
 * Pairing page for the Inboxies browser extension. The extension's content
 * script answers a ping on this page; after the user clicks Connect we mint a
 * private-email-only token and hand it over with window.postMessage. The
 * extension only accepts it for an origin the user started pairing from.
 */
const PING = "inboxies:extension-ping";
const READY = "inboxies:extension-ready";
const PAIR = "inboxies:extension-pair";
const PAIRED = "inboxies:extension-paired";

type Status = "detecting" | "missing" | "ready" | "connecting" | "connected";

export default function ExtensionConnectRoute() {
	const [status, setStatus] = useState<Status>("detecting");
	const [error, setError] = useState<string | null>(null);
	const mailboxes = useQuery({
		queryKey: ["mailboxes", "extension-connect"],
		queryFn: () => api.listMailboxes(),
		retry: false,
	});
	const signedOut = mailboxes.error instanceof ApiError && [401, 403].includes(mailboxes.error.status);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== window || event.origin !== window.location.origin) return;
			const type = (event.data as { type?: string } | null)?.type;
			if (type === READY) setStatus((s) => (s === "detecting" || s === "missing" ? "ready" : s));
			if (type === PAIRED) {
				const data = event.data as { ok?: boolean; error?: string };
				if (data.ok) {
					setStatus("connected");
				} else {
					setStatus("ready");
					setError(data.error || "The extension didn't accept the connection. Start again from its Connect button.");
				}
			}
		};
		window.addEventListener("message", onMessage);
		window.postMessage({ type: PING }, window.location.origin);
		const timer = window.setTimeout(() => setStatus((s) => (s === "detecting" ? "missing" : s)), 1500);
		return () => {
			window.removeEventListener("message", onMessage);
			window.clearTimeout(timer);
		};
	}, []);

	const handleConnect = async () => {
		setError(null);
		setStatus("connecting");
		try {
			const session = await api.createExtensionSession();
			window.postMessage(
				{
					type: PAIR,
					token: session.token,
					expiresAt: session.expiresAt,
					apiUrl: window.location.origin,
					mailboxes: (mailboxes.data ?? []).map((m) => m.email),
				},
				window.location.origin,
			);
		} catch (err) {
			setStatus("ready");
			setError(err instanceof Error ? err.message : "Couldn't create an extension session.");
		}
	};

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center px-4 py-10">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-4">
				<div className="flex items-center gap-3">
					<PrivateEmailLogo size={32} className="shrink-0 text-kumo-default" />
					<h1 className="text-lg font-semibold text-kumo-default">Connect the browser extension</h1>
				</div>

				{mailboxes.isLoading ? (
					<div className="flex justify-center py-6">
						<Loader size="lg" />
					</div>
				) : signedOut ? (
					<>
						<p className="text-sm text-kumo-subtle">
							Sign in to Inboxies in this browser, then press Connect in the extension again.
						</p>
						<Link to="/login" className="text-sm text-kumo-link">
							Sign in
						</Link>
					</>
				) : status === "connected" ? (
					<div className="flex items-start gap-2 text-sm text-kumo-default" role="status">
						<CheckCircleIcon size={20} className="text-kumo-success shrink-0" aria-hidden />
						<span>Connected. You can close this tab and create private emails from any sign-up form.</span>
					</div>
				) : (
					<>
						<p className="text-sm text-kumo-subtle">
							The extension will be able to list your mailboxes and create private emails. It can't read
							or send your mail. The connection lasts 30 days.
						</p>
						{error && <Banner variant="error" text={error} />}
						{status === "missing" && (
							<Banner
								variant="error"
								text="The extension isn't responding on this page. Open it from the extension's Connect button."
							/>
						)}
						<Button
							variant="primary"
							onClick={handleConnect}
							loading={status === "connecting"}
							disabled={status !== "ready" && status !== "connecting"}
						>
							Connect
						</Button>
					</>
				)}
			</div>
		</div>
	);
}
