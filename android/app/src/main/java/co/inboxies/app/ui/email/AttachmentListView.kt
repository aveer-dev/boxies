package co.inboxies.app.ui.email

import android.content.Intent
import android.webkit.MimeTypeMap
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.VideoFile
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Attachment
import co.inboxies.app.models.Email
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow

@Composable
fun AttachmentListView(email: Email, modifier: Modifier = Modifier) {
    val attachments = email.nonInlineAttachments
    if (attachments.isEmpty()) return

    val colors = inboxiesColors()
    val app = LocalAppModel.current
    val mailboxId by app.selectedMailboxId.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var downloadingId by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (attachments.size > 1) {
            Text(
                "${attachments.size} attachments",
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
        ) {
            attachments.forEach { attachment ->
                val kind = AttachmentFileKind(attachment)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .widthIn(max = 180.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.pillFill)
                        .clickable(enabled = downloadingId == null && mailboxId != null) {
                            val mid = mailboxId ?: return@clickable
                            scope.launch {
                                downloadingId = attachment.id
                                errorMessage = null
                                try {
                                    val data = withContext(Dispatchers.IO) {
                                        ApiClient.shared.getAttachment(mid, email.id, attachment.id)
                                    }
                                    val cacheDir = File(context.cacheDir, "attachments").apply { mkdirs() }
                                    val file = File(cacheDir, attachment.filename.ifBlank { attachment.id })
                                    withContext(Dispatchers.IO) { file.writeBytes(data) }
                                    val uri = FileProvider.getUriForFile(
                                        context,
                                        "${context.packageName}.fileprovider",
                                        file,
                                    )
                                    val mime = attachment.mimetype.ifBlank {
                                        MimeTypeMap.getSingleton()
                                            .getMimeTypeFromExtension(file.extension.lowercase())
                                            ?: "*/*"
                                    }
                                    val intent = Intent(Intent.ACTION_VIEW).apply {
                                        setDataAndType(uri, mime)
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    }
                                    context.startActivity(Intent.createChooser(intent, attachment.filename))
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Couldn't open attachment"
                                } finally {
                                    downloadingId = null
                                }
                            }
                        }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(28.dp)
                            .clip(RoundedCornerShape(7.dp))
                            .background(kind.tint.copy(alpha = 0.14f)),
                    ) {
                        Icon(
                            kind.icon,
                            contentDescription = null,
                            tint = kind.tint,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                    Column(modifier = Modifier.weight(1f, fill = false)) {
                        Text(
                            attachment.filename.ifBlank { "Attachment" },
                            fontFamily = InterFontFamily,
                            fontSize = 11.sp,
                            color = colors.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            formatByteCount(attachment.size),
                            fontFamily = InterFontFamily,
                            fontSize = 9.sp,
                            color = colors.muted,
                            maxLines = 1,
                        )
                    }
                    if (downloadingId == attachment.id) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 1.5.dp,
                            color = colors.muted,
                        )
                    }
                }
            }
        }

        errorMessage?.let { msg ->
            Text(
                msg,
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.deepDarkRed,
            )
        }
    }
}

private data class AttachmentFileKind(val icon: ImageVector, val tint: Color) {
    companion object {
        private val imageExt = setOf("png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif", "svg")
        private val videoExt = setOf("mp4", "mov", "m4v", "avi", "mkv", "webm")
        private val audioExt = setOf("mp3", "wav", "m4a", "aac", "flac", "ogg", "aiff")
        private val spreadsheetExt = setOf("xls", "xlsx", "csv", "numbers", "ods")
        private val presentationExt = setOf("ppt", "pptx", "key", "odp")
        private val wordExt = setOf("doc", "docx", "rtf", "pages", "odt")
        private val archiveExt = setOf("zip", "rar", "7z", "tar", "gz", "tgz")
        private val codeExt = setOf("js", "ts", "tsx", "jsx", "swift", "py", "rb", "go", "java", "kt", "json", "xml", "html", "css", "sh")
        private val textExt = setOf("txt", "md", "log")

        operator fun invoke(attachment: Attachment): AttachmentFileKind {
            val ext = attachment.filename.substringAfterLast('.', "").lowercase(Locale.US)
            val mime = attachment.mimetype.lowercase(Locale.US)
            return when {
                mime.startsWith("image/") || ext in imageExt ->
                    AttachmentFileKind(Icons.Outlined.Image, Color(0xFF337AD9))
                mime.startsWith("video/") || ext in videoExt ->
                    AttachmentFileKind(Icons.Outlined.VideoFile, Color(0xFF8F45D1))
                mime.startsWith("audio/") || ext in audioExt ->
                    AttachmentFileKind(Icons.Outlined.AudioFile, Color(0xFFC7387A))
                mime == "application/pdf" || ext == "pdf" ->
                    AttachmentFileKind(Icons.Outlined.PictureAsPdf, Color(0xFFD13838))
                mime.contains("spreadsheet") || mime.contains("excel") || ext in spreadsheetExt ->
                    AttachmentFileKind(Icons.Outlined.TableChart, Color(0xFF2E945C))
                mime.contains("presentation") || mime.contains("powerpoint") || ext in presentationExt ->
                    AttachmentFileKind(Icons.Outlined.Slideshow, Color(0xFFDB6B29))
                mime.contains("msword") || mime.contains("wordprocessing") || ext in wordExt ->
                    AttachmentFileKind(Icons.Outlined.Description, Color(0xFF3866C7))
                mime.contains("zip") || mime.contains("compressed") || ext in archiveExt ->
                    AttachmentFileKind(Icons.Outlined.FolderZip, Color(0xFF8C6B47))
                mime.contains("calendar") || ext == "ics" ->
                    AttachmentFileKind(Icons.Outlined.CalendarMonth, Color(0xFFD14747))
                ext in codeExt ->
                    AttachmentFileKind(Icons.Outlined.Code, Color(0xFF73737A))
                mime.startsWith("text/") || ext in textExt ->
                    AttachmentFileKind(Icons.Outlined.Description, Color(0xFF73737A))
                else ->
                    AttachmentFileKind(Icons.AutoMirrored.Outlined.InsertDriveFile, Color(0xFF73737A))
            }
        }
    }
}

private fun formatByteCount(size: Int): String {
    if (size <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    val digitGroups = (ln(size.toDouble()) / ln(1024.0)).toInt().coerceIn(0, units.lastIndex)
    val value = size / 1024.0.pow(digitGroups.toDouble())
    return String.format(Locale.US, "%.0f %s", value, units[digitGroups])
}
