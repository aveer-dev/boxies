package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.MailTag
import co.inboxies.app.models.TagRef
import java.text.Normalizer

/**
 * Tags (AVE-242): many per email, on top of the one folder it lives in. The API and its
 * rules are `shared/tags.ts`; these pure helpers mirror web `app/lib/tags.ts` so the
 * picker, the optimistic patches and the name checks behave the same on every client.
 * iOS twin: `MailTags.swift`.
 */
object MailTags {
    /** Longest tag name, in code points, after trimming (`TAG_NAME_MAX`). */
    const val NAME_MAX = 64

    // Worker copy (`normalizeTagName` / the tag routes), shown as-is.
    const val NAME_REQUIRED = "Tag name is required"
    const val INVALID_CHARACTERS = "Tag name contains invalid characters"
    const val NAME_TOO_LONG = "Tag name must be at most $NAME_MAX characters"
    const val DUPLICATE_NAME = "Tag with this name already exists"

    // Client copy (iOS and Android share it).
    const val TITLE = "Tags"
    const val PICKER_PLACEHOLDER = "Find or create a tag"
    const val PICKER_EMPTY = "No tags yet. Type a name to create one."
    const val LIST_EMPTY = "No tags yet. A message can have several."
    const val ADD_TAG = "Add tag"
    const val CREATE_TITLE = "New tag"
    const val RENAME_TITLE = "Rename tag"
    const val NAME_LABEL = "Tag name"
    const val DELETE_MESSAGE = "The tag comes off every email. The emails stay where they are."
    const val DELETE_BUTTON = "Delete tag"
    const val UPDATE_FAILED = "Couldn’t update tags"
    const val CREATE_FAILED = "Couldn’t create tag"
    const val RENAME_FAILED = "Couldn’t rename tag"
    const val DELETE_FAILED = "Couldn’t delete tag"
    const val VIEW_EMPTY_MESSAGE = "Add this tag to an email from its Tags menu."

    fun createRowLabel(name: String): String = "Create “$name”"
    fun deleteTitle(name: String): String = "Delete “$name”?"
    fun removedToast(name: String): String = "Removed $name"
    fun viewEmptyTitle(name: String): String = "Nothing tagged $name"
    fun unreadLabel(count: Int): String = if (count <= 0) "No unread" else "$count unread"

    sealed class NameResult {
        data class Ok(val name: String, val key: String) : NameResult()
        data class Invalid(val error: String) : NameResult()
    }

    /** Control characters and bidi overrides (zero-width joiners stay: emoji use them). */
    private val forbidden = Regex("[\\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]")
    /**
     * JS `\s`: ASCII whitespace plus the Unicode spaces. Spelled out because the JVM's
     * `\s` is ASCII-only and Android's ICU engine rejects the `(?U)` flag.
     */
    private val whitespace = Regex("[\\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+")

    /**
     * `normalizeTagName`: NFC, runs of whitespace folded to one space, trimmed, then
     * checked. `key` is the case-insensitive form that must be unique per mailbox.
     */
    fun normalizeName(raw: String?): NameResult {
        if (raw == null) return NameResult.Invalid(NAME_REQUIRED)
        val name = Normalizer.normalize(raw, Normalizer.Form.NFC).replace(whitespace, " ").trim()
        if (name.isEmpty()) return NameResult.Invalid(NAME_REQUIRED)
        if (forbidden.containsMatchIn(name)) return NameResult.Invalid(INVALID_CHARACTERS)
        if (name.codePointCount(0, name.length) > NAME_MAX) return NameResult.Invalid(NAME_TOO_LONG)
        return NameResult.Ok(name, name.lowercase())
    }

    /** Name order, as the Worker sorts them (case-insensitive, then id). */
    val order: Comparator<TagRef> = Comparator { a, b ->
        val x = a.name.lowercase()
        val y = b.name.lowercase()
        when {
            x != y -> x.compareTo(y)
            else -> a.id.compareTo(b.id)
        }
    }

    fun sorted(tags: List<MailTag>): List<MailTag> = tags.sortedWith { a, b -> order.compare(a.ref, b.ref) }

    /** `tags` with `tag` added (`on`) or removed, sorted by name. */
    fun withTag(tags: List<TagRef>?, tag: TagRef, on: Boolean): List<TagRef> {
        val rest = tags.orEmpty().filter { it.id != tag.id }
        return (if (on) rest + TagRef(tag.id, tag.name) else rest).sortedWith(order)
    }

    /** Every tag on any of `messages`, once each, sorted by name (a thread's tags). */
    fun unionTags(messages: List<Email>): List<TagRef> {
        val byId = LinkedHashMap<String, TagRef>()
        messages.forEach { message -> message.tags.orEmpty().forEach { byId[it.id] = it } }
        return byId.values.sortedWith(order)
    }

    /** The conversation key the tag routes use: `thread_id`, or the email's own id. */
    fun threadKey(email: Email): String = email.threadId?.takeIf { it.isNotEmpty() } ?: email.id

    /**
     * `emails` with `tag` added to or removed from every row of thread `threadId`
     * (tagging a thread tags all its messages). Returns `emails` itself when no row is in it.
     */
    fun patchThreadTag(emails: List<Email>, threadId: String, tag: TagRef, on: Boolean): List<Email> {
        var changed = false
        val next = emails.map { email ->
            if (threadKey(email) != threadId) {
                email
            } else {
                changed = true
                email.copy(tags = withTag(email.tags, tag, on))
            }
        }
        return if (changed) next else emails
    }

    /** `emails` with the rows of thread `threadId` set to exactly `tags` (server answer). */
    fun setThreadTags(emails: List<Email>, threadId: String, tags: List<TagRef>): List<Email> =
        emails.map { if (threadKey(it) == threadId) it.copy(tags = tags) else it }

    data class PickerOptions<T>(val matches: List<T>, val create: String?)

    /**
     * What the picker lists for what's typed: the tags whose name contains it (all of
     * them for an empty query), and the name to offer "Create" with, or null when it's
     * empty, invalid, or already a tag (names are unique case-insensitively).
     */
    fun <T> pickerOptions(tags: List<T>, query: String, name: (T) -> String): PickerOptions<T> {
        val normalized = normalizeName(query)
        val needle = query.replace(whitespace, " ").trim().lowercase()
        val matches = if (needle.isEmpty()) tags.toList() else tags.filter { name(it).lowercase().contains(needle) }
        if (normalized !is NameResult.Ok) return PickerOptions(matches, null)
        val taken = tags.any { name(it).lowercase() == normalized.key }
        return PickerOptions(matches, if (taken) null else normalized.name)
    }

    fun pickerOptions(tags: List<MailTag>, query: String): PickerOptions<MailTag> =
        pickerOptions(tags, query) { it.name }

    /** Error for a name the Worker would refuse (or a duplicate), or null. */
    fun validate(raw: String, existing: List<MailTag>, ignoringId: String? = null): String? =
        when (val result = normalizeName(raw)) {
            is NameResult.Invalid -> result.error
            is NameResult.Ok ->
                if (existing.any { it.id != ignoringId && it.name.lowercase() == result.key }) DUPLICATE_NAME else null
        }
}
