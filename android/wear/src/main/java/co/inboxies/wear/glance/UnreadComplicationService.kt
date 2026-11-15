package co.inboxies.wear.glance

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import co.inboxies.wear.MainActivity
import co.inboxies.wear.R
import co.inboxies.wear.WearApplication

/**
 * The unread-count complication (AVE-147, plan phase 3): the Inbox unread count with
 * a monochrome mail icon, short or long text. The watch face draws and tints it, so
 * it's grey-scale (or the face's tint) by design. Count only: watch faces are always
 * on, so sender names stay on the Tile. Reads the app's [WatchGlanceSnapshot] only;
 * tap opens the app's Inbox.
 */
class UnreadComplicationService : SuspendingComplicationDataSourceService() {
    private val app: WearApplication get() = application as WearApplication

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        val snapshot = app.glance.read()
        app.refreshGlanceIfStale()
        return data(request.complicationType, snapshot)
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        data(type, WatchGlanceSnapshot.of("preview", 3, emptyList(), 0), tap = false)

    private fun data(type: ComplicationType, snapshot: WatchGlanceSnapshot?, tap: Boolean = true): ComplicationData? {
        // Signed out: a dash, and the tap opens Connect.
        val count = snapshot?.unreadCount
        val short = count?.let(WatchGlance::countText) ?: "–"
        val long = count?.let(WatchGlance::summary) ?: "Inboxies"
        val description = plain(count?.let { "Inbox: ${WatchGlance.summary(it)}" } ?: "Inboxies: not connected")
        val icon = MonochromaticImage.Builder(Icon.createWithResource(this, R.drawable.ic_glance_mail)).build()
        val tapAction = if (tap) openInbox() else null
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(plain(short), description)
                .setMonochromaticImage(icon)
                .setTapAction(tapAction)
                .build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(plain(long), description)
                .setTitle(plain("Inbox"))
                .setMonochromaticImage(icon)
                .setTapAction(tapAction)
                .build()
            else -> null
        }
    }

    private fun plain(text: String) = PlainComplicationText.Builder(text).build()

    private fun openInbox(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
