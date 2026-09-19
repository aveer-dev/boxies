package co.inboxies.app.util

/** Outbound delivery lifecycle — mirrors `app/lib/delivery-status.ts`. */
object DeliveryStatus {
    fun isFailure(status: String?): Boolean =
        status == "failed" || status == "bounced" || status == "complained"

    fun label(status: String?): String = when (status) {
        "failed" -> "Send failed"
        "bounced" -> "Bounced"
        "complained" -> "Marked as spam"
        "queued" -> "Sending"
        "accepted" -> "Sent"
        else -> "Delivery issue"
    }
}
