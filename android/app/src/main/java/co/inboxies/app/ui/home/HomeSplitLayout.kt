package co.inboxies.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.Email
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

/**
 * How the home shell arranges mail. Driven by the window width, not the device: an
 * unfolded foldable or a tablet at ≥ [HomeChromeMetrics.twoPaneMinWidth] reads mail in
 * a side pane; phones, folded foldables and narrow multi-window keep the phone layout
 * (email detail as a bottom sheet). Design twin of iOS `HomeLayoutMode`.
 *
 * Extensible on purpose: a third column (AVE-73) becomes another case here plus another
 * column in [HomeSplitLayout].
 */
enum class HomeLayoutMode {
    /** Phone layout: list fills the window, detail presents as a sheet. */
    Stacked,

    /** Large screen: list column + persistent reading pane. */
    TwoPane,
    ;

    companion object {
        fun forWidth(windowWidth: Dp): HomeLayoutMode =
            if (windowWidth >= HomeChromeMetrics.twoPaneMinWidth) TwoPane else Stacked
    }
}

/** Current window's layout mode. `screenWidthDp` tracks the window in multi-window / folds. */
@Composable
fun rememberHomeLayoutMode(): HomeLayoutMode {
    val widthDp = LocalConfiguration.current.screenWidthDp
    return remember(widthDp) { HomeLayoutMode.forWidth(widthDp.dp) }
}

val LocalHomeLayoutMode = staticCompositionLocalOf { HomeLayoutMode.Stacked }

/**
 * The email open in the reading pane (two-pane only; always null when stacked) so list
 * rows can tint the matching row.
 */
val LocalReadingPaneEmail = compositionLocalOf<Email?> { null }

/** True when [email] (or its thread) is what the reading pane is showing. */
fun Email.isOpenInReadingPane(open: Email?): Boolean {
    if (open == null) return false
    if (open.id == id) return true
    val thread = open.threadId
    return !thread.isNullOrEmpty() && thread == threadId
}

/**
 * List column + hairline + detail column. In [HomeLayoutMode.Stacked] only the list is
 * laid out, at full width, so the phone layout is unchanged. The list is always the
 * first child so it keeps its identity (scroll, state) when the window resizes.
 */
@Composable
fun HomeSplitLayout(
    mode: HomeLayoutMode,
    modifier: Modifier = Modifier,
    list: @Composable BoxScope.() -> Unit,
    detail: @Composable BoxScope.() -> Unit,
) {
    val colors = inboxiesColors()
    val windowWidth = LocalConfiguration.current.screenWidthDp.dp
    Row(modifier = modifier.fillMaxSize()) {
        Box(
            modifier = if (mode == HomeLayoutMode.TwoPane) {
                Modifier
                    .width(HomeChromeMetrics.listColumnWidth(windowWidth))
                    .fillMaxHeight()
            } else {
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
            },
            content = list,
        )
        if (mode == HomeLayoutMode.TwoPane) {
            Box(
                modifier = Modifier
                    .width(AppThemeDims.List.separatorHeight)
                    .fillMaxHeight()
                    .background(colors.line)
                    .clearAndSetSemantics {},
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .background(colors.background),
                content = detail,
            )
        }
    }
}

/** Quiet placeholder for the reading pane when nothing is open (empty-state convention). */
@Composable
fun ReadingPanePlaceholder(modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(horizontal = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Outlined.Email,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(40.dp),
            )
            Text(
                "No email selected",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
            )
            Text(
                "Choose an email from the list to read it here.",
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.muted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Centered form sheet on large screens; pass-through on phones. The overlays it wraps
 * (compose, Ask AI, settings) draw full-window on phones and pad for system bars / IME
 * themselves — here the card's frame consumes those insets so the content isn't padded
 * twice, while the keyboard still shrinks the card.
 *
 * [onDismissOutside] runs on a scrim tap; null keeps the scrim inert (compose, whose
 * unsaved field edits live inside the sheet until it minimizes itself).
 */
@Composable
fun HomeFormSheet(
    mode: HomeLayoutMode,
    onDismissOutside: (() -> Unit)?,
    content: @Composable () -> Unit,
) {
    if (mode == HomeLayoutMode.Stacked) {
        content()
        return
    }
    val colors = inboxiesColors()
    val dismiss = rememberUpdatedState(onDismissOutside)
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HomeChromeMetrics.modalScrim)
            // Always consume scrim taps so they never reach the list / pane underneath.
            .pointerInput(Unit) { detectTapGestures { dismiss.value?.invoke() } }
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(HomeChromeMetrics.formSheetMargin),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = HomeChromeMetrics.formSheetMaxWidth)
                .fillMaxWidth()
                .heightIn(max = HomeChromeMetrics.formSheetMaxHeight)
                .fillMaxHeight()
                .clip(RoundedCornerShape(HomeChromeMetrics.formSheetCornerRadius))
                .background(colors.background)
                // Taps on the card's own empty space must not fall through to the scrim.
                .pointerInput(Unit) { detectTapGestures { } },
        ) {
            content()
        }
    }
}
