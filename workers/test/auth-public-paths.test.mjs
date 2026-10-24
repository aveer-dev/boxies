// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Signed-out pages: the sign-in, reset, invite and onboarding shells load
// without a session; app pages do not.
import assert from "node:assert/strict";

const { isPublicAuthPath } = await import("../lib/auth-paths.ts");

for (const path of ["/login", "/reset-password", "/invite/abc", "/onboarding", "/api/v1/auth/signup-personal"]) {
	assert.equal(isPublicAuthPath(path), true, `${path} is public`);
}
for (const path of ["/", "/admin", "/mailbox/a%40b.com", "/onboardingx", "/api/v1/mailboxes"]) {
	assert.equal(isPublicAuthPath(path), false, `${path} needs a session`);
}

console.log("auth public paths ok");
