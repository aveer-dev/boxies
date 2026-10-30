package co.inboxies.app.services

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** AVE-118: the checkout return link carries a one-time code, never a session token. */
class CheckoutReturnLinkTest {
    @Test
    fun readsDomainAndCode() {
        assertEquals(
            CheckoutReturnLink(domain = "acme.com", code = "abc123"),
            CheckoutReturnLink.parse("inboxies://onboarding/domain-ready?domain=acme.com&code=abc123"),
        )
    }

    @Test
    fun codeIsOptional() {
        assertEquals(
            CheckoutReturnLink(domain = "acme.com", code = null),
            CheckoutReturnLink.parse("inboxies://onboarding/domain-ready?domain=acme.com"),
        )
    }

    @Test
    fun ignoresLegacySessionToken() {
        val link = CheckoutReturnLink.parse(
            "inboxies://onboarding/domain-ready?domain=acme.com&session_id=cs_1&token=tok&mailbox_id=me%40acme.com",
        )
        assertEquals(CheckoutReturnLink(domain = "acme.com", code = null), link)
    }

    @Test
    fun decodesQueryValues() {
        assertEquals(
            "x y",
            CheckoutReturnLink.parse("inboxies://onboarding/domain-ready?domain=acme.com&code=x%20y")?.code,
        )
    }

    @Test
    fun acceptsHttpsOnboardingLink() {
        assertEquals(
            CheckoutReturnLink(domain = "acme.com", code = "c"),
            CheckoutReturnLink.parse("https://inboxies.email/onboarding/domain-ready?domain=acme.com&code=c"),
        )
    }

    @Test
    fun ignoresOtherLinks() {
        assertNull(CheckoutReturnLink.parse("inboxies://invite/abc"))
        assertNull(CheckoutReturnLink.parse("inboxies://billing/renewed?domain=acme.com"))
        assertNull(CheckoutReturnLink.parse("https://evil.example/onboarding/domain-ready?code=c"))
        assertNull(CheckoutReturnLink.parse("not a uri"))
    }
}
