package co.inboxies.app.models

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Tracking pixels the server stripped from a body (AVE-195). */
class TrackerNoteTest {
    // Mirrors ApiClient.json.
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    @Test
    fun emailDecodesBlockedTrackers() {
        val email = json.decodeFromString<Email>(
            """{"id":"e3","folder_id":"inbox","subject":"News","sender":"a@x.com","recipient":"b@x.com",
               "date":"2026-11-09T10:00:00Z","read":true,"starred":false,"body":"<p>Hi</p>",
               "blocked_trackers":{"count":2,"services":["Mailchimp"]}}""",
        )
        assertEquals(BlockedTrackers(count = 2, services = listOf("Mailchimp")), email.blockedTrackers)
        assertEquals("Blocked tracking from Mailchimp", TrackerNote.text(email.blockedTrackers))

        val none = json.decodeFromString<Email>(
            """{"id":"e4","folder_id":"inbox","subject":"Hi","sender":"a@x.com","recipient":"b@x.com",
               "date":"2026-11-09T10:00:00Z","read":true,"starred":false,"blocked_trackers":null}""",
        )
        assertNull(none.blockedTrackers)
        // A malformed value never fails the whole email.
        val malformed = json.decodeFromString<Email>(
            """{"id":"e5","folder_id":"inbox","subject":"Hi","sender":"a@x.com","recipient":"b@x.com",
               "date":"2026-11-09T10:00:00Z","read":true,"starred":false,"blocked_trackers":"oops"}""",
        )
        assertNull(malformed.blockedTrackers)
    }

    /** Same strings as web `trackerNote` and iOS `TrackerNote.text`. */
    @Test
    fun noteMatchesSharedFixtures() {
        // Gradle runs unit tests from the module directory (android/app).
        val fixtures = Json.parseToJsonElement(File("../../shared/tracker-note.fixtures.json").readText()).jsonArray
        assertTrue(fixtures.size >= 8)
        for (element in fixtures) {
            val fixture = element.jsonObject
            val name = fixture.getValue("name").jsonPrimitive.content
            val blockedJson = fixture.getValue("blocked")
            val blocked = if (blockedJson is JsonNull) {
                null
            } else {
                val o = blockedJson.jsonObject
                BlockedTrackers(
                    count = o.getValue("count").jsonPrimitive.intOrNull ?: 0,
                    services = o.getValue("services").jsonArray.map { it.jsonPrimitive.content },
                )
            }
            val note = fixture.getValue("note").let { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }
            assertEquals(name, note, TrackerNote.text(blocked))
        }
    }
}
