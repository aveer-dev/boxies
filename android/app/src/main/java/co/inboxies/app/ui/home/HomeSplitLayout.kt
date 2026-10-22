package co.inboxies.app.ui.home

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.outlined.ViewSidebar
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.core.content.edit
import co.inboxies.app.models.HomeTab
import co.inboxies.app.ui.compose.ComposeActionItem
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
 * (email detail as a bottom sheet). At ≥ [HomeChromeMetrics.threeColumnMinWidth] (a
 * tablet in landscape) a leading folder column joins them, mirroring the web's Miller
 * columns (AVE-73). Design twin of iOS `HomeLayoutMode`.
 */
enum class HomeLayoutMode {
    /** Phone layout: list fills the window, detail presents as a sheet. */
    Stacked,

    /** Large screen: list column + persistent reading pane. */
    TwoPane,

    /** Wide screen: folder column + list column + reading pane. */
    ThreeColumn,
    ;

    /** Mail opens in the reading pane rather than a sheet. */
    val isSplit: Boolean get() = this != Stacked

    companion object {
        /**
         * [showsFolderColumn] is the user's folder-column toggle: off keeps wide windows
         * two-pane; it has no effect below [HomeChromeMetrics.threeColumnMinWidth].
         */
        fun forWidth(windowWidth: Dp, showsFolderColumn: Boolean = true): HomeLayoutMode = when {
            windowWidth < HomeChromeMetrics.twoPaneMinWidth -> Stacked
            showsFolderColumn && allowsFolderColumn(windowWidth) -> ThreeColumn
            else -> TwoPane
        }

        /** Whether the window is wide enough for the folder column (drives the toggle). */
        fun allowsFolderColumn(windowWidth: Dp): Boolean =
            windowWidth >= HomeChromeMetrics.threeColumnMinWidth
    }
}

/** Current window's layout mode. `screenWidthDp` tracks the window in multi-window / folds. */
@Composable
fun rememberHomeLayoutMode(showsFolderColumn: Boolean): HomeLayoutMode {
    val widthDp = LocalConfiguration.current.screenWidthDp
    return remember(widthDp, showsFolderColumn) { HomeLayoutMode.forWidth(widthDp.dp, showsFolderColumn) }
}

/** True when the current window is wide enough for the folder column. */
@Composable
fun rememberAllowsFolderColumn(): Boolean {
    val widthDp = LocalConfiguration.current.screenWidthDp
    return remember(widthDp) { HomeLayoutMode.allowsFolderColumn(widthDp.dp) }
}

private const val PREFS_NAME = "inboxies_prefs"
private const val KEY_FOLDER_COLUMN_VISIBLE = "home_folder_column_visible"

/** Folder column toggle on wide windows, persisted in `inboxies_prefs` (iOS: `@AppStorage`). */
@Composable
fun rememberFolderColumnVisible(): MutableState<Boolean> {
    val context = LocalContext.current
    val prefs = remember(context) {
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }
    val state = remember { mutableStateOf(prefs.getBoolean(KEY_FOLDER_COLUMN_VISIBLE, true)) }
    LaunchedEffect(state.value) {
        if (prefs.getBoolean(KEY_FOLDER_COLUMN_VISIBLE, true) != state.value) {
            prefs.edit { putBoolean(KEY_FOLDER_COLUMN_VISIBLE, state.value) }
        }
    }
    return state
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
 * [Folder column + hairline +] list column + hairline + detail column. In
 * [HomeLayoutMode.Stacked] only the list is laid out, at full width, so the phone layout
 * is unchanged. The folder column sits in its own conditional group and takes its space
 * from the reading pane, so the list keeps its identity (scroll, state) and width when
 * the window resizes or the column is toggled.
 */
@Composable
fun HomeSplitLayout(
    mode: HomeLayoutMode,
    modifier: Modifier = Modifier,
    folders: @Composable BoxScope.() -> Unit = {},
    list: @Composable BoxScope.() -> Unit,
    detail: @Composable BoxScope.() -> Unit,
) {
    val colors = inboxiesColors()
    val windowWidth = LocalConfiguration.current.screenWidthDp.dp
    val showsFolders = mode == HomeLayoutMode.ThreeColumn
    val listWidth = HomeChromeMetrics.listColumnWidth(windowWidth)
    Row(modifier = modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = showsFolders,
            enter = expandHorizontally(
                animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                expandFrom = Alignment.Start,
            ) + fadeIn(),
            exit = shrinkHorizontally(
                animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                shrinkTowards = Alignment.Start,
            ) + fadeOut(),
        ) {
            Row(modifier = Modifier.fillMaxHeight()) {
                Box(
                    modifier = Modifier
                        .width(HomeChromeMetrics.folderColumnWidth)
                        .fillMaxHeight()
                        .background(colors.background),
                    content = folders,
                )
                Hairline(colors.line)
            }
        }
        Box(
            modifier = if (mode.isSplit) {
                Modifier
                    .width(listWidth)
                    .fillMaxHeight()
            } else {
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
            },
            content = list,
        )
        if (mode.isSplit) {
            Hairline(colors.line)
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

@Composable
private fun Hairline(color: Color) {
    Box(
        modifier = Modifier
            .width(AppThemeDims.List.separatorHeight)
            .fillMaxHeight()
            .background(color)
            .clearAndSetSemantics {},
    )
}

/**
 * Leading column of the three-column layout: the mailbox's folders plus the Reply Later
 * pile, like the web's Miller "Folders" column. Same destinations as the compose-stack
 * folder menu and the folder swipe; it only switches [HomeTab]. Twin of iOS
 * `HomeFolderColumn`.
 */
@Composable
fun HomeFolderColumn(
    title: String,
    subtitle: String,
    folders: List<HomeTab>,
    selected: HomeTab,
    unreadCount: (String) -> Int,
    replyLaterCount: Int,
    onSelect: (HomeTab) -> Unit,
    onHide: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    Column(
        modifier = modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Start + WindowInsetsSides.Vertical))
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 10.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(
            modifier = Modifier.padding(start = 10.dp, top = 14.dp, bottom = 12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) { heading() },
            ) {
                Text(
                    title,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle.isNotBlank()) {
                    Text(
                        subtitle,
                        fontFamily = InterFontFamily,
                        fontSize = AppThemeDims.FontSize.homeSubtitle,
                        color = colors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .clickable(role = Role.Button, onClick = onHide)
                    .semantics { contentDescription = "Hide folders" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.ViewSidebar,
                    contentDescription = null,
                    tint = colors.ink,
                    // The glyph's panel sits on the trailing side; flip it to the folder
                    // column's (leading) side.
                    modifier = Modifier
                        .size(18.dp)
                        .graphicsLayer { scaleX = -1f },
                )
            }
        }

        folders.forEach { tab ->
            FolderColumnRow(
                tab = tab,
                count = tab.syncFolderId?.let(unreadCount) ?: 0,
                countLabel = "unread",
                isSelected = tab == selected,
                onClick = { onSelect(tab) },
            )
        }

        Text(
            "WORKFLOW",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.List.sectionHeader,
            letterSpacing = 0.6.sp,
            color = colors.muted,
            modifier = Modifier
                .padding(horizontal = 10.dp)
                .padding(top = 20.dp, bottom = 6.dp)
                .semantics { heading() },
        )
        FolderColumnRow(
            tab = HomeTab.ReplyLater,
            count = replyLaterCount,
            countLabel = "queued",
            isSelected = selected == HomeTab.ReplyLater,
            onClick = { onSelect(HomeTab.ReplyLater) },
        )
    }
}

@Composable
private fun FolderColumnRow(
    tab: HomeTab,
    count: Int,
    countLabel: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(HomeChromeMetrics.folderRowCornerRadius)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(HomeChromeMetrics.folderRowHeight)
            .clip(shape)
            .background(if (isSelected) colors.pillFill else Color.Transparent, shape)
            .clickable(role = Role.Tab, onClick = onClick)
            .semantics(mergeDescendants = true) {
                selected = isSelected
                if (count > 0) stateDescription = "$count $countLabel"
            }
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            tab.folderColumnIcon,
            contentDescription = null,
            tint = if (isSelected) colors.ink else colors.muted,
            modifier = Modifier.size(18.dp),
        )
        Text(
            tab.title,
            fontFamily = InterFontFamily,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            fontSize = 15.sp,
            color = colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (count > 0) {
            Text(
                if (count > 999) "999+" else "$count",
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.FontSize.meta,
                color = colors.muted,
            )
        }
    }
}

/** Same glyphs as the compose-stack folder menu; Reply Later matches the bottom-bar pile. */
private val HomeTab.folderColumnIcon: ImageVector
    get() = when (this) {
        HomeTab.ReplyLater -> Icons.Outlined.Schedule
        else -> ComposeActionItem.entries.firstOrNull { it.folderTab == this }?.icon ?: Icons.Outlined.Folder
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
