package co.inboxies.app.util

import co.inboxies.app.models.Attachment
import java.util.Base64

/**
 * Which of an original's files a forward carries (AVE-181). Same rule as web
 * `shared/forward-attachments.ts` and iOS `ForwardAttachments`, checked against
 * `shared/forward-attachments.fixtures.json`.
 *
 * Inline `cid:` images that are part of the body are not attachments: they are
 * left out of "Include N attachments" and never sent as files.
 */
object ForwardAttachments {
    private val imageMime = Regex("^image/[a-z0-9][a-z0-9.+-]*$")

    /** The original's real attachments, in order. */
    fun forwardable(attachments: List<Attachment>?, body: String?): List<Attachment> =
        attachments.orEmpty().filterNot { isInlineBodyPart(it, body) }

    /** `Content-Disposition: inline` (the reader hides these too), or an image the body shows via `cid:`. */
    fun isInlineBodyPart(attachment: Attachment, body: String?): Boolean {
        if (attachment.disposition?.trim()?.lowercase() == "inline") return true
        val cid = attachment.normalizedContentId ?: return false
        return isImageMime(attachment.mimetype) && referencesContentId(body.orEmpty(), cid)
    }

    /** "Include 1 attachment" / "Include 3 attachments". */
    fun includeLabel(count: Int): String =
        "Include $count ${if (count == 1) "attachment" else "attachments"}"

    /** `image/png; name=x.png` counts; anything that isn't a plain image type doesn't. */
    fun isImageMime(mimetype: String): Boolean =
        imageMime.matches(mimetype.substringBefore(';').trim().lowercase())

    /** `cid:<id>` or `cid:id` as a whole reference: `cid:img1` doesn't match inside `cid:img10`. */
    fun referencesContentId(body: String, cid: String): Boolean {
        if (body.isEmpty() || cid.isEmpty()) return false
        val pattern = "cid:(?:&lt;|<)?" + Regex.escape(cid) + "(?:&gt;|>)?(?=$|[\"'\\s)\\],;&<>])"
        return Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(body)
    }

    /** A downloaded original file, ready to send like any other attachment. */
    fun pending(attachment: Attachment, bytes: ByteArray): ComposePendingAttachment =
        ComposePendingAttachment(
            filename = attachment.filename.ifBlank { "attachment" },
            mimeType = attachment.mimetype.trim().ifEmpty { "application/octet-stream" },
            size = bytes.size,
            base64 = Base64.getEncoder().encodeToString(bytes),
        )

    fun downloadError(filename: String): String =
        "Couldn't attach $filename. Try again, or turn off the attachments."
}
