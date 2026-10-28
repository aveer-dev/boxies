package co.inboxies.app.util

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** AVE-133: same fixtures as web/Worker (`workers/test/quoted-text.test.mjs`) and iOS. */
class QuotedTextTest {
    @Test
    fun matchesSharedFixtures() {
        // Gradle runs unit tests from the module directory (android/app).
        val fixtures = Json.parseToJsonElement(File("../../shared/quoted-text.fixtures.json").readText()).jsonArray
        assertTrue(fixtures.size >= 5)
        for (element in fixtures) {
            val fixture = element.jsonObject
            val name = fixture.getValue("name").jsonPrimitive.content
            val html = fixture.getValue("html").jsonPrimitive.content
            val expected = fixture.getValue("expected").jsonPrimitive.content
            assertEquals(name, expected, QuotedText.fromHtml(html))
        }
    }

    @Test
    fun quotedHtmlStaysEscapedAndClean() {
        val text = QuotedText.fromHtml("""<div style="display:none">pre&shy;header</div><p>x &lt;b&gt; &amp;shy;</p>""")
        assertEquals("x <b> &shy;", text)
        val html = ComposeHtml.quotedHtml(QuotedOriginal("On Tue, Uber wrote:", text))
        assertTrue(html.contains("x &lt;b&gt; &amp;shy;"))
        assertFalse(html.contains("preheader"))
    }
}
