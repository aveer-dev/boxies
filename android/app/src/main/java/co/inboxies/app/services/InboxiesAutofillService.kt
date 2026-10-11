package co.inboxies.app.services

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.pm.PackageManager
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.widget.RemoteViews
import co.inboxies.app.InboxiesApplication
import co.inboxies.app.R
import co.inboxies.app.ui.autofill.PrivateEmailAutofillActivity
import java.util.regex.Pattern

/**
 * Offers "Private email" on email fields in other apps and Chrome. Picking it opens
 * [PrivateEmailAutofillActivity], which creates a real address on the server and
 * returns it as the dataset to fill.
 */
class InboxiesAutofillService : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        val structure = request.fillContexts.lastOrNull()?.structure
        val signedIn = (application as InboxiesApplication).authStore.isAuthenticated
        // Nothing to offer signed out, or inside Inboxies' own forms.
        if (structure == null || !signedIn || structure.activityComponent.packageName == packageName) {
            callback.onSuccess(null)
            return
        }

        val match = EmailFieldMatch()
        for (i in 0 until structure.windowNodeCount) {
            structure.getWindowNodeAt(i).rootViewNode?.let { match.scan(it) }
        }
        val fieldId = match.fieldId ?: run {
            callback.onSuccess(null)
            return
        }

        val label = match.webDomain?.removePrefix("www.")
            ?: appLabel(structure.activityComponent.packageName)
        val presentation = RemoteViews(packageName, R.layout.autofill_inline_suggestion).apply {
            setTextViewText(R.id.autofill_title, "Private email")
            setTextViewText(R.id.autofill_subtitle, "Create a new address for $label")
        }
        val authentication = PendingIntent.getActivity(
            this,
            fieldId.hashCode(),
            PrivateEmailAutofillActivity.intent(this, fieldId, label),
            // Mutable: the system adds the assist structure to the intent.
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE,
        ).intentSender

        // No value until the address exists. The match-all filter keeps the offer
        // visible while the user types; a null value would otherwise fail any filter.
        @Suppress("DEPRECATION") // Field/Presentations need a value; an auth dataset has none yet.
        val dataset = Dataset.Builder(presentation)
            .setValue(fieldId, null, MATCH_ANY_TEXT, presentation)
            .setAuthentication(authentication)
            .build()
        callback.onSuccess(FillResponse.Builder().addDataset(dataset).build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        callback.onSuccess()
    }

    private companion object {
        val MATCH_ANY_TEXT: Pattern = Pattern.compile(".*", Pattern.DOTALL)
    }

    private fun appLabel(packageName: String): String = try {
        val info = packageManager.getApplicationInfo(packageName, 0)
        packageManager.getApplicationLabel(info).toString()
    } catch (_: PackageManager.NameNotFoundException) {
        // Android 11+ package visibility hides most apps; don't ask for QUERY_ALL_PACKAGES.
        readableAppName(packageName)
    }
}

/** First email field in the structure, and the web domain it sits on (Chrome / WebView). */
private class EmailFieldMatch {
    var fieldId: AutofillId? = null
        private set
    var webDomain: String? = null
        private set

    fun scan(node: AssistStructure.ViewNode, domain: String? = null) {
        if (fieldId != null) return
        val nodeDomain = node.webDomain?.takeIf { it.isNotBlank() } ?: domain
        val id = node.autofillId
        if (id != null && isEmailField(node)) {
            fieldId = id
            webDomain = nodeDomain
            return
        }
        for (i in 0 until node.childCount) {
            node.getChildAt(i)?.let { scan(it, nodeDomain) }
        }
    }

    private fun isEmailField(node: AssistStructure.ViewNode): Boolean = looksLikeEmailField(
        autofillType = node.autofillType,
        autofillHints = node.autofillHints?.toList(),
        inputType = node.inputType,
        htmlAttributes = node.htmlInfo?.attributes?.map { it.first to it.second },
        hint = node.hint,
        idEntry = node.idEntry,
    )
}

/** Email-field test on plain values, so it runs in JVM unit tests. */
internal fun looksLikeEmailField(
    autofillType: Int,
    autofillHints: List<String>?,
    inputType: Int,
    htmlAttributes: List<Pair<String?, String?>>?,
    hint: String?,
    idEntry: String?,
): Boolean {
    if (autofillType != View.AUTOFILL_TYPE_TEXT) return false
    if (autofillHints?.any { it.contains("email", ignoreCase = true) } == true) return true

    if (inputType and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT) {
        when (inputType and InputType.TYPE_MASK_VARIATION) {
            InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
            InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS -> return true
            InputType.TYPE_TEXT_VARIATION_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD -> return false
        }
    }

    // Web forms: <input type="email"> or autocomplete="email".
    htmlAttributes?.forEach { (rawName, rawValue) ->
        val name = rawName?.lowercase()
        val value = rawValue?.lowercase().orEmpty()
        if (name == "type" && value == "password") return false
        if (name == "type" && value == "email") return true
        if (name == "autocomplete" && value.split(' ').contains("email")) return true
    }

    val hintText = hint?.lowercase().orEmpty()
    val id = idEntry?.lowercase().orEmpty()
    return "email" in hintText || "e-mail" in hintText || "email" in id
}

private val genericPackageSegments = setOf("com", "org", "net", "io", "co", "www", "app", "apps", "android", "mobile", "google")

/** `com.google.android.contacts` → `Contacts`, `com.instagram.android` → `Instagram`. */
internal fun readableAppName(packageName: String): String {
    val name = packageName.split('.').lastOrNull { it.isNotBlank() && it.lowercase() !in genericPackageSegments }
        ?: return packageName
    return name.replaceFirstChar { it.uppercase() }
}
