package co.inboxies.app.services

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillContext
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import co.inboxies.app.R
import java.security.SecureRandom

/**
 * System Autofill Service providing native "Private Email" inline suggestions across Android apps and Chrome.
 */
class InboxiesAutofillService : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        val structure = request.fillContexts.lastOrNull()?.structure ?: run {
            callback.onSuccess(null)
            return
        }

        val emailNodeIds = mutableListOf<AutofillId>()
        findEmailFields(structure, emailNodeIds)

        if (emailNodeIds.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val targetId = emailNodeIds.first()
        val generatedEmail = generateRandomAlias()

        val presentation = RemoteViews(packageName, R.layout.autofill_inline_suggestion).apply {
            setTextViewText(R.id.autofill_title, "Generate Private Email")
            setTextViewText(R.id.autofill_subtitle, generatedEmail)
        }

        val dataset = Dataset.Builder(presentation)
            .setValue(targetId, AutofillValue.forText(generatedEmail))
            .build()

        val response = FillResponse.Builder()
            .addDataset(dataset)
            .build()

        callback.onSuccess(response)
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        callback.onSuccess()
    }

    private fun findEmailFields(
        structure: AssistStructure,
        results: MutableList<AutofillId>,
    ) {
        val windowNodes = structure.run {
            (0 until windowNodeCount).map { getWindowNodeAt(it) }
        }
        for (windowNode in windowNodes) {
            val root = windowNode.rootViewNode ?: continue
            traverseNode(root, results)
        }
    }

    private fun traverseNode(
        node: AssistStructure.ViewNode,
        results: MutableList<AutofillId>,
    ) {
        val id = node.autofillId
        val hints = node.autofillHints
        val hintText = node.hint?.toString()?.lowercase().orEmpty()
        val idEntry = node.idEntry?.lowercase().orEmpty()
        val inputType = node.inputType

        val isEmailField = (hints != null && hints.any { it.equals(View.AUTOFILL_HINT_EMAIL_ADDRESS, ignoreCase = true) }) ||
            (inputType and InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS) != 0 ||
            (inputType and InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) != 0 ||
            hintText.contains("email") ||
            idEntry.contains("email")

        if (id != null && isEmailField) {
            results.add(id)
        }

        for (i in 0 until node.childCount) {
            val child = node.getChildAt(i) ?: continue
            traverseNode(child, results)
        }
    }

    private fun generateRandomAlias(): String {
        val chars = "abcdefghjkmnpqrstuvwxyz23456789"
        val random = SecureRandom()
        val token = StringBuilder(10)
        for (i in 0 until 10) {
            token.append(chars[random.nextInt(chars.length)])
        }
        return "$token@private.inboxies.app"
    }
}
