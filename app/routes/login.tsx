// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Text } from "@cloudflare/kumo";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import api from "~/services/api";

export function meta() {
	return [{ title: "Sign in — Inboxies" }];
}

export default function PasswordLoginRoute() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setFormError(null);
		setSubmitting(true);
		try {
			await api.passwordLogin(email.trim(), password);
			navigate("/");
		} catch (err: unknown) {
			setFormError(err instanceof Error ? err.message : "Sign in failed");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 md:p-8">
				<div className="flex items-center gap-3 mb-6">
					<img src="/favicon.svg" alt="Inboxies" className="w-9 h-9" />
					<div>
						<h1 className="text-xl font-bold text-kumo-default leading-tight">Inboxies</h1>
						<p className="text-xs text-kumo-subtle">
							Sign in to your mailbox
						</p>
					</div>
				</div>
				<form onSubmit={handleSubmit} className="space-y-4">
					{formError && (
						<Text variant="error" size="sm">
							{formError}
						</Text>
					)}
					<Input
						label="Mailbox email"
						type="email"
						size="sm"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						autoComplete="username"
					/>
					<Input
						label="Password"
						type="password"
						size="sm"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						autoComplete="current-password"
					/>
					<Button
						type="submit"
						variant="primary"
						className="w-full"
						loading={submitting}
					>
						Sign in
					</Button>
				</form>
			</div>
		</div>
	);
}
