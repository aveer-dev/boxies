package co.inboxies.app.util

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object OutboundLimits {
    const val MAX_MESSAGE_BYTES = 5 * 1024 * 1024
    const val SIZE_ERROR = "Message exceeds the 5 MiB outbound limit"
    const val VIDEO_REJECT = "Videos aren't supported (5 MiB send limit)"
    const val MAX_IMAGE_EDGE = 1600
    val jpegQualities = floatArrayOf(0.72f, 0.55f, 0.4f)

    fun utf8ByteLength(value: String): Int = value.toByteArray(Charsets.UTF_8).size

    fun estimateMessageBytes(html: String, text: String, attachmentBytes: List<Int>): Int =
        utf8ByteLength(html) + utf8ByteLength(text) + attachmentBytes.sum()

    fun remainingBudget(html: String, text: String, attachmentBytes: List<Int>): Int =
        max(0, MAX_MESSAGE_BYTES - estimateMessageBytes(html, text, attachmentBytes))
}

data class ComposePendingAttachment(
    val id: String = UUID.randomUUID().toString(),
    val filename: String,
    val mimeType: String,
    val size: Int,
    val base64: String,
)

class OutboundAttachmentException(message: String) : Exception(message)

object OutboundImageCompressor {
    private val imageExt = setOf("png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif")
    private val videoExt = setOf("mp4", "mov", "m4v", "avi", "mkv", "webm", "mpeg", "mpg")

    fun prepare(
        bytes: ByteArray,
        filename: String,
        mimeType: String,
        budget: Int,
    ): ComposePendingAttachment {
        val mime = mimeType.ifBlank { mimeFor(filename) }
        if (isVideo(mime, filename)) {
            throw OutboundAttachmentException(OutboundLimits.VIDEO_REJECT)
        }
        if (shouldReencodeAsJpeg(mime, filename, bytes.size, budget)) {
            return compressImage(bytes, filename, budget)
                ?: throw OutboundAttachmentException(OutboundLimits.SIZE_ERROR)
        }
        if (bytes.isEmpty() || bytes.size > budget) {
            throw OutboundAttachmentException(OutboundLimits.SIZE_ERROR)
        }
        return ComposePendingAttachment(
            filename = filename.ifBlank { "untitled" },
            mimeType = mime,
            size = bytes.size,
            base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
        )
    }

    private fun compressImage(bytes: ByteArray, filename: String, budget: Int): ComposePendingAttachment? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            if (bytes.size > budget) return null
            return ComposePendingAttachment(
                filename = filename,
                mimeType = mimeFor(filename),
                size = bytes.size,
                base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            )
        }

        var edge = min(OutboundLimits.MAX_IMAGE_EDGE, max(bounds.outWidth, bounds.outHeight))
        while (edge >= 320) {
            val sample = sampleSize(max(bounds.outWidth, bounds.outHeight), edge)
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: break
            try {
                val scaled = scaleToEdge(decoded, edge)
                val flattened = flattenOntoWhite(scaled)
                try {
                    for (quality in OutboundLimits.jpegQualities) {
                        val out = ByteArrayOutputStream()
                        flattened.compress(Bitmap.CompressFormat.JPEG, (quality * 100).roundToInt(), out)
                        val jpeg = out.toByteArray()
                        if (jpeg.size <= budget) {
                            return ComposePendingAttachment(
                                filename = jpegFilename(filename),
                                mimeType = "image/jpeg",
                                size = jpeg.size,
                                base64 = Base64.encodeToString(jpeg, Base64.NO_WRAP),
                            )
                        }
                    }
                } finally {
                    if (flattened !== scaled) flattened.recycle()
                    if (scaled !== decoded) scaled.recycle()
                }
            } finally {
                decoded.recycle()
            }
            val next = max(320, (edge * 0.75f).toInt())
            if (next >= edge) break
            edge = next
        }
        return null
    }

    private fun sampleSize(longest: Int, target: Int): Int {
        var sample = 1
        var size = longest
        while (size / 2 >= target) {
            sample *= 2
            size /= 2
        }
        return sample
    }

    private fun scaleToEdge(bitmap: Bitmap, maxEdge: Int): Bitmap {
        val longest = max(bitmap.width, bitmap.height)
        if (longest <= maxEdge) return bitmap
        val scale = maxEdge.toFloat() / longest
        val w = max(1, (bitmap.width * scale).roundToInt())
        val h = max(1, (bitmap.height * scale).roundToInt())
        return Bitmap.createScaledBitmap(bitmap, w, h, true)
    }

    /** JPEG has no alpha; transparent PNG/HEIC pixels otherwise become black. */
    private fun flattenOntoWhite(bitmap: Bitmap): Bitmap {
        if (!bitmap.hasAlpha()) return bitmap
        val out = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(bitmap, 0f, 0f, null)
        return out
    }

    private fun jpegFilename(filename: String): String {
        val stem = filename.substringBeforeLast('.', filename).ifBlank { "image" }
        return "$stem.jpg"
    }

    fun shouldReencodeAsJpeg(mime: String, filename: String, byteLength: Int, budget: Int): Boolean {
        if (!isImage(mime, filename)) return false
        val type = mime.lowercase()
        val ext = filename.substringAfterLast('.', "").lowercase()
        if (type == "image/gif" || ext == "gif") return false
        if (type == "image/svg+xml" || ext == "svg") return false
        if ((type == "image/png" || ext == "png") && byteLength <= budget && byteLength <= 256 * 1024) {
            return false
        }
        return true
    }

    fun isImage(mime: String, filename: String): Boolean {
        if (mime.lowercase().startsWith("image/")) return true
        return filename.substringAfterLast('.', "").lowercase() in imageExt
    }

    fun isVideo(mime: String, filename: String): Boolean {
        if (mime.lowercase().startsWith("video/")) return true
        return filename.substringAfterLast('.', "").lowercase() in videoExt
    }

    private fun mimeFor(filename: String): String {
        return when (filename.substringAfterLast('.', "").lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "heic", "heif" -> "image/heic"
            "pdf" -> "application/pdf"
            else -> "application/octet-stream"
        }
    }
}
