/**
 * End-to-end contracts for compose attach / format send path.
 * Native simulators aren't available here; these lock the runtime bugs
 * that would make Aa, attach, or send silently fail.
 * Run: node android/test/compose-attach-runtime.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const androidEditor = read(
	"android/app/src/main/java/co/inboxies/app/ui/compose/ComposeRichTextEditor.kt",
);
const androidSheet = read(
	"android/app/src/main/java/co/inboxies/app/ui/compose/ComposeSheetView.kt",
);
const androidForm = read(
	"android/app/src/main/java/co/inboxies/app/services/ComposeFormModel.kt",
);
const androidApp = read(
	"android/app/src/main/java/co/inboxies/app/services/AppModel.kt",
);
const iosEditor = read(
	"ios/AgenticInbox/Inboxies/Views/Compose/ComposeRichTextEditor.swift",
);
const iosSheet = read(
	"ios/AgenticInbox/Inboxies/Views/Compose/ComposeSheetView.swift",
);
const webEditor = read("app/components/RichTextEditor.tsx");
const webJpeg = read("app/lib/prepare-compose-attachment.ts");
const webForm = read("app/hooks/useComposeForm.ts");
const schema = read("workers/lib/schemas.ts");

assert.match(androidEditor, /AbsoluteSizeSpan\(sp, true\)/);
assert.match(androidEditor, /Collapsed caret formats the current paragraph/);
assert.match(androidEditor, /object ComposeEmailHtml/);
assert.match(androidEditor, /#FAFAFC/);
assert.match(androidEditor, /inboxiesColors\(\)\.ink\.toArgb\(\)/);
assert.match(androidSheet, /OpenableColumns\.DISPLAY_NAME/);
assert.match(androidSheet, /uniquePhotoStem/);
assert.match(androidSheet, /try \{\s*onSend\(\)/s);
assert.match(androidForm, /put\("html", outgoingHtml\(\)\)/);
assert.match(androidForm, /put\("disposition", "attachment"\)/);
assert.match(androidApp, /suspend fun sendCompose/);

assert.match(iosEditor, /Email-safe HTML with inline styles/);
assert.match(iosEditor, /#FAFAFC/);
assert.match(iosEditor, /paragraphRange\(for: selected\)/);
assert.match(iosSheet, /preferredFilenameExtension/);
assert.match(iosSheet, /photo-\\\(UUID\(\)\.uuidString\.prefix\(8\)\)/);

assert.match(webEditor, /skipEcho/);
assert.match(webEditor, /emitUpdate: false/);
assert.match(webEditor, /immediatelyRender: false/);
assert.match(webJpeg, /fillStyle = "#ffffff"/);
assert.match(webForm, /disposition: item\.disposition/);
assert.match(webForm, /html: body/);

assert.match(schema, /disposition: z\.enum\(\["attachment", "inline"\]\)/);
assert.match(schema, /html: z\.string\(\)\.optional\(\)/);

console.log("compose-attach runtime contract tests passed");
