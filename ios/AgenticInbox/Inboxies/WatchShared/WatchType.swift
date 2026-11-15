import SwiftUI

/// Inter on the watch (bundled; the phone's `Font.inter` lives in `AppTheme`, which
/// is UIKit-only). Sizes are the phone list's, nudged for the wrist. Shared with the
/// `InboxiesWatchWidgets` complications (AVE-146).
enum WatchType {
    static func inter(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "Inter-Bold"
        case .semibold: name = "Inter-SemiBold"
        case .medium: name = "Inter-Medium"
        default: name = "Inter-Regular"
        }
        return .custom(name, size: size)
    }

    static let title = inter(16, .semibold)
    static let sender = inter(15, .semibold)
    static let senderRead = inter(15, .medium)
    static let subject = inter(13)
    static let preview = inter(12)
    static let meta = inter(11)
    static let body = inter(14)
    static let action = inter(14, .medium)
}
