package co.inboxies.app.autofill

import android.text.InputType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EmailFieldMatcherTest {
    private val text = InputType.TYPE_CLASS_TEXT
    private val emailInput = text or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
    private val webEmailInput = text or InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS

    @Test
    fun matchesEmailAutofillHints() {
        assertTrue(EmailFieldMatcher.isEmailField(AutofillFieldInfo(autofillHints = listOf("emailAddress"))))
        assertTrue(EmailFieldMatcher.isEmailField(AutofillFieldInfo(autofillHints = listOf("EMAIL"))))
        assertFalse(EmailFieldMatcher.isEmailField(AutofillFieldInfo(autofillHints = listOf("username"))))
    }

    @Test
    fun matchesHtmlTypeEmail() {
        assertTrue(EmailFieldMatcher.isEmailField(AutofillFieldInfo(htmlType = "email")))
        assertTrue(EmailFieldMatcher.isEmailField(AutofillFieldInfo(htmlType = " Email ")))
        assertFalse(EmailFieldMatcher.isEmailField(AutofillFieldInfo(htmlType = "text")))
    }

    @Test
    fun matchesTextEmailVariationsOnly() {
        assertTrue(EmailFieldMatcher.isEmailField(AutofillFieldInfo(inputType = emailInput)))
        assertTrue(EmailFieldMatcher.isEmailField(AutofillFieldInfo(inputType = webEmailInput)))
        // Flags on top of the variation don't matter.
        assertTrue(
            EmailFieldMatcher.isEmailField(
                AutofillFieldInfo(inputType = emailInput or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS),
            ),
        )
        assertFalse(EmailFieldMatcher.isEmailField(AutofillFieldInfo(inputType = text)))
        assertFalse(
            EmailFieldMatcher.isEmailField(
                AutofillFieldInfo(inputType = text or InputType.TYPE_TEXT_VARIATION_PERSON_NAME),
            ),
        )
        // Same variation bits under another class are not email.
        assertFalse(
            EmailFieldMatcher.isEmailField(
                AutofillFieldInfo(inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS),
            ),
        )
    }

    @Test
    fun ignoresLooseTextSignals() {
        // No label / id heuristics: a plain text field is never an email field.
        assertFalse(EmailFieldMatcher.isEmailField(AutofillFieldInfo(inputType = text)))
        assertFalse(EmailFieldMatcher.isEmailField(AutofillFieldInfo()))
    }

    @Test
    fun neverMatchesPasswords() {
        val passwordInputs = listOf(
            text or InputType.TYPE_TEXT_VARIATION_PASSWORD,
            text or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            text or InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
            InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD,
        )
        passwordInputs.forEach { inputType ->
            val field = AutofillFieldInfo(inputType = inputType, autofillHints = listOf("emailAddress"))
            assertTrue(EmailFieldMatcher.isPasswordField(field))
            assertFalse(EmailFieldMatcher.isEmailField(field))
        }
        assertFalse(
            EmailFieldMatcher.isEmailField(
                AutofillFieldInfo(htmlType = "password", autofillHints = listOf("email")),
            ),
        )
        assertFalse(
            EmailFieldMatcher.isEmailField(
                AutofillFieldInfo(autofillHints = listOf("emailAddress", "newPassword"), inputType = emailInput),
            ),
        )
    }

    @Test
    fun skipsHiddenFields() {
        assertFalse(EmailFieldMatcher.isEmailField(AutofillFieldInfo(htmlType = "email", isVisible = false)))
    }

    @Test
    fun targetsPutFocusedFieldFirstAndKeepOtherEmails() {
        val fields = listOf(
            "name" to AutofillFieldInfo(inputType = text or InputType.TYPE_TEXT_VARIATION_PERSON_NAME),
            "email" to AutofillFieldInfo(htmlType = "email"),
            "password" to AutofillFieldInfo(htmlType = "password", isFocused = false),
            "confirm" to AutofillFieldInfo(htmlType = "email", isFocused = true),
        )
        assertEquals(listOf("confirm", "email"), EmailFieldMatcher.emailTargets(fields))
    }

    @Test
    fun targetsEmptyWithoutEmailFields() {
        val fields = listOf(
            "user" to AutofillFieldInfo(autofillHints = listOf("username"), isFocused = true),
            "pass" to AutofillFieldInfo(autofillHints = listOf("password")),
        )
        assertTrue(EmailFieldMatcher.emailTargets(fields).isEmpty())
    }

    @Test
    fun labelPrefersSiteThenApp() {
        assertEquals("shop.example.com", EmailFieldMatcher.aliasLabel("www.Shop.example.com", "Chrome"))
        assertEquals("Example App", EmailFieldMatcher.aliasLabel(null, " Example App "))
        assertEquals("Example App", EmailFieldMatcher.aliasLabel("  ", "Example App"))
        assertNull(EmailFieldMatcher.aliasLabel(null, null))
        assertEquals(100, EmailFieldMatcher.aliasLabel("a".repeat(150) + ".com", null)?.length)
    }
}
