import Foundation

/// Outbound delivery lifecycle — mirrors `app/lib/delivery-status.ts`.
enum DeliveryStatusHelpers {
    static func isFailure(_ status: String?) -> Bool {
        guard let status else { return false }
        switch status {
        case "failed", "bounced", "complained":
            return true
        default:
            return false
        }
    }

    static func label(for status: String?) -> String {
        switch status {
        case "failed":
            return "Send failed"
        case "bounced":
            return "Bounced"
        case "complained":
            return "Marked as spam"
        case "queued":
            return "Sending"
        case "accepted":
            return "Sent"
        default:
            return "Delivery issue"
        }
    }
}
