package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.FolderIds
import co.inboxies.app.utils.DateUtils
import java.time.Instant
import java.time.ZoneId

/**
 * Updates as a quiet receipts view (AVE-192, HEY's Paper Trail): compact rows
 * (sender, subject, date; no preview line) grouped by month. Mail filed here
 * never sends a push (the Worker skips it), and opening a message marks it read
 * like any other folder. Mirrors `shared/paper-trail.ts` and iOS `PaperTrail.swift`.
 */
object PaperTrail {
    /** Empty Updates; same copy as the web and iOS. */
    const val EMPTY_DESCRIPTION =
        "Receipts, confirmations and notifications, grouped by month. Mail here doesn’t send notifications."

    data class MonthSection(
        /** "month-2026-11"; "month-undated" for mail without a usable date. */
        val id: String,
        val label: String,
        val emails: List<Email>,
    )

    private val monthNames = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )

    fun isPaperTrail(folderId: String?): Boolean = folderId == FolderIds.UPDATES

    /** "November" in the current year, "November 2025" otherwise, "Earlier" without a date. */
    fun label(date: Instant?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        if (date == null) return "Earlier"
        val local = date.atZone(zone)
        val month = monthNames[local.monthValue - 1]
        return if (local.year == now.atZone(zone).year) month else "$month ${local.year}"
    }

    /** Keeps the list's order (date DESC) and starts a section whenever the month changes. */
    fun monthSections(
        emails: List<Email>,
        now: Instant = Instant.now(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<MonthSection> {
        val sections = mutableListOf<MonthSection>()
        var lastKey: String? = null
        val seen = mutableMapOf<String, Int>()
        for (email in emails) {
            val date = DateUtils.parseIso(email.date)
            val key = date?.atZone(zone)?.let { "month-%04d-%02d".format(it.year, it.monthValue) } ?: "month-undated"
            if (key == lastKey) {
                val last = sections.removeAt(sections.lastIndex)
                sections += last.copy(emails = last.emails + email)
                continue
            }
            // Ids stay unique as LazyColumn keys even if a month comes back out of order.
            val repeats = seen.getOrDefault(key, 0)
            seen[key] = repeats + 1
            sections += MonthSection(
                id = if (repeats == 0) key else "$key-$repeats",
                label = label(date, now, zone),
                emails = listOf(email),
            )
            lastKey = key
        }
        return sections
    }
}
