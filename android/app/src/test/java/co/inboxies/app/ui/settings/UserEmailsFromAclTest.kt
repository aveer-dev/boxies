package co.inboxies.app.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Test

class UserEmailsFromAclTest {
    @Test
    fun filtersOutSubAndAccountAndUserKeys() {
        val keys = listOf(
            "email:admin@example.com",
            "sub:google-oauth2|1029384756",
            "user:uuid-1234",
            "account:acc-5678",
            "direct@inboxies.email",
            "invalid_no_at_sign",
        )
        val extracted = userEmailsFromAcl(keys)
        assertEquals(listOf("admin@example.com", "direct@inboxies.email"), extracted)
    }

    @Test
    fun handlesNullAndEmpty() {
        assertEquals(emptyList<String>(), userEmailsFromAcl(null))
        assertEquals(emptyList<String>(), userEmailsFromAcl(emptyList()))
    }

    @Test
    fun deduplicatesCaseInsensitively() {
        val keys = listOf("email:Admin@example.com", "email:admin@example.com")
        assertEquals(listOf("Admin@example.com"), userEmailsFromAcl(keys))
    }

    @Test
    fun filtersOutAuthMethodsAndSubIds() {
        val allKeys = listOf(
            "email:admin@example.com",
            "account:acc-123",
            "sub:google-oauth2|1029384756",
            "sub:apple|12345",
            "user:usr-999",
            "jordan@example.com",
        )
        val validUserAccounts = allKeys.filter { !it.startsWith("sub:") && !it.startsWith("user:") }
        assertEquals(
            listOf("email:admin@example.com", "account:acc-123", "jordan@example.com"),
            validUserAccounts,
        )
    }
}
