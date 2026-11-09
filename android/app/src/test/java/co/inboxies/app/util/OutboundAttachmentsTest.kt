package co.inboxies.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream

/** Videos attach when they fit the 5 MiB budget (AVE-183). */
class OutboundAttachmentsTest {
    private val mib = 1024 * 1024

    @Test
    fun videosAreNotReencodedLikePhotos() {
        assertEquals(false, OutboundImageCompressor.shouldReencodeAsJpeg("video/mp4", "clip.mp4", 2 * mib, OutboundLimits.MAX_MESSAGE_BYTES))
    }

    /** Same strings as `workers/test/compose-attachments.test.mjs` and iOS. */
    @Test
    fun tooLargeMessageMatchesShared() {
        assertEquals(
            "This video is 12 MB. Messages can be up to 5 MB, attachments included.",
            OutboundLimits.tooLargeMessage((12.4 * mib).toLong(), OutboundLimits.MAX_MESSAGE_BYTES, isVideo = true),
        )
        assertEquals(
            "This file is 6.2 MB. Messages can be up to 5 MB, attachments included.",
            OutboundLimits.tooLargeMessage((6.2 * mib).toLong(), 4 * mib, isVideo = false),
        )
        assertEquals(
            "This video is 3.0 MB, but only 1.5 MB is left of the 5 MB message limit.",
            OutboundLimits.tooLargeMessage(3L * mib, (1.5 * mib).toInt(), isVideo = true),
        )
        assertEquals(
            "This video is 3.0 MB, and this message is already at the 5 MB limit.",
            OutboundLimits.tooLargeMessage(3L * mib, 0, isVideo = true),
        )
    }

    @Test
    fun readCappedReportsTheWholeSizeOfAnOversizedFile() {
        val bytes = ByteArray(300 * 1024)
        assertEquals(bytes.size, OutboundLimits.readCapped(ByteArrayInputStream(bytes), bytes.size).size)
        try {
            OutboundLimits.readCapped(ByteArrayInputStream(bytes), 100 * 1024) { total -> "total=$total" }
            fail("expected overflow")
        } catch (e: OutboundAttachmentException) {
            assertEquals("total=${bytes.size}", e.message)
        }
        try {
            OutboundLimits.readCapped(ByteArrayInputStream(bytes), 100 * 1024)
            fail("expected overflow")
        } catch (e: OutboundAttachmentException) {
            assertEquals(OutboundLimits.SIZE_ERROR, e.message)
        }
    }
}
