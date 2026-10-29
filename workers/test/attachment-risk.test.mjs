/**
 * AVE-114: dangerous-attachment flag and safe attachment download headers.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/attachment-risk.test.mjs
 */

import assert from "node:assert/strict";
import {
	ATTACHMENT_CONTENT_SECURITY_POLICY,
	OCTET_STREAM,
	attachmentContentDisposition,
	attachmentResponseHeaders,
	isDangerousAttachment,
	isPreviewableImage,
	lastExtension,
	servedAttachmentContentType,
	withAttachmentRisk,
} from "../../shared/attachment-risk.ts";

const att = (filename, mimetype = "application/octet-stream") => ({ filename, mimetype });

// ── lastExtension ────────────────────────────────────────────────
assert.equal(lastExtension("report.pdf.exe"), "exe");
assert.equal(lastExtension("SETUP.EXE"), "exe");
assert.equal(lastExtension("setup.exe. . "), "exe", "Windows drops trailing dots and spaces");
assert.equal(lastExtension("invoice‮fdp.exe"), "exe", "RTLO override doesn't hide the extension");
assert.equal(lastExtension("dir/evil.js"), "js");
assert.equal(lastExtension(".hta"), "hta");
assert.equal(lastExtension("README"), "");
assert.equal(lastExtension(""), "");
assert.equal(lastExtension(null), "");

// ── isDangerousAttachment: extensions ────────────────────────────
for (const name of [
	"setup.exe", "screensaver.scr", "run.js", "x.vbs", "go.bat", "go.cmd", "install.msi",
	"app.jar", "script.ps1", "page.hta", "disk.iso", "disk.img", "app.apk",
	"budget.docm", "budget.xlsm", "deck.pptm", "shortcut.lnk", "Mac.dmg",
]) {
	assert.equal(isDangerousAttachment(att(name)), true, `${name} is dangerous`);
}
// Double extensions: the last one decides, whatever the declared type.
assert.equal(isDangerousAttachment(att("report.pdf.exe", "application/pdf")), true);
assert.equal(isDangerousAttachment(att("photo.jpg.scr", "image/jpeg")), true);
// Case.
assert.equal(isDangerousAttachment(att("Invoice.PDF.ExE")), true);
assert.equal(isDangerousAttachment(att("Budget.XLSM")), true);
// Not dangerous: documents, images, archives, and exe-looking middles.
for (const name of [
	"report.pdf", "photo.jpg", "notes.txt", "budget.xlsx", "deck.pptx", "letter.docx",
	"archive.zip", "setup.exe.pdf", "exe", "logo.svg", "invoice.html",
]) {
	assert.equal(isDangerousAttachment(att(name)), false, `${name} is not flagged`);
}

// ── isDangerousAttachment: declared type mismatch ─────────────────
assert.equal(isDangerousAttachment(att("invoice.pdf", "application/x-msdownload")), true);
assert.equal(isDangerousAttachment(att("readme.txt", "application/javascript")), true);
assert.equal(isDangerousAttachment(att("sheet", "application/vnd.ms-excel.sheet.macroEnabled.12")), true);
assert.equal(isDangerousAttachment(att("thing", "Application/X-MSDownload; name=thing")), true);
assert.equal(isDangerousAttachment(att("photo.png", "image/png")), false);
assert.equal(isDangerousAttachment({}), false);

// ── withAttachmentRisk keeps every field and adds `dangerous` ─────
const row = { id: "a1", email_id: "e1", filename: "a.exe", mimetype: "application/pdf", size: 3, content_id: null, disposition: "attachment" };
assert.deepEqual(withAttachmentRisk(row), { ...row, dangerous: true });
assert.equal(withAttachmentRisk({ ...row, filename: "a.pdf" }).dangerous, false);

// ── servedAttachmentContentType ───────────────────────────────────
assert.equal(servedAttachmentContentType(att("photo.png", "image/png")), "image/png");
assert.equal(servedAttachmentContentType(att("photo.jpg", "IMAGE/JPEG; name=photo.jpg")), "image/jpeg");
assert.equal(servedAttachmentContentType(att("doc.pdf", "application/pdf")), "application/pdf");
assert.equal(servedAttachmentContentType(att("invoice.html", "text/html")), OCTET_STREAM);
assert.equal(servedAttachmentContentType(att("logo.svg", "image/svg+xml")), OCTET_STREAM, "SVG is not a raster image");
assert.equal(servedAttachmentContentType(att("data.xml", "application/xml")), OCTET_STREAM);
assert.equal(servedAttachmentContentType(att("data.xml", "text/xml")), OCTET_STREAM);
assert.equal(servedAttachmentContentType(att("page.xhtml", "application/xhtml+xml")), OCTET_STREAM);
assert.equal(servedAttachmentContentType(att("run.js", "text/javascript")), OCTET_STREAM);
assert.equal(servedAttachmentContentType(att("notes.txt", "text/plain")), OCTET_STREAM);
assert.equal(servedAttachmentContentType(att("report.pdf.exe", "application/pdf")), OCTET_STREAM, "flagged files never keep a safe type");
assert.equal(servedAttachmentContentType(att("x", "")), OCTET_STREAM);
assert.equal(servedAttachmentContentType({}), OCTET_STREAM);

assert.equal(isPreviewableImage(att("photo.png", "image/png")), true);
assert.equal(isPreviewableImage(att("logo.svg", "image/svg+xml")), false);
assert.equal(isPreviewableImage(att("doc.pdf", "application/pdf")), false);

// ── Content-Disposition ───────────────────────────────────────────
assert.equal(
	attachmentContentDisposition("report.pdf"),
	`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
);
assert.equal(
	attachmentContentDisposition('a"b\\c\r\n.txt'),
	`attachment; filename="a_b_c__.txt"; filename*=UTF-8''a%22b%5Cc%0D%0A.txt`,
);
assert.equal(
	attachmentContentDisposition("résumé (1).pdf"),
	`attachment; filename="r_sum_ (1).pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.pdf`,
);
assert.equal(attachmentContentDisposition(""), `attachment; filename="attachment"; filename*=UTF-8''attachment`);

// ── attachmentResponseHeaders ─────────────────────────────────────
{
	const h = attachmentResponseHeaders(att("invoice.html", "text/html"));
	assert.equal(h.get("Content-Type"), OCTET_STREAM);
	assert.equal(h.get("X-Content-Type-Options"), "nosniff");
	assert.match(h.get("Content-Disposition"), /^attachment; /);
	assert.equal(h.get("Content-Security-Policy"), ATTACHMENT_CONTENT_SECURITY_POLICY);
	assert.match(h.get("Content-Security-Policy"), /(^|;\s*)sandbox(;|$)/);
	assert.match(h.get("Content-Security-Policy"), /frame-ancestors 'none'/);
}
{
	const h = attachmentResponseHeaders(att("photo.png", "image/png"));
	assert.equal(h.get("Content-Type"), "image/png");
	assert.equal(h.get("X-Content-Type-Options"), "nosniff");
	assert.match(h.get("Content-Disposition"), /^attachment; /);
}
{
	const h = attachmentResponseHeaders(att("logo.svg", "image/svg+xml"));
	assert.equal(h.get("Content-Type"), OCTET_STREAM);
}

// ── The download route uses these headers ─────────────────────────
{
	const { readFileSync } = await import("node:fs");
	const src = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const route = src.slice(src.indexOf('app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId"'));
	const handler = route.slice(0, route.indexOf("\n});"));
	assert.match(handler, /attachmentResponseHeaders\(attachment\)/);
	assert.doesNotMatch(handler, /attachment\.mimetype/, "the sender's type is never echoed back");
}

console.log("attachment-risk tests passed");
