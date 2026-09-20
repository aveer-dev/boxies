// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, Text } from "@cloudflare/kumo";
import { type FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";

export function meta() {
	return [{ title: "Accept invite — Inboxies" }];
}

export default function InviteAcceptRoute() {
	const { token } = useParams<{ token: string }>();
	const navigate = useNavigate();
	const { data, error, isLoading } = useQuery({
		queryKey: ["invite", token],
		queryFn: () => api.getInvite(token!),
		enabled: Boolean(token),
		retry: false,
	});

	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!token) return;
		setFormError(null);
		if (password !== confirm) {
			setFormError("Passwords do not match");
			return;
		}
		if (password.length < 10) {
			setFormError("Password must be at least 10 characters");
			return;
		}
		setSubmitting(true);
		try {
			const result = await api.acceptInvite(token, {
				password,
				displayName: displayName.trim() || undefined,
			});
			navigate(`/mailbox/${encodeURIComponent(result.mailboxId)}`);
		} catch (err: unknown) {
			setFormError(err instanceof Error ? err.message : "Could not accept invite");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 md:p-8">
				<h1 className="text-xl font-bold text-kumo-default mb-1">
					Accept invite
				</h1>
				{isLoading ? (
					<div className="flex justify-center py-10">
						<Loader size="lg" />
					</div>
				) : error || !data ? (
					<p className="text-sm text-kumo-subtle mt-4">
						{(error as Error)?.message || "This invite is invalid or expired."}
					</p>
				) : (
					<>
						<p className="text-sm text-kumo-subtle mb-6">
							Set a password for{" "}
							<strong className="text-kumo-default">{data.mailboxId}</strong>
							{data.inviteeName ? ` (${data.inviteeName})` : ""}.
						</p>
						<form onSubmit={handleSubmit} className="space-y-4">
							{formError && (
								<Text variant="error" size="sm">
									{formError}
								</Text>
							)}
							<Input
								label="Display name (optional)"
								size="sm"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
							/>
							<Input
								label="Password"
								type="password"
								size="sm"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="new-password"
							/>
							<Input
								label="Confirm password"
								type="password"
								size="sm"
								value={confirm}
								onChange={(e) => setConfirm(e.target.value)}
								required
								autoComplete="new-password"
							/>
							<Button
								type="submit"
								variant="primary"
								className="w-full"
								loading={submitting}
							>
								Create account
							</Button>
						</form>
					</>
				)}
			</div>
		</div>
	);
}
