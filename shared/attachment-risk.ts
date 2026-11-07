// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Attachment risk and safe serving (AVE-114).
 *
 * Mail can carry programs and scripts (`setup.exe`, `report.pdf.exe`,
 * macro-enabled Office files). Nothing is blocked: the API marks such
 * attachments `dangerous: true` and clients show a warning and ask once more
 * before downloading.
 *
 * The flag is computed from the stored filename and the sender's declared
 * mimetype each time attachments are listed, so mail stored before this
 * change is covered without a migration. Bytes are not sniffed: they are not
 * at hand when listing, and the download headers below already stop a
 * browser from rendering or running what it fetches.
 *
 * `attachmentResponseHeaders` is the one place that decides how attachment
 * bytes go out: always a download (`Content-Disposition: attachment`),
 * `nosniff`, a sandboxing CSP, and a declared type only for raster images and
 * PDF. HTML, SVG, XML, scripts and everything else go out as
 * `application/octet-stream`.
 */

/**
 * Extensions Windows, macOS or Android will run, install, mount or open with
 * macros. Matched against the last extension only (`report.pdf.exe` → `exe`).
 */
export const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
	// Windows executables and installers
	"exe", "scr", "com", "pif", "cpl", "msi", "msp", "mst", "msc", "dll", "sys", "drv",
	"appx", "appxbundle", "msix", "msixbundle", "appinstaller", "application", "gadget",
	// Scripts and script hosts
	"bat", "cmd", "ps1", "psm1", "psd1", "ps1xml", "vb", "vbs", "vbe", "js", "jse",
	"wsf", "wsh", "wsc", "hta", "sct", "reg", "inf", "chm", "lnk", "scf", "url",
	"sh", "command",
	// Java / Android
	"jar", "jnlp", "class", "apk", "xapk", "aab",
	// Disk images (mount and run past mark-of-the-web)
	"iso", "img", "vhd", "vhdx", "dmg", "pkg", "mpkg", "app",
	// Macro-enabled Office
	"docm", "dotm", "xlsm", "xltm", "xlam", "xlsb", "pptm", "potm", "ppam", "ppsm", "sldm",
]);

/** Declared types that are programs or scripts, whatever the filename says. */
const DANGEROUS_MIME_TYPES: ReadonlySet<string> = new Set([
	"application/x-msdownload",
	"application/x-msdos-program",
	"application/x-ms-installer",
	"application/x-msi",
	"application/x-ms-shortcut",
	"application/x-dosexec",
	"application/x-executable",
	"application/vnd.microsoft.portable-executable",
	"application/x-sh",
	"application/x-csh",
	"application/x-bat",
	"application/x-msdos-batch",
	"application/hta",
	"application/x-javascript",
	"application/javascript",
	"application/ecmascript",
	"text/javascript",
	"text/ecmascript",
	"text/vbscript",
	"text/x-vbscript",
	"application/x-vbscript",
	"application/x-powershell",
	"application/java-archive",
	"application/x-java-archive",
	"application/x-java-jnlp-file",
	"application/vnd.android.package-archive",
	"application/x-iso9660-image",
	"application/x-apple-diskimage",
	"application/vnd.ms-word.document.macroenabled.12",
	"application/vnd.ms-word.template.macroenabled.12",
	"application/vnd.ms-excel.sheet.macroenabled.12",
	"application/vnd.ms-excel.template.macroenabled.12",
	"application/vnd.ms-excel.addin.macroenabled.12",
	"application/vnd.ms-excel.sheet.binary.macroenabled.12",
	"application/vnd.ms-powerpoint.presentation.macroenabled.12",
	"application/vnd.ms-powerpoint.template.macroenabled.12",
	"application/vnd.ms-powerpoint.addin.macroenabled.12",
	"application/vnd.ms-powerpoint.slideshow.macroenabled.12",
	"application/vnd.ms-powerpoint.slide.macroenabled.12",
]);

/** The only types served as themselves: raster images and PDF. */
const SAFE_SERVED_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/bmp",
	"image/heic",
	"image/heif",
	"image/tiff",
	"application/pdf",
]);

export const OCTET_STREAM = "application/octet-stream";
/** No scripts, forms, plugins or same-origin access if the response is ever rendered. */
export const ATTACHMENT_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'; frame-ancestors 'none'";

/** `Image/PNG; name=x.png` → `image/png`; empty when missing. */
export function baseMimeType(mimetype: string | null | undefined): string {
	return (mimetype ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * The extension Windows would act on: the last one, after dropping the
 * trailing dots and spaces Windows ignores (`a.exe. ` → `exe`). Bidi and
 * zero-width characters are removed so `invoice\u202Efdp.exe` reads `exe`.
 */
export function lastExtension(filename: string | null | undefined): string {
	const name = (filename ?? "")
		.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
		.replace(/[.\s]+$/, "");
	const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
	const dot = base.lastIndexOf(".");
	if (dot < 0) return "";
	return base.slice(dot + 1).toLowerCase();
}

/** Whether this attachment is a program, script, disk image or macro document. */
export function isDangerousAttachment(attachment: {
	filename?: string | null;
	mimetype?: string | null;
}): boolean {
	if (DANGEROUS_EXTENSIONS.has(lastExtension(attachment.filename))) return true;
	return DANGEROUS_MIME_TYPES.has(baseMimeType(attachment.mimetype));
}

/** Adds `dangerous` to an attachment row for API responses (additive field). */
export function withAttachmentRisk<T extends { filename?: string | null; mimetype?: string | null }>(
	attachment: T,
): T & { dangerous: boolean } {
	return { ...attachment, dangerous: isDangerousAttachment(attachment) };
}

/**
 * The Content-Type an attachment is served with: its declared type when that
 * is a raster image or PDF and the file isn't flagged, otherwise
 * `application/octet-stream`.
 */
export function servedAttachmentContentType(attachment: {
	filename?: string | null;
	mimetype?: string | null;
}): string {
	const type = baseMimeType(attachment.mimetype);
	if (!SAFE_SERVED_TYPES.has(type) || isDangerousAttachment(attachment)) return OCTET_STREAM;
	return type;
}

/** Whether the client may show this attachment as an image preview. */
export function isPreviewableImage(attachment: {
	filename?: string | null;
	mimetype?: string | null;
}): boolean {
	return servedAttachmentContentType(attachment).startsWith("image/");
}

/**
 * `Content-Disposition: attachment` with an ASCII `filename=` fallback (no
 * quotes, backslashes, control or non-ASCII characters) and the exact name
 * as RFC 5987 `filename*`.
 */
export function attachmentContentDisposition(filename: string | null | undefined): string {
	const name = filename || "attachment";
	const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
	const encoded = encodeURIComponent(name).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Every header an attachment download carries. */
export function attachmentResponseHeaders(attachment: {
	filename?: string | null;
	mimetype?: string | null;
}): Headers {
	const headers = new Headers();
	headers.set("Content-Type", servedAttachmentContentType(attachment));
	headers.set("Content-Disposition", attachmentContentDisposition(attachment.filename));
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Content-Security-Policy", ATTACHMENT_CONTENT_SECURITY_POLICY);
	return headers;
}
