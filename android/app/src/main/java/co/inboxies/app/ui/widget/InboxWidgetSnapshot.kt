package co.inboxies.app.ui.widget

import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * What the "Today's inbox" widget draws (AVE-138, built in AVE-150). The app writes it
 * as JSON (`InboxWidgetStore`, one per mailbox) whenever the Inbox refreshes, and the
 * Glance widget reads it back. iOS twin: `InboxWidgetSnapshot.swift` (App Group
 * snapshot); the JSON shape is the same (sorted keys, dates as seconds since 1970).
 */
data class InboxWidgetSnapshot(
    val mailboxId: String,
    val mailboxAddress: String,
    /** Count of New conversations in the Inbox (same number as the Inbox "New" section). */
    val newCount: Int,
    val replyLaterCount: Int,
    /** Newest New threads, at most [MAX_THREADS] (five). 4×2 lists three, the 2×2 avatar stack shows three, the depth card stack flips through all of them. */
    val threads: List<Thread>,
    val updatedAt: ZonedDateTime,
) {
    data class Thread(
        /** Thread id, for the tap-to-open deep link. */
        val id: String,
        val senderName: String,
        val subject: String,
        val receivedAt: ZonedDateTime,
    )

    val isInboxZero: Boolean get() = newCount == 0

    companion object {
        const val MAX_THREADS = 5

        /**
         * Copy under "Inbox zero". One line per day, picked by day of the year.
         * Same lines and order as iOS.
         */
        val inboxZeroLines = listOf(
            "Nothing new. Enjoy the quiet.",
            "All caught up. Go make something.",
            "Clear skies in your inbox.",
            "That's everything. Nice work.",
        )

        fun inboxZeroLine(on: ZonedDateTime): String =
            inboxZeroLines[(on.dayOfYear - 1) % inboxZeroLines.size]

        // Sample data (design mocks only; no networking). 9:41 keeps shots deterministic.
        private val sampleNow: ZonedDateTime =
            LocalDateTime.of(2026, 10, 28, 9, 41).atZone(ZoneId.systemDefault())

        val SampleHasMail = InboxWidgetSnapshot(
            mailboxId = "mb-preview",
            mailboxAddress = "you@inboxies.email",
            newCount = 7,
            replyLaterCount = 2,
            threads = listOf(
                Thread("t-1", "Maya Chen", "Q3 roadmap: final draft for review", sampleNow.minusMinutes(4)),
                Thread("t-2", "Jonas Weber", "Dinner on Friday?", sampleNow.minusMinutes(38)),
                Thread("t-3", "Priya Natarajan", "Contract signed, next steps", sampleNow.minusMinutes(95)),
                Thread("t-4", "Leo Martins", "Photos from the offsite", sampleNow.minusMinutes(140)),
                Thread("t-5", "Ada Okafor", "Can we move our 1:1 to Thursday?", sampleNow.minusMinutes(185)),
            ),
            updatedAt = sampleNow,
        )

        val SampleInboxZero = InboxWidgetSnapshot(
            mailboxId = "mb-preview",
            mailboxAddress = "you@inboxies.email",
            newCount = 0,
            replyLaterCount = 2,
            threads = emptyList(),
            updatedAt = sampleNow,
        )
    }
}
