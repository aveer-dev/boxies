import SwiftUI

/// The watch's colors: `AppTheme`'s dark values (watch screens are OLED and dark only).
/// Not a new palette: `WatchPaletteTests` checks every entry against the matching
/// `AppTheme` token resolved in dark mode, so the two can't drift.
enum WatchPalette {
    struct RGB: Equatable {
        let red: Double
        let green: Double
        let blue: Double

        var color: Color { Color(red: red, green: green, blue: blue) }
    }

    /// `AppTheme.background` (dark).
    static let backgroundRGB = RGB(red: 0.05, green: 0.05, blue: 0.05)
    /// `AppTheme.surface` (dark).
    static let surfaceRGB = RGB(red: 0.11, green: 0.11, blue: 0.12)
    /// `AppTheme.ink` (dark).
    static let inkRGB = RGB(red: 0.98, green: 0.98, blue: 0.99)
    /// `AppTheme.muted` (dark).
    static let mutedRGB = RGB(red: 0.60, green: 0.60, blue: 0.65)
    /// `AppTheme.line` (dark).
    static let lineRGB = RGB(red: 0.20, green: 0.20, blue: 0.22)
    /// `AppTheme.pillFill` (dark).
    static let pillFillRGB = RGB(red: 0.18, green: 0.18, blue: 0.20)
    /// `AppTheme.accent` (dark): unread dots and the primary action only.
    static let accentRGB = RGB(red: 0.35, green: 0.55, blue: 1.0)
    /// `AppTheme.deepDarkRed` (dark): Report spam is red text, never a red fill.
    static let destructiveRGB = RGB(red: 0.90, green: 0.35, blue: 0.35)

    /// The phone's Archive swipe tint (`SwipeQuickAction.archive.swipeTint`).
    static let archiveSwipeRGB = RGB(red: 0.55, green: 0.35, blue: 0.85)

    static let background = backgroundRGB.color
    static let archiveSwipe = archiveSwipeRGB.color
    static let surface = surfaceRGB.color
    static let ink = inkRGB.color
    static let muted = mutedRGB.color
    static let line = lineRGB.color
    static let pillFill = pillFillRGB.color
    static let accent = accentRGB.color
    static let destructive = destructiveRGB.color
}
