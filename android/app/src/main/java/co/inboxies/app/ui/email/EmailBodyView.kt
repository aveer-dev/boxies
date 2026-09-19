package co.inboxies.app.ui.email

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Email
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.MarkdownContentView
import co.inboxies.app.util.EmailHtmlSanitizer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EmailBodyView(
    email: Email,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val app = LocalAppModel.current
    val mailboxId by app.selectedMailboxId.collectAsState()
    val htmlOrText = email.body ?: email.snippet.orEmpty()
    val attachments = email.attachments.orEmpty()
    val isHtml = looksLikeHtml(htmlOrText)

    var htmlWithImages by remember(email.id, htmlOrText) { mutableStateOf<String?>(null) }
    var isResolvingImages by remember(email.id) { mutableStateOf(false) }
    var webHeightPx by remember(email.id) { mutableFloatStateOf(1f) }
    var isWebLoading by remember(email.id) { mutableStateOf(isHtml) }
    var showQuoted by remember { mutableStateOf(false) }

    val bodyHtml = htmlWithImages ?: htmlOrText
    val prepared = remember(bodyHtml) { EmailHtmlSanitizer.prepare(bodyHtml) }
    val plainParts = remember(htmlOrText) { splitPlainTextReplies(htmlOrText) }
    val hasQuoted = if (isHtml) prepared.quote != null else plainParts.second != null
    val showLoading = isHtml && (isWebLoading || webHeightPx <= 1f)

    LaunchedEffect(email.id, htmlOrText, attachments.map { it.id }.joinToString(",")) {
        webHeightPx = 1f
        isWebLoading = isHtml
        htmlWithImages = null
        val mid = mailboxId ?: return@LaunchedEffect
        if (!isHtml) return@LaunchedEffect
        val targets = attachments.filter { it.normalizedContentId != null }
        if (targets.isEmpty()) return@LaunchedEffect
        isResolvingImages = true
        try {
            val replacements = withContext(Dispatchers.IO) {
                targets.map { attachment ->
                    async {
                        val cid = attachment.normalizedContentId ?: return@async null
                        runCatching {
                            val data = ApiClient.shared.getAttachment(mid, email.id, attachment.id)
                            val mime = attachment.mimetype.ifEmpty { "application/octet-stream" }
                            val b64 = Base64.encodeToString(data, Base64.NO_WRAP)
                            cid to "data:$mime;base64,$b64"
                        }.getOrNull()
                    }
                }.awaitAll().filterNotNull().toMap()
            }
            if (replacements.isNotEmpty()) {
                var next = htmlOrText
                for ((cid, uri) in replacements) {
                    next = replaceCid(cid, next, uri)
                }
                if (next != htmlOrText) htmlWithImages = next
            }
        } finally {
            isResolvingImages = false
        }
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (isHtml) {
            if (isResolvingImages && !showLoading) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(colors.pillFill)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(12.dp),
                        strokeWidth = 1.5.dp,
                        color = colors.muted,
                    )
                    Text(
                        "Loading inline images...",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                }
            }

            Box(modifier = Modifier.fillMaxWidth()) {
                if (!showLoading) {
                    HtmlBodyWebView(
                        html = wrapEmailHtml(prepared.main),
                        onHeight = { webHeightPx = it },
                        onLoadingChanged = { isWebLoading = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(with(LocalDensity.current) { webHeightPx.toDp().coerceAtLeast(1.dp) }),
                    )
                }
                if (showLoading) {
                    BodySkeleton(isResolvingImages = isResolvingImages)
                }
            }
        } else {
            MarkdownContentView(
                markdown = plainParts.first,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (hasQuoted && !showLoading) {
            GhostThreeDotButton(onClick = { showQuoted = true })
        }
    }

    if (showQuoted) {
        val quote = if (isHtml) prepared.quote.orEmpty() else plainParts.second.orEmpty()
        ModalBottomSheet(
            onDismissRequest = { showQuoted = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
            containerColor = colors.background,
            scrimColor = HomeChromeMetrics.modalScrim,
        ) {
            QuotedRepliesSheet(
                content = quote,
                isHtml = isHtml,
                onClose = { showQuoted = false },
            )
        }
    }
}

@Composable
private fun BodySkeleton(isResolvingImages: Boolean) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 1.5.dp,
                color = colors.muted,
            )
            Text(
                if (isResolvingImages) "Loading inline images..." else "Loading content...",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(14.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(colors.line),
        )
        Box(
            modifier = Modifier
                .width(260.dp)
                .height(14.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(colors.line),
        )
        Box(
            modifier = Modifier
                .width(180.dp)
                .height(14.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(colors.line),
        )
    }
}

@Composable
private fun GhostThreeDotButton(onClick: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .padding(top = 4.dp)
            .size(width = 34.dp, height = 20.dp)
            .clip(RoundedCornerShape(5.dp))
            .border(0.75.dp, colors.line.copy(alpha = 0.55f), RoundedCornerShape(5.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp),
    ) {
        repeat(3) {
            Box(
                modifier = Modifier
                    .size(3.5.dp)
                    .clip(CircleShape)
                    .background(colors.muted),
            )
        }
    }
}

@Composable
private fun QuotedRepliesSheet(
    content: String,
    isHtml: Boolean,
    onClose: () -> Unit,
) {
    val colors = inboxiesColors()
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Previous Replies",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onClose) {
                Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink)
            }
        }
        if (isHtml) {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        applyEmailHtmlWebViewSettings(javaScriptEnabled = false)
                        webViewClient = EmailLinkWebViewClient()
                        loadDataWithBaseURL(
                            EmailHtmlSanitizer.OPAQUE_ORIGIN,
                            wrapQuotedHtml(content),
                            "text/html",
                            "UTF-8",
                            null,
                        )
                    }
                },
                update = {
                    it.loadDataWithBaseURL(
                        EmailHtmlSanitizer.OPAQUE_ORIGIN,
                        wrapQuotedHtml(content),
                        "text/html",
                        "UTF-8",
                        null,
                    )
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(420.dp)
                    .padding(bottom = 24.dp),
            )
        } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(420.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 12.dp)
                    .padding(bottom = 24.dp),
            ) {
                MarkdownContentView(markdown = content)
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun HtmlBodyWebView(
    html: String,
    onHeight: (Float) -> Unit,
    onLoadingChanged: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val heightMeasurer = remember {
        """
        Math.ceil(Math.max(document.body.offsetHeight, document.body.getBoundingClientRect().height, document.body.scrollHeight))
        """.trimIndent()
    }
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                applyEmailHtmlWebViewSettings(javaScriptEnabled = true)
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                webViewClient = object : EmailLinkWebViewClient() {
                    override fun onPageFinished(view: WebView?, url: String?) {
                        view?.evaluateJavascript(heightMeasurer) { result ->
                            val measured = result?.trim('"')?.toFloatOrNull()
                            if (measured != null && measured > 0f) onHeight(measured)
                            onLoadingChanged(false)
                        }
                    }

                    override fun onLoadResource(view: WebView?, url: String?) {
                        super.onLoadResource(view, url)
                        view?.evaluateJavascript(heightMeasurer) { result ->
                            val measured = result?.trim('"')?.toFloatOrNull()
                            if (measured != null && measured > 0f) onHeight(measured)
                        }
                    }
                }
                tag = html
                loadDataWithBaseURL(EmailHtmlSanitizer.OPAQUE_ORIGIN, html, "text/html", "UTF-8", null)
            }
        },
        update = { webView ->
            val tag = webView.tag as? String
            if (tag != html) {
                onLoadingChanged(true)
                webView.tag = html
                webView.loadDataWithBaseURL(EmailHtmlSanitizer.OPAQUE_ORIGIN, html, "text/html", "UTF-8", null)
            }
        },
        modifier = modifier,
    )
}

private fun WebView.applyEmailHtmlWebViewSettings(javaScriptEnabled: Boolean) {
    settings.javaScriptEnabled = javaScriptEnabled
    settings.domStorageEnabled = false
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.allowFileAccessFromFileURLs = false
    settings.allowUniversalAccessFromFileURLs = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    settings.setSupportMultipleWindows(false)
    settings.mediaPlaybackRequiresUserGesture = true
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
}

private open class EmailLinkWebViewClient : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val uri = request?.url ?: return true
        if (uri.host == "inboxies.invalid") return false
        val scheme = uri.scheme?.lowercase().orEmpty()
        if (scheme == "http" || scheme == "https" || scheme == "mailto") {
            val context = view?.context ?: return true
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
            } catch (_: ActivityNotFoundException) {
            }
        }
        return true
    }
}

private fun looksLikeHtml(text: String): Boolean =
    Regex("</?[a-zA-Z][^>]*>").containsMatchIn(text)

private fun splitPlainTextReplies(text: String): Pair<String, String?> {
    val lines = text.split("\n")
    val headerRegex = Regex(
        """^(On\s.+wrote:|From:\s.+|Sent:\s.+|---\s*Original Message|-----Original Message|---------- Forwarded message)""",
        RegexOption.IGNORE_CASE,
    )
    for ((index, line) in lines.withIndex()) {
        val trimmed = line.trim()
        val isHeader = trimmed.isNotEmpty() && headerRegex.containsMatchIn(trimmed)
        val isQuoteLine = trimmed.startsWith(">")
        if ((isHeader || isQuoteLine) && index > 0) {
            val main = lines.subList(0, index).joinToString("\n").trim()
            val quote = lines.subList(index, lines.size).joinToString("\n").trim()
            if (main.isNotEmpty() && quote.isNotEmpty()) return main to quote
        }
    }
    return text to null
}

private fun replaceCid(cid: String, html: String, replacement: String): String {
    var result = html.replace(Regex("cid:$cid", RegexOption.IGNORE_CASE), replacement)
    result = result.replace(Regex("cid:<$cid>", RegexOption.IGNORE_CASE), replacement)
    return result
}

private fun wrapEmailHtml(bodyHtml: String): String {
    val bodySize = AppThemeDims.FontSize.body.value.toInt()
    return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <meta http-equiv="Content-Security-Policy" content="${EmailHtmlSanitizer.CONTENT_SECURITY_POLICY}">
        <style>
          :root { color-scheme: light dark; }
          html, body {
            margin: 0;
            padding: 0;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible;
          }
          body {
            display: flow-root;
            padding-bottom: 6px;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: ${bodySize}px;
            line-height: 1.45;
            color: #1f1f23;
            word-wrap: break-word;
            overflow-wrap: anywhere;
          }
          img { max-width: 100%; height: auto; }
          a { color: #2659d9; }
          pre, code { white-space: pre-wrap; }
          [style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
            position: relative !important;
          }
          @media (prefers-color-scheme: dark) {
            body { color: #f7f7f8; }
            a { color: #5888fb; }
          }
          .gmail_quote, .yahoo_quoted, .protonmail_quote, #divRplyFwdMsg, blockquote[type="cite"], #appendonsend {
            display: none !important;
          }
        </style>
        </head>
        <body>$bodyHtml</body>
        </html>
    """.trimIndent()
}

private fun wrapQuotedHtml(bodyContent: String): String {
    val bodySize = AppThemeDims.FontSize.body.value.toInt()
    val sanitized = EmailHtmlSanitizer.sanitize(bodyContent)
    return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <meta http-equiv="Content-Security-Policy" content="${EmailHtmlSanitizer.CONTENT_SECURITY_POLICY}">
        <style>
          :root { color-scheme: light dark; }
          html, body {
            margin: 0;
            padding: 16px 20px 32px 20px;
            background-color: transparent;
            -webkit-text-size-adjust: 100%;
          }
          body {
            display: flow-root;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: ${bodySize}px;
            line-height: 1.5;
            color: #1f1f23;
            word-wrap: break-word;
            overflow-wrap: anywhere;
          }
          img { max-width: 100%; height: auto; }
          a { color: #2659d9; }
          pre, code { white-space: pre-wrap; }
          [style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
            position: relative !important;
          }
          blockquote {
            border-left: 2px solid #d0d0d4;
            margin: 10px 0;
            padding-left: 12px;
            color: #5a5a60;
          }
          @media (prefers-color-scheme: dark) {
            body { color: #f7f7f8; }
            a { color: #5888fb; }
            blockquote {
              border-left-color: #3f3f46;
              color: #a1a1aa;
            }
          }
        </style>
        </head>
        <body>$sanitized</body>
        </html>
    """.trimIndent()
}
