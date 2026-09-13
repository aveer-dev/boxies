package co.inboxies.app.theme

import android.app.Activity
import android.content.ContextWrapper
import android.os.Build
import android.view.View
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import android.graphics.Color as AndroidColor

/**
 * Keep status and navigation bars transparent so content draws edge-to-edge,
 * matching iOS (system bars stay see-through; icon style follows the theme).
 */
@Composable
fun TransparentSystemBars() {
    val view = LocalView.current
    val colors = inboxiesColors()
    val lightIcons = colors.background.luminance() < 0.5f
    if (view.isInEditMode) return
    SideEffect {
        val window = view.findComposeWindow() ?: return@SideEffect
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = AndroidColor.TRANSPARENT
        window.navigationBarColor = AndroidColor.TRANSPARENT
        @Suppress("DEPRECATION")
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !lightIcons
        controller.isAppearanceLightNavigationBars = !lightIcons
    }
}

private fun View.findComposeWindow(): Window? {
    if (this is DialogWindowProvider) return window
    var parent = this.parent
    while (parent != null) {
        if (parent is DialogWindowProvider) return parent.window
        parent = parent.parent
    }
    var context = context
    while (context is ContextWrapper) {
        if (context is Activity) return context.window
        context = context.baseContext
    }
    return null
}
