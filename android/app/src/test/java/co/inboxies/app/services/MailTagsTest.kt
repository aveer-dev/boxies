package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.EmailListResponse
import co.inboxies.app.models.MailTag
import co.inboxies.app.models.TagListResponse
import co.inboxies.app.models.TagRef
import co.inboxies.app.models.ThreadTagsResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tags (AVE-242): the Worker contract in shared/tags.ts and web's app/lib/tags.ts helpers. */
class MailTagsTest {
    // Mirrors ApiClient.json.
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    private val clients = TagRef("t1", "Clients")
    private val q3 = TagRef("t2", "q3 planning")

    // Payloads

    @Test
    fun emailDecodesTagsAndToleratesOlderWorkers() {
        val tagged = json.decodeFromString<Email>(
            """{"id":"e1","thread_id":"th1","subject":"Hi","tags":[{"id":"t1","name":"Clients"}]}""",
        )
        assertEquals(listOf(clients), tagged.tags)
        val old = json.decodeFromString<Email>("""{"id":"e2","subject":"Hi"}""")
        assertNull(old.tags)
        val nulled = json.decodeFromString<Email>("""{"id":"e3","tags":null}""")
        assertTrue(nulled.tags.isNullOrEmpty())
    }

    @Test
    fun tagRoutesDecode() {
        val list = json.decodeFromString<TagListResponse>(
            """{"tags":[{"id":"t1","name":"Clients","emailCount":3,"unreadCount":1,
               "createdAt":"2026-11-10T00:00:00Z","updatedAt":"2026-11-10T00:00:00Z"}]}""",
        )
        assertEquals(listOf(MailTag("t1", "Clients", emailCount = 3, unreadCount = 1)), list.tags)

        val thread = json.decodeFromString<ThreadTagsResponse>(
            """{"threadId":"th1","tags":[{"id":"t1","name":"Clients"}],"emailIds":["e1","e2"]}""",
        )
        assertEquals("th1", thread.threadId)
        assertEquals(listOf(clients), thread.tags)
        assertEquals(listOf("e1", "e2"), thread.emailIds)

        val page = json.decodeFromString<EmailListResponse>(
            """{"emails":[{"id":"e1","tags":[{"id":"t1","name":"Clients"}],"thread_count":2}],"totalCount":1}""",
        )
        assertEquals(1, page.totalCount)
        assertEquals(listOf(clients), page.emails.single().tags)
    }

    @Test
    fun pathsEncodeEverySegment() {
        val api = ApiClient.shared
        assertEquals("/api/v1/mailboxes/me%40acme.com/tags", api.tagsPath("me@acme.com"))
        assertEquals("/api/v1/mailboxes/me%40acme.com/tags/t%2F1", api.tagPath("me@acme.com", "t/1"))
        assertEquals(
            "/api/v1/mailboxes/me%40acme.com/threads/%3Cid%40x%3E/tags/t1",
            api.threadTagPath("me@acme.com", "<id@x>", "t1"),
        )
        assertEquals(mapOf("threaded" to "true", "page" to "2", "limit" to "25"), api.taggedEmailsQuery(2))
    }

    // Names (`normalizeTagName`)

    @Test
    fun normalizeNameMatchesWorker() {
        assertEquals(MailTags.NameResult.Ok("Q3 planning", "q3 planning"), MailTags.normalizeName("  Q3 \t  planning "))
        assertEquals(MailTags.NameResult.Invalid("Tag name is required"), MailTags.normalizeName("   "))
        assertEquals(MailTags.NameResult.Invalid("Tag name is required"), MailTags.normalizeName(null))
        assertEquals(MailTags.NameResult.Invalid("Tag name contains invalid characters"), MailTags.normalizeName("a\u0007b"))
        assertEquals(MailTags.NameResult.Invalid("Tag name contains invalid characters"), MailTags.normalizeName("evil\u202Etxt"))
        assertEquals(MailTags.NameResult.Invalid("Tag name must be at most 64 characters"), MailTags.normalizeName("x".repeat(65)))
        // Code points, not UTF-16 units: 64 emoji fit.
        assertTrue(MailTags.normalizeName("🎉".repeat(64)) is MailTags.NameResult.Ok)
        // NFC: a decomposed é is the same name as the composed one.
        assertEquals("caf\u00e9", (MailTags.normalizeName("cafe\u0301") as MailTags.NameResult.Ok).name)
    }

    @Test
    fun validateFlagsCaseInsensitiveDuplicates() {
        val existing = listOf(MailTag("t1", "Clients"), MailTag("t2", "Personal"))
        assertEquals(MailTags.DUPLICATE_NAME, MailTags.validate("clients ", existing))
        assertNull(MailTags.validate("CLIENTS", existing, ignoringId = "t1"))
        assertNull(MailTags.validate("Travel", existing))
    }

    // Picker

    @Test
    fun pickerOptionsFilterAndOfferCreate() {
        val tags = listOf(MailTag("t1", "Clients"), MailTag("t2", "Client calls"), MailTag("t3", "Personal"))
        val all = MailTags.pickerOptions(tags, "")
        assertEquals(3, all.matches.size)
        assertNull(all.create)

        val partial = MailTags.pickerOptions(tags, "client")
        assertEquals(listOf("t1", "t2"), partial.matches.map { it.id })
        assertEquals("client", partial.create)

        // Taken case-insensitively: no Create row.
        assertNull(MailTags.pickerOptions(tags, "  CLIENTS ").create)
        assertEquals("Travel plans", MailTags.pickerOptions(tags, " Travel   plans ").create)
        assertNull(MailTags.pickerOptions(tags, "x".repeat(65)).create)
    }

    // Optimistic patches

    @Test
    fun withTagAddsRemovesAndSorts() {
        assertEquals(listOf(clients, q3), MailTags.withTag(listOf(q3), clients, on = true))
        assertEquals(listOf(q3), MailTags.withTag(listOf(clients, q3), clients, on = false))
        // Idempotent, like PUT / DELETE.
        assertEquals(listOf(clients), MailTags.withTag(listOf(clients), clients, on = true))
        assertEquals(emptyList<TagRef>(), MailTags.withTag(null, clients, on = false))
    }

    @Test
    fun patchThreadTagTouchesOnlyThatConversation() {
        val a1 = Email(id = "a1", threadId = "A")
        val a2 = Email(id = "a2", threadId = "A", tags = listOf(q3))
        val b = Email(id = "b1", threadId = "B")
        val loose = Email(id = "solo")
        val patched = MailTags.patchThreadTag(listOf(a1, a2, b, loose), "A", clients, on = true)
        assertEquals(listOf(clients), patched[0].tags)
        assertEquals(listOf(clients, q3), patched[1].tags)
        assertSame(b, patched[2])
        // Mail without a thread id is its own conversation, keyed by its id.
        assertEquals(listOf(clients), MailTags.patchThreadTag(listOf(loose), "solo", clients, true).single().tags)
        val untouched = listOf(b)
        assertSame(untouched, MailTags.patchThreadTag(untouched, "A", clients, on = true))
    }

    @Test
    fun unionTagsDedupesAndSortsByName() {
        val messages = listOf(
            Email(id = "1", tags = listOf(q3)),
            Email(id = "2", tags = listOf(clients, q3)),
            Email(id = "3"),
        )
        assertEquals(listOf(clients, q3), MailTags.unionTags(messages))
    }

    @Test
    fun threadKeyFallsBackToTheEmailId() {
        assertEquals("th", MailTags.threadKey(Email(id = "e", threadId = "th")))
        assertEquals("e", MailTags.threadKey(Email(id = "e", threadId = "")))
        assertEquals("e", MailTags.threadKey(Email(id = "e")))
    }

    @Test
    fun cacheFollowsThreadTagsAndDeletes() {
        val db = DatabaseService.shared
        db.clearAll()
        db.upsertEmails("mb", listOf(Email(id = "a1", threadId = "A"), Email(id = "a2", threadId = "A"), Email(id = "b1", threadId = "B")))
        db.updateThreadTags("mb", "A") { MailTags.withTag(it, clients, true) }
        assertEquals(listOf(clients), db.getEmail("a1")?.tags)
        assertEquals(listOf(clients), db.getEmail("a2")?.tags)
        assertTrue(db.getEmail("b1")?.tags.isNullOrEmpty())
        // One row per conversation, like the tag view's server list.
        assertEquals(1, db.getTaggedEmails("mb", "t1").size)

        db.updateTagEverywhere("mb", "t1", "Key clients")
        assertEquals("Key clients", db.getEmail("a1")?.tags?.single()?.name)
        db.updateTagEverywhere("mb", "t1", null)
        assertTrue(db.getEmail("a1")?.tags.isNullOrEmpty())
        db.clearAll()
    }

    @Test
    fun copyMatchesIos() {
        assertEquals("Create “Travel”", MailTags.createRowLabel("Travel"))
        assertEquals("Delete “Clients”?", MailTags.deleteTitle("Clients"))
        assertEquals("Nothing tagged Clients", MailTags.viewEmptyTitle("Clients"))
        assertEquals("No unread", MailTags.unreadLabel(0))
        assertEquals("2 unread", MailTags.unreadLabel(2))
    }
}
