package co.inboxies.app.util

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EmailHtmlSanitizerTest {
    @Test
    fun stripsScriptTags() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<p>Hello</p><script>alert(1)</script><p onclick="alert(1)">World</p>""",
        )
        assertFalse(clean.contains("<script", ignoreCase = true))
        assertFalse(clean.contains("onclick", ignoreCase = true))
        assertTrue(clean.contains("Hello"))
        assertTrue(clean.contains("World"))
    }

    @Test
    fun stripsJavascriptUrls() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<a href="javascript:alert(1)">x</a><img src="javascript:alert(1)">""",
        )
        assertFalse(clean.contains("javascript:", ignoreCase = true))
    }

    @Test
    fun stripsIframeObjectAndSvg() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<p>ok</p><iframe src="https://evil.example"></iframe><object data="https://evil.example"></object><svg onload="alert(1)"></svg>""",
        )
        assertFalse(clean.contains("<iframe", ignoreCase = true))
        assertFalse(clean.contains("<object", ignoreCase = true))
        assertFalse(clean.contains("<svg", ignoreCase = true))
        assertTrue(clean.contains("ok"))
    }

    @Test
    fun stripsStyleTagsButKeepsInlineStyles() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<style>body{display:none}</style><p style="color: red">Hi</p>""",
        )
        assertFalse(clean.contains("<style", ignoreCase = true))
        assertTrue(clean.contains("Hi"))
        assertTrue(clean.contains("color"))
    }

    @Test
    fun stripsBaseHref() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<base href="https://evil.example/"><p><a href="/phish">link</a></p>""",
        )
        assertFalse(clean.contains("<base", ignoreCase = true))
    }

    @Test
    fun stripsDangerousCss() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<p style="background: url(javascript:alert(1))">x</p>""",
        )
        assertFalse(clean.contains("javascript:", ignoreCase = true))
    }

    @Test
    fun keepsCidDataAndHttpsImages() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<img src="cid:img001"><img src="data:image/png;base64,aaaa"><img src="https://cdn.example/a.png">""",
        )
        assertTrue(clean.contains("cid:img001"))
        assertTrue(clean.contains("data:image/png"))
        assertTrue(clean.contains("https://cdn.example/a.png"))
    }

    @Test
    fun keepsTablesAndTarget() {
        val clean = EmailHtmlSanitizer.sanitize(
            """<table cellpadding="4"><tr><td>cell</td></tr></table><a href="https://example.com" target="_blank">Go</a>""",
        )
        assertTrue(clean.contains("<table"))
        assertTrue(clean.contains("cell"))
        assertTrue(clean.contains("target"))
    }

    @Test
    fun failClosedOnEmptyAfterNastinessOnly() {
        val clean = EmailHtmlSanitizer.sanitize("""<script>document.cookie</script>""")
        assertFalse(clean.contains("cookie"))
        assertFalse(clean.contains("<script", ignoreCase = true))
    }

    @Test
    fun splitsGmailQuote() {
        val split = EmailHtmlSanitizer.prepare(
            """<p>Thanks</p><div class="gmail_quote">On Mon, Bob wrote:<br>Hello</div>""",
        )
        assertTrue(split.main.contains("Thanks"))
        assertFalse(split.main.contains("gmail_quote"))
        assertNotNull(split.quote)
        assertTrue(split.quote!!.contains("Bob") || split.quote!!.contains("Hello"))
    }

    @Test
    fun splitsBlockquoteByBorder() {
        val split = EmailHtmlSanitizer.prepare(
            """<p>See you Thursday.</p><blockquote style="border-left: 2px solid #ccc">On Tue, Alex wrote:<br>Hello</blockquote>""",
        )
        assertTrue(split.main.contains("Thursday"))
        assertNotNull(split.quote)
    }

    @Test
    fun leavesUnquotedMailIntact() {
        val split = EmailHtmlSanitizer.prepare("""<p>Just a note with no prior thread.</p>""")
        assertTrue(split.main.contains("Just a note"))
        assertNull(split.quote)
    }
}
