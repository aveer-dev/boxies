package co.inboxies.app.services

import co.inboxies.app.models.Email
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** AVE-192: Updates groups receipts by month (iOS twin: PaperTrailTests; web: paper-trail.test.mjs). */
class PaperTrailTest {
    private val zone = ZoneId.of("America/New_York")
    private val now = Instant.parse("2026-11-10T17:00:00Z")

    private fun email(id: String, date: String) = Email(id = id, subject = id, date = date)

    @Test
    fun onlyUpdatesIsPaperTrail() {
        assertTrue(PaperTrail.isPaperTrail("updates"))
        assertFalse(PaperTrail.isPaperTrail("inbox"))
        assertFalse(PaperTrail.isPaperTrail("promotions"))
        assertFalse(PaperTrail.isPaperTrail(null))
    }

    @Test
    fun labelsDropTheCurrentYear() {
        assertEquals("November", PaperTrail.label(Instant.parse("2026-11-03T17:00:00Z"), now, zone))
        assertEquals("January", PaperTrail.label(Instant.parse("2026-01-15T17:00:00Z"), now, zone))
        assertEquals("December 2025", PaperTrail.label(Instant.parse("2025-12-15T17:00:00Z"), now, zone))
        assertEquals("Earlier", PaperTrail.label(null, now, zone))
    }

    @Test
    fun groupsConsecutiveMailByMonth() {
        val sections = PaperTrail.monthSections(
            listOf(
                email("a", "2026-11-09T17:00:00.000Z"),
                email("b", "2026-11-02T17:00:00Z"),
                email("c", "2026-10-30T17:00:00.000Z"),
                email("d", "2025-10-15T17:00:00.000Z"),
                email("e", "2025-10-01T17:00:00.000Z"),
            ),
            now,
            zone,
        )
        assertEquals(listOf("November", "October", "October 2025"), sections.map { it.label })
        assertEquals(listOf("month-2026-11", "month-2026-10", "month-2025-10"), sections.map { it.id })
        assertEquals(listOf(listOf("a", "b"), listOf("c"), listOf("d", "e")), sections.map { s -> s.emails.map { it.id } })
    }

    @Test
    fun undatedMailGoesUnderEarlierAndIdsStayUnique() {
        val sections = PaperTrail.monthSections(
            listOf(
                email("a", "2026-11-09T17:00:00.000Z"),
                email("b", "not a date"),
                email("c", "2026-11-01T17:00:00.000Z"),
            ),
            now,
            zone,
        )
        assertEquals(listOf("November", "Earlier", "November"), sections.map { it.label })
        assertEquals(3, sections.map { it.id }.toSet().size)
        assertTrue(PaperTrail.monthSections(emptyList(), now, zone).isEmpty())
    }
}
