package co.inboxies.app.ui.email

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import co.inboxies.app.models.Email
import co.inboxies.app.theme.inboxiesColors

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EmailBodyView(email: Email, modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    val body = email.body.orEmpty()
    val html = if (email.bodyLooksLikeHTML) {
        """
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, sans-serif; font-size: 13px; color: #1F1F24;
                 background: transparent; margin: 12px; line-height: 1.45; word-wrap: break-word; }
          img { max-width: 100%; height: auto; }
          a { color: #2660D9; }
        </style></head><body>$body</body></html>
        """.trimIndent()
    } else {
        """
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, sans-serif; font-size: 13px; color: #1F1F24;
                 white-space: pre-wrap; margin: 12px; }
        </style></head><body>${
            body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        }</body></html>
        """.trimIndent()
    }

    Box(modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp)) {
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    setBackgroundColor(android.graphics.Color.TRANSPARENT)
                    settings.javaScriptEnabled = false
                    webViewClient = WebViewClient()
                    loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
                }
            },
            update = { it.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null) },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
