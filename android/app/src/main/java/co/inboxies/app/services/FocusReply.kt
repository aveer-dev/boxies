package co.inboxies.app.services

import co.inboxies.app.models.Email

/**
 * One Focus & Reply pass through the Reply Later pile (AVE-193): the pile as it stood
 * when you started, minus what you've replied to or skipped. iOS twin: `FocusReplyRun`;
 * web: `app/routes/reply-later.tsx`.
 */
data class FocusReplyRun(
    /** The pile when the run started, in list order. */
    val queue: List<Email>,
    val repliedIds: Set<String> = emptySet(),
    val skippedIds: Set<String> = emptySet(),
) {
    /** Threads still to do, current first. */
    val remaining: List<Email>
        get() = queue.filter { it.id !in repliedIds && it.id !in skippedIds }

    /** The thread whose reply is open. */
    val current: Email? get() = remaining.firstOrNull()
    val total: Int get() = queue.size
    val position: Int get() = minOf(repliedIds.size + skippedIds.size + 1, maxOf(total, 1))

    /** "2 of 5". */
    val progressLabel: String get() = "$position of $total"
    val result: FocusReplyResult get() = FocusReplyResult(replied = repliedIds.size, skipped = skippedIds.size)

    fun markReplied(id: String) = copy(repliedIds = repliedIds + id, skippedIds = skippedIds - id)

    fun markSkipped(id: String) = if (id in repliedIds) this else copy(skippedIds = skippedIds + id)

    /** A failed send: the thread is back in the pile and up next. */
    fun undoReply(id: String) = copy(repliedIds = repliedIds - id)

    /** Adds threads that joined the pile after the run started to the end. */
    fun absorb(emails: List<Email>): FocusReplyRun {
        val known = queue.mapTo(HashSet()) { it.id }
        val added = emails.filter { it.replyLater && it.id !in known }
        return if (added.isEmpty()) this else copy(queue = queue + added)
    }

    companion object {
        fun start(pile: List<Email>) = FocusReplyRun(queue = pile.filter { it.replyLater })
    }
}

/** How a Focus & Reply run ended. */
data class FocusReplyResult(val replied: Int, val skipped: Int) {
    /** Line on the pile after a run that left skipped threads behind. */
    val summary: String
        get() = when (skipped) {
            0 -> "Reached the end"
            1 -> "Reached the end · 1 skipped"
            else -> "Reached the end · $skipped skipped"
        }
}
