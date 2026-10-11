package co.inboxies.app.services

import android.text.InputType
import android.view.View
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutofillEmailFieldTest {
    private fun field(
        inputType: Int = InputType.TYPE_CLASS_TEXT,
        autofillType: Int = View.AUTOFILL_TYPE_TEXT,
        hints: List<String>? = null,
        html: List<Pair<String?, String?>>? = null,
        hint: String? = null,
        idEntry: String? = null,
    ) = looksLikeEmailField(autofillType, hints, inputType, html, hint, idEntry)

    @Test
    fun emailInputTypesMatch() {
        assertTrue(field(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS))
        assertTrue(field(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS))
    }

    @Test
    fun passwordFieldsNeverMatch() {
        // The old bitmask test (`inputType and EMAIL_ADDRESS != 0`) matched these.
        assertFalse(field(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD, idEntry = "email_password"))
        assertFalse(field(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD))
        assertFalse(field(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD))
        assertFalse(field(html = listOf("type" to "password", "name" to "email-password")))
    }

    @Test
    fun autofillHintsMatch() {
        assertTrue(field(hints = listOf(View.AUTOFILL_HINT_EMAIL_ADDRESS)))
        assertTrue(field(hints = listOf("emailAddress")))
    }

    @Test
    fun webFormsMatchOnTypeOrAutocomplete() {
        assertTrue(field(html = listOf("type" to "email")))
        assertTrue(field(html = listOf("type" to "text", "autocomplete" to "section-signup email")))
        assertFalse(field(html = listOf("type" to "text", "autocomplete" to "username")))
    }

    @Test
    fun plainTextFallsBackToHintAndId() {
        assertTrue(field(hint = "Your e-mail"))
        assertTrue(field(idEntry = "signup_email"))
        assertFalse(field(hint = "First name", idEntry = "first_name"))
    }

    @Test
    fun nonTextNodesNeverMatch() {
        assertFalse(field(autofillType = View.AUTOFILL_TYPE_TOGGLE, hint = "Email me updates"))
    }

    @Test
    fun packageNamesBecomeReadableLabels() {
        assertEquals("Contacts", readableAppName("com.google.android.contacts"))
        assertEquals("Instagram", readableAppName("com.instagram.android"))
        assertEquals("Chrome", readableAppName("com.android.chrome"))
        assertEquals("com.android", readableAppName("com.android"))
    }
}
