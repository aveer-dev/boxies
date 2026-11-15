package co.inboxies.wear.glance

import android.content.Context
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.ChipColors
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import co.inboxies.watchshared.WatchPalette
import co.inboxies.wear.MainActivity
import co.inboxies.wear.WearApplication
import com.google.common.util.concurrent.ListenableFuture

/**
 * The Inbox Tile (AVE-147, plan phase 3): the active mailbox's unread count and the
 * senders of the newest unread conversations. Reads the app's [WatchGlanceSnapshot]
 * only: no network, no session. A stale snapshot asks the app to read the Inbox again
 * ([WearApplication.refreshGlanceIfStale]), which then requests a Tile update. Tap
 * opens the app's Inbox.
 *
 * Colors are [WatchPalette] (`InboxiesColors` dark); Tiles render the system font, not
 * Inter. Accent only on the unread count and the Open chip (the primary action).
 */
class InboxTileService : TileService() {
    private val app: WearApplication get() = application as WearApplication

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val snapshot = app.glance.read()
        app.refreshGlanceIfStale()
        val layout = layout(this, requestParams.deviceConfiguration, snapshot)
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            // Asks again now and then, so a stale count gets a background refresh.
            .setFreshnessIntervalMillis(FRESHNESS_MILLIS)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
            .build()
        return immediate(tile)
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> =
        immediate(ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build())

    companion object {
        private const val RESOURCES_VERSION = "1"
        private const val FRESHNESS_MILLIS = 30 * 60 * 1000L
        private const val OPEN_ID = "open-inbox"

        /** The phone toast action's accent wash: accent at 16%, as `WearColors.accentWash`. */
        private val ACCENT_WASH: Int = ((0x29 shl 24) or (WatchPalette.ACCENT.toInt() and 0xFFFFFF))

        private fun <T : Any> immediate(value: T): ListenableFuture<T> =
            CallbackToFutureAdapter.getFuture { completer ->
                completer.set(value)
                "InboxTile"
            }

        private fun color(argb: Long) = argb(argb.toInt())

        private fun openInbox(context: Context): ModifiersBuilders.Clickable =
            ModifiersBuilders.Clickable.Builder()
                .setId(OPEN_ID)
                .setOnClick(
                    ActionBuilders.LaunchAction.Builder()
                        .setAndroidActivity(
                            ActionBuilders.AndroidActivity.Builder()
                                .setPackageName(context.packageName)
                                .setClassName(MainActivity::class.java.name)
                                .build(),
                        )
                        .build(),
                )
                .build()

        private fun text(context: Context, value: String, typography: Int, color: Long, maxLines: Int = 1) =
            Text.Builder(context, value)
                .setTypography(typography)
                .setColor(color(color))
                .setMaxLines(maxLines)
                .build()

        fun layout(context: Context, device: DeviceParameters, snapshot: WatchGlanceSnapshot?): LayoutElementBuilders.LayoutElement {
            val click = openInbox(context)
            val content = LayoutElementBuilders.Column.Builder()
                .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            if (snapshot == null) {
                content.addContent(
                    text(context, "Open Inboxies to connect", Typography.TYPOGRAPHY_BODY2, WatchPalette.MUTED, maxLines = 2),
                )
            } else {
                val unread = snapshot.unreadCount > 0
                content.addContent(
                    text(
                        context,
                        WatchGlance.countText(snapshot.unreadCount),
                        Typography.TYPOGRAPHY_DISPLAY3,
                        if (unread) WatchPalette.ACCENT else WatchPalette.INK,
                    ),
                )
                content.addContent(
                    text(
                        context,
                        if (unread) "unread" else WatchGlance.summary(0),
                        Typography.TYPOGRAPHY_CAPTION2,
                        WatchPalette.MUTED,
                    ),
                )
                if (snapshot.senders.isNotEmpty()) {
                    content.addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(4f)).build())
                }
                snapshot.senders.forEach { sender ->
                    content.addContent(text(context, sender, Typography.TYPOGRAPHY_CAPTION1, WatchPalette.INK))
                }
            }
            val box = LayoutElementBuilders.Box.Builder()
                .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(click).build())
                .addContent(content.build())
                .build()
            return PrimaryLayout.Builder(device)
                .setResponsiveContentInsetEnabled(true)
                .setPrimaryLabelTextContent(text(context, "Inbox", Typography.TYPOGRAPHY_CAPTION1, WatchPalette.MUTED))
                .setContent(box)
                .setPrimaryChipContent(
                    CompactChip.Builder(context, "Open", click, device)
                        .setChipColors(ChipColors(ACCENT_WASH, WatchPalette.ACCENT.toInt()))
                        .build(),
                )
                .build()
        }
    }
}
