package co.inboxies.app.autofill

import android.text.InputType
import android.view.View

/**
 * Framework-free snapshot of an `AssistStructure.ViewNode`, so field matching runs in
 * plain JVM tests. Built by [InboxiesAutofillService][co.inboxies.app.services.InboxiesAutofillService].
 */
data class AutofillFieldInfo(
    /** `ViewNode.autofillHints` (apps) or the `autocomplete` hints Chrome forwards. */
    val autofillHints: List<String> = emptyList(),
    /** `type` attribute from `ViewNode.htmlInfo`, for web forms. */
    val htmlType: String? = null,
    /** `ViewNode.inputType`. */
    val inputType: Int = InputType.TYPE_NULL,
    val isFocused: Boolean = false,
    /** Hidden inputs (honeypots, collapsed sections) are never filled. */
    val isVisible: Boolean = true,
)

/**
 * Decides which fields get a private email. Deliberately strict: only explicit email
 * signals count (no label / id text heuristics), and anything password-like is excluded
 * even when it also looks like an email field.
 */
object EmailFieldMatcher {
    /** `View.AUTOFILL_HINT_EMAIL_ADDRESS` plus the HTML `autocomplete="email"` token. */
    private val emailHints = setOf(View.AUTOFILL_HINT_EMAIL_ADDRESS.lowercase(), "email")

    fun isEmailField(field: AutofillFieldInfo): Boolean {
        if (!field.isVisible || isPasswordField(field)) return false
        return hasEmailHint(field) || isHtmlEmail(field) || isEmailInputType(field.inputType)
    }

    fun isPasswordField(field: AutofillFieldInfo): Boolean {
        if (field.autofillHints.any { it.contains("password", ignoreCase = true) }) return true
        if (field.htmlType.equals("password", ignoreCase = true)) return true
        val inputClass = field.inputType and InputType.TYPE_MASK_CLASS
        val variation = field.inputType and InputType.TYPE_MASK_VARIATION
        return when (inputClass) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    /**
     * Email fields to fill, focused one first. Every email field gets the same address, so
     * an "Email" + "Confirm email" pair matches instead of minting two aliases.
     */
    fun <T> emailTargets(fields: List<Pair<T, AutofillFieldInfo>>): List<T> {
        val matches = fields.filter { (_, info) -> isEmailField(info) }
        val (focused, rest) = matches.partition { (_, info) -> info.isFocused }
        return (focused + rest).map { it.first }
    }

    private fun hasEmailHint(field: AutofillFieldInfo): Boolean =
        field.autofillHints.any { it.trim().lowercase() in emailHints }

    private fun isHtmlEmail(field: AutofillFieldInfo): Boolean =
        field.htmlType?.trim().equals("email", ignoreCase = true)

    private fun isEmailInputType(inputType: Int): Boolean {
        if ((inputType and InputType.TYPE_MASK_CLASS) != InputType.TYPE_CLASS_TEXT) return false
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
    }

    /** Alias label: the site (`www.` dropped) or, for apps, their name. Worker caps at 100. */
    fun aliasLabel(webDomain: String?, appLabel: String?): String? {
        val domain = webDomain?.trim()?.lowercase()?.removePrefix("www.")?.takeIf { it.isNotEmpty() }
        return (domain ?: appLabel?.trim()?.takeIf { it.isNotEmpty() })?.take(100)
    }
}
