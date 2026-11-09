package co.inboxies.app.util

import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.models.SignatureSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The mailbox signature in compose (AVE-204): a custom signature replaces the fixed
 * line, web HTML reads as words with link addresses, and a body holding only the
 * signature is not draft content. Twin of iOS `SignatureTests`.
 */
class SignatureTest {
    private fun settings(signature: SignatureSettings?) = MailboxSettings(signature = signature)

    @Test
    fun fixedLineWhenOnWithoutWords() {
        assertEquals("Sent with Inboxies Email", ComposeHtml.signatureText(settings(null), null))
        // The backend's seeded, never-configured signature counts as on.
        assertEquals("Sent with Inboxies Email", ComposeHtml.signatureText(settings(SignatureSettings(enabled = false, text = "")), null))
        assertEquals("", ComposeHtml.signatureText(settings(SignatureSettings(enabled = false, text = "Ada")), null))
    }

    @Test
    fun customSignatureReplacesFixedLine() {
        assertEquals("Ada\nCEO", ComposeHtml.signatureText(settings(SignatureSettings(enabled = true, text = "Ada\nCEO")), null))
        val web = SignatureSettings(
            enabled = true,
            text = "stale",
            html = "<p><strong>Ada</strong></p><p>CEO, <a href=\"https://ada.example\">Ada &amp; Co</a></p>",
        )
        assertEquals("Ada\nCEO, Ada & Co (https://ada.example)", ComposeHtml.signatureText(settings(web), null))
    }

    @Test
    fun htmlToTextMatchesWeb() {
        assertEquals(
            "https://ada.example",
            ComposeHtml.signatureHtmlToText("<p><a href=\"https://ada.example\">https://ada.example</a></p>"),
        )
        assertEquals(
            "ada@example.com",
            ComposeHtml.signatureHtmlToText("<a href=\"mailto:ada@example.com\">ada@example.com</a>"),
        )
        assertEquals(
            "Ada\nLine two\n• One\n• Two",
            ComposeHtml.signatureHtmlToText("<p>Ada<br>Line two</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>"),
        )
    }

    @Test
    fun signatureOnlyBodyIsNotContent() {
        val signature = "Ada\nCEO"
        assertFalse(ComposeHtml.bodyHasUserContent(ComposeHtml.bodyWithSignature(signature), signature))
        assertFalse(ComposeHtml.bodyHasUserContent("<p><br></p><p><br></p><p>Ada</p><p>CEO</p>", signature))
        assertTrue(ComposeHtml.bodyHasUserContent("<p>Hello</p><p><br></p><p>Ada</p><p>CEO</p>", signature))
    }
}
