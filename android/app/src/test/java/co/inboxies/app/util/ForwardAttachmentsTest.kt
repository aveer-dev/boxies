package co.inboxies.app.util

import co.inboxies.app.models.Attachment
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.Email
import co.inboxies.app.models.Mailbox
import co.inboxies.app.services.ComposeFormModel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/** "Include N attachments" on forward (AVE-181). */
class ForwardAttachmentsTest {
    private val mailbox = Mailbox(id = "mb-1", email = "me@x.com", name = "Me")

    /** Same fixtures as web (`workers/test/forward-attachments.test.mjs`) and iOS. */
    @Test
    fun forwardableMatchesSharedFixtures() {
        // Gradle runs unit tests from the module directory (android/app).
        val fixtures = Json.parseToJsonElement(File("../../shared/forward-attachments.fixtures.json").readText()).jsonArray
        assertTrue(fixtures.size >= 10)
        for (element in fixtures) {
            val fixture = element.jsonObject
            val name = fixture.getValue("name").jsonPrimitive.content
            val body = fixture.getValue("body").jsonPrimitive.content
            val files = fixture.getValue("attachments").jsonArray.map {
                val o = it.jsonObject
                Attachment(
                    id = o.getValue("id").jsonPrimitive.content,
                    filename = o["filename"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    mimetype = o["mimetype"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    size = 10,
                    contentId = o["content_id"]?.jsonPrimitive?.contentOrNull,
                    disposition = o["disposition"]?.jsonPrimitive?.contentOrNull,
                )
            }
            val expected = fixture.getValue("forwardable").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(name, expected, ForwardAttachments.forwardable(files, body).map { it.id })
        }
    }

    @Test
    fun includeLabel() {
        assertEquals("Include 1 attachment", ForwardAttachments.includeLabel(1))
        assertEquals("Include 4 attachments", ForwardAttachments.includeLabel(4))
    }

    private fun original(vararg files: Attachment) = Email(
        id = "orig-1",
        folderId = "inbox",
        subject = "Pack",
        sender = "a@x.com",
        recipient = "me@x.com",
        date = "2026-11-01T10:00:00.000Z",
        body = "<p><img src=\"cid:logo@x\"></p>",
        attachments = files.toList(),
    )

    private val pdf = Attachment(id = "f1", filename = "pack.pdf", mimetype = "application/pdf", size = 3, disposition = "attachment")
    private val logo = Attachment(id = "logo", filename = "logo.png", mimetype = "image/png", size = 3, contentId = "<logo@x>")

    @Test
    fun forwardCarriesOnlyRealAttachmentsAndIsOnByDefault() {
        val form = ComposeFormModel(mode = ComposeMode.Forward, mailbox = mailbox, original = original(pdf, logo))
        assertEquals(listOf("f1"), form.forwardedAttachments.map { it.id })
        assertTrue(form.includeForwardedAttachments)
        assertEquals(listOf("f1"), form.sentForwardedAttachments.map { it.id })
        form.includeForwardedAttachments = false
        assertTrue(form.sentForwardedAttachments.isEmpty())
    }

    @Test
    fun replyNeverCarriesTheOriginalsFiles() {
        val form = ComposeFormModel(mode = ComposeMode.Reply, mailbox = mailbox, original = original(pdf))
        assertTrue(form.forwardedAttachments.isEmpty())
    }

    @Test
    fun forwardedFilesCountTowardTheSizeLimitOnlyWhileIncluded() {
        val big = pdf.copy(size = 5_300_000)
        val form = ComposeFormModel(mode = ComposeMode.Forward, mailbox = mailbox, original = original(big))
        assertTrue("5.3 MB is over the 5 MiB limit", form.exceedsOutboundLimit())
        form.includeForwardedAttachments = false
        assertFalse(form.exceedsOutboundLimit())
    }

    @Test
    fun loadedFilesGoFirstInThePayload() = runBlocking {
        val form = ComposeFormModel(mode = ComposeMode.Forward, mailbox = mailbox, original = original(pdf))
        form.toTokens = listOf(co.inboxies.app.models.MailAddress(email = "sam@x.com"))
        var asked: Triple<String, String, String>? = null
        val loaded = form.loadForwardedAttachments { m, e, a ->
            asked = Triple(m, e, a)
            "abc".toByteArray()
        }
        assertEquals(Triple("mb-1", "orig-1", "f1"), asked)
        val payload = form.toSendPayload(loaded)
        val sent = payload.getValue("attachments").jsonArray.single().jsonObject
        assertEquals("pack.pdf", sent.getValue("filename").jsonPrimitive.content)
        assertEquals("YWJj", sent.getValue("content").jsonPrimitive.content)
        assertEquals("attachment", sent.getValue("disposition").jsonPrimitive.content)

        form.includeForwardedAttachments = false
        assertTrue(form.loadForwardedAttachments { _, _, _ -> fail("not fetched while off"); ByteArray(0) }.isEmpty())
    }

    @Test
    fun aFailedDownloadStopsTheSend() = runBlocking {
        val form = ComposeFormModel(mode = ComposeMode.Forward, mailbox = mailbox, original = original(pdf))
        try {
            form.loadForwardedAttachments { _, _, _ -> throw java.io.IOException("offline") }
            fail("expected a failure")
        } catch (e: IllegalStateException) {
            assertEquals(ForwardAttachments.downloadError("pack.pdf"), e.message)
        }
    }
}
