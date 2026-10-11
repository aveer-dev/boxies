package co.inboxies.app.services

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.Presentations
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.util.Log
import android.view.View
import android.view.autofill.AutofillId
import android.widget.RemoteViews
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import co.inboxies.app.InboxiesApplication
import co.inboxies.app.MainActivity
import co.inboxies.app.R
import co.inboxies.app.autofill.AutofillFieldInfo
import co.inboxies.app.autofill.EmailFieldMatcher
import co.inboxies.app.autofill.PrivateEmailAutofillActivity

/**
 * Offers "Create private email" on email fields in other apps and Chrome.
 *
 * Fill requests stay offline: the suggestion is a locked dataset whose authentication
 * intent opens [PrivateEmailAutofillActivity], which creates the alias through the API
 * and hands the filled dataset back. Addresses are never generated on the device.
 */
class InboxiesAutofillService : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        val response = try {
            buildResponse(request)
        } catch (e: Exception) {
            Log.w(TAG, "Autofill request failed", e)
            null
        }
        callback.onSuccess(response)
    }

    /** Nothing to save: private emails are created on fill, and no SaveInfo is requested. */
    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        callback.onSuccess()
    }

    private fun buildResponse(request: FillRequest): FillResponse? {
        val structure = request.fillContexts.lastOrNull()?.structure ?: return null
        val requestingPackage = structure.activityComponent?.packageName
        if (requestingPackage == packageName) return null

        val fields = scan(structure)
        val targets = EmailFieldMatcher.emailTargets(fields.map { it.id to it.info })
        if (targets.isEmpty()) return null

        val primaryDomain = fields.firstOrNull { it.id == targets.first() }?.webDomain
        val label = EmailFieldMatcher.aliasLabel(
            webDomain = primaryDomain,
            appLabel = requestingPackage?.let { appLabel(it) ?: it },
        )
        val signedIn = !(application as InboxiesApplication).authStore.currentToken().isNullOrEmpty()

        val title = getString(if (signedIn) R.string.autofill_create_title else R.string.autofill_sign_in_title)
        val subtitle = when {
            !signedIn -> getString(R.string.autofill_sign_in_subtitle)
            label != null -> getString(R.string.autofill_create_subtitle, label)
            else -> getString(R.string.autofill_create_subtitle_default)
        }

        val menu = RemoteViews(packageName, R.layout.autofill_dataset_item).apply {
            setTextViewText(R.id.autofill_title, title)
            setTextViewText(R.id.autofill_subtitle, subtitle)
        }
        val presentations = Presentations.Builder()
            .setMenuPresentation(menu)
            .apply { inlinePresentation(request, title, subtitle)?.let { setInlinePresentation(it) } }
            .build()

        // FLAG_MUTABLE: the platform adds the assist structure / client state extras.
        val authentication = PendingIntent.getActivity(
            this,
            request.id,
            PrivateEmailAutofillActivity.intent(this, targets, label),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_CANCEL_CURRENT,
        )

        val dataset = Dataset.Builder(presentations)
            .apply { targets.forEach { setField(it, null) } }
            .setAuthentication(authentication.intentSender)
            .build()

        return FillResponse.Builder()
            .addDataset(dataset)
            .build()
    }

    /**
     * Keyboard chip, when the IME asked for inline suggestions and speaks UI version 1.
     * `getSlice()` is the documented way to hand the content to [InlinePresentation]; lint
     * flags it only because it's declared on a library-restricted base class.
     */
    @SuppressLint("RestrictedApi")
    private fun inlinePresentation(
        request: FillRequest,
        title: String,
        subtitle: String,
    ): InlinePresentation? {
        val inlineRequest = request.inlineSuggestionsRequest ?: return null
        if (inlineRequest.maxSuggestionCount < 1) return null
        val spec = inlineRequest.inlinePresentationSpecs.firstOrNull() ?: return null
        if (UiVersions.INLINE_UI_VERSION_1 !in UiVersions.getVersions(spec.style)) return null

        // Long-pressing the chip opens Inboxies.
        val attribution = PendingIntent.getActivity(
            this,
            REQUEST_CODE_ATTRIBUTION,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val content = InlineSuggestionUi.newContentBuilder(attribution)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setStartIcon(Icon.createWithResource(this, R.drawable.ic_inboxies_logo))
            .setContentDescription(getString(R.string.autofill_content_description))
            .build()
        return InlinePresentation(content.slice, spec, false)
    }

    private data class ScannedField(
        val id: AutofillId,
        val info: AutofillFieldInfo,
        val webDomain: String?,
    )

    private fun scan(structure: AssistStructure): List<ScannedField> {
        val fields = mutableListOf<ScannedField>()
        for (index in 0 until structure.windowNodeCount) {
            val root = structure.getWindowNodeAt(index).rootViewNode ?: continue
            collect(root, inheritedDomain = null, into = fields)
        }
        return fields
    }

    private fun collect(
        node: AssistStructure.ViewNode,
        inheritedDomain: String?,
        into: MutableList<ScannedField>,
    ) {
        // Chrome sets the domain on the page's root node; inputs inherit it.
        val domain = node.webDomain?.takeIf { it.isNotBlank() } ?: inheritedDomain
        node.autofillId?.let { id ->
            into += ScannedField(id = id, info = describe(node), webDomain = domain)
        }
        for (child in 0 until node.childCount) {
            collect(node.getChildAt(child), domain, into)
        }
    }

    private fun describe(node: AssistStructure.ViewNode) = AutofillFieldInfo(
        autofillHints = node.autofillHints?.toList().orEmpty(),
        htmlType = node.htmlInfo?.attributes
            ?.firstOrNull { it.first.equals("type", ignoreCase = true) }
            ?.second,
        inputType = node.inputType,
        isFocused = node.isFocused,
        isVisible = node.visibility == View.VISIBLE,
    )

    /** Null when the package isn't visible to us (Android 11+ package visibility). */
    private fun appLabel(packageName: String): String? = try {
        val info = packageManager.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
        packageManager.getApplicationLabel(info).toString()
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }

    private companion object {
        const val TAG = "InboxiesAutofill"
        const val REQUEST_CODE_ATTRIBUTION = 0x1A11
    }
}
