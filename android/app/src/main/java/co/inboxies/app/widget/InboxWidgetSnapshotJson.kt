package co.inboxies.app.widget

import co.inboxies.app.models.Email
import co.inboxies.app.models.Mailbox
import co.inboxies.app.services.EmailPaging
import co.inboxies.app.ui.widget.InboxWidgetSnapshot
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonUnquotedLiteral
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.math.roundToLong

/**
 * JSON for [InboxWidgetSnapshot] (AVE-150), the same shape iOS writes to the App Group
 * (AVE-149): sorted keys, dates as seconds since 1970.
 *
 * ```
 * {"mailboxAddress":"…","mailboxId":"…","newCount":7,"replyLaterCount":2,
 *  "threads":[{"id":"…","receivedAt":1761644460,"senderName":"…","subject":"…"}],
 *  "updatedAt":1761644460}
 * ```
 */
object InboxWidgetSnapshotJson {
    private val json = Json { ignoreUnknownKeys = true }

    @OptIn(ExperimentalSerializationApi::class)
    fun encode(snapshot: InboxWidgetSnapshot): String = buildJsonObject {
        put("mailboxAddress", JsonPrimitive(snapshot.mailboxAddress))
        put("mailboxId", JsonPrimitive(snapshot.mailboxId))
        put("newCount", JsonPrimitive(snapshot.newCount))
        put("replyLaterCount", JsonPrimitive(snapshot.replyLaterCount))
        put(
            "threads",
            buildJsonArray {
                snapshot.threads.forEach { thread ->
                    add(
                        buildJsonObject {
                            put("id", JsonPrimitive(thread.id))
                            put("receivedAt", JsonUnquotedLiteral(epochSeconds(thread.receivedAt)))
                            put("senderName", JsonPrimitive(thread.senderName))
                            put("subject", JsonPrimitive(thread.subject))
                        },
                    )
                }
            },
        )
        put("updatedAt", JsonUnquotedLiteral(epochSeconds(snapshot.updatedAt)))
    }.toString()

    /** Null when [text] isn't a snapshot (corrupt or from an incompatible build). */
    fun decode(text: String, zone: ZoneId = ZoneId.systemDefault()): InboxWidgetSnapshot? = runCatching {
        val root = json.parseToJsonElement(text).jsonObject
        InboxWidgetSnapshot(
            mailboxId = root.string("mailboxId"),
            mailboxAddress = root.string("mailboxAddress"),
            newCount = root.getValue("newCount").jsonPrimitive.int,
            replyLaterCount = root.getValue("replyLaterCount").jsonPrimitive.int,
            threads = root.getValue("threads").jsonArray.map { element ->
                val thread = element.jsonObject
                InboxWidgetSnapshot.Thread(
                    id = thread.string("id"),
                    senderName = thread.string("senderName"),
                    subject = thread.string("subject"),
                    receivedAt = dateFrom(thread.getValue("receivedAt").jsonPrimitive.double, zone),
                )
            }.take(InboxWidgetSnapshot.MAX_THREADS),
            updatedAt = dateFrom(root.getValue("updatedAt").jsonPrimitive.double, zone),
        )
    }.getOrNull()

    private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

    /** Seconds since 1970 with millisecond precision, never in exponent form. */
    private fun epochSeconds(date: ZonedDateTime): String =
        BigDecimal.valueOf(date.toInstant().toEpochMilli(), 3).stripTrailingZeros().toPlainString()

    private fun dateFrom(seconds: Double, zone: ZoneId): ZonedDateTime =
        Instant.ofEpochMilli((seconds * 1000).roundToLong()).atZone(zone)
}

/** Same mail, counts and order; `updatedAt` is ignored (iOS `hasSameContent(as:)`). */
fun InboxWidgetSnapshot.hasSameContent(other: InboxWidgetSnapshot): Boolean = contentKey == other.contentKey

/**
 * A short fingerprint of what the widget shows (not `updatedAt`). The deck position is
 * stored with the key it was set on, so a new snapshot puts the deck back on card 1.
 */
val InboxWidgetSnapshot.contentKey: String
    get() {
        val text = buildString {
            append(mailboxId).append('\u001f').append(mailboxAddress).append('\u001f')
            append(newCount).append('\u001f').append(replyLaterCount)
            threads.forEach { thread ->
                append('\u001e').append(thread.id)
                append('\u001f').append(thread.senderName)
                append('\u001f').append(thread.subject)
                append('\u001f').append(thread.receivedAt.toInstant().toEpochMilli())
            }
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        return digest.take(12).joinToString("") { "%02x".format(it) }
    }

/**
 * The widget's view of an Inbox: the same New rows and New total the Inbox's New section
 * shows ([EmailPaging.inboxNewPreview]), newest first, up to five. iOS twin:
 * `InboxWidgetSnapshot.make(mailbox:inboxRows:serverNewCount:replyLaterCount:)`.
 */
fun InboxWidgetSnapshot.Companion.make(
    mailbox: Mailbox,
    inboxRows: List<Email>,
    serverNewCount: Int?,
    replyLaterCount: Int,
    now: ZonedDateTime = ZonedDateTime.now(),
): InboxWidgetSnapshot {
    val newRows = inboxRows.filter { it.resolvedListSection == "new" }
    val preview = EmailPaging.inboxNewPreview(newRows, serverNewCount, limit = InboxWidgetSnapshot.MAX_THREADS)
    val threads = preview.shown.map { email ->
        InboxWidgetSnapshot.Thread(
            id = email.id,
            senderName = email.displaySender,
            subject = email.subject.ifBlank { "(no subject)" },
            receivedAt = email.parsedDate?.toInstant()?.atZone(now.zone) ?: now,
        )
    }
    return InboxWidgetSnapshot(
        mailboxId = mailbox.id,
        mailboxAddress = mailbox.email,
        newCount = preview.shown.size + preview.hiddenCount,
        replyLaterCount = maxOf(0, replyLaterCount),
        threads = threads,
        updatedAt = now,
    )
}
