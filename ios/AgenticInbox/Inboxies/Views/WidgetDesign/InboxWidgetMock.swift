import SwiftUI
import WidgetKit

// "Today's inbox" widget, design mocks (AVE-138). Plain SwiftUI views compiled into the
// app (DEBUG gallery) and the `InboxiesWidget` extension (AVE-149), which builds its entry
// view from the round 2 pieces. Keep them free of app state (`AppModel`, networking,
// `@AppStorage`). The extension compiles with `INBOXIES_WIDGET` set.
// Android twin: `ui/widget/InboxWidgetMock.kt`.

extension AppTheme {
    /// Widget tokens. Colors stay `AppTheme.*` grey-scale (no `accent`, no new hues);
    /// these are sizes and the ink-bloom recipe.
    enum Widget {
        /// iPhone home-screen widget sizes (6.1"/6.3" class: iPhone 15/16/17 Pro).
        static let smallSize = CGSize(width: 170, height: 170)
        static let mediumSize = CGSize(width: 364, height: 170)
        /// Close to the system's widget mask; the real widget is clipped by iOS.
        static let cornerRadius: CGFloat = 22
        static let padding: CGFloat = 16
        static let countSize: CGFloat = 46
        static let avatarSize: CGFloat = 28
        static let rowAvatarSize: CGFloat = 26
        /// Avatars overlap by this much in the small stack.
        static let avatarOverlap: CGFloat = 9
        static let avatarRing: CGFloat = 2
        static let threadPanelRadius: CGFloat = 16
        /// Ambient ink bloom strength (`AppTheme.ink` opacity at the hot corner). Light
        /// mode reads as a soft graphite shade, dark mode as a pale moonlit glow. Grows
        /// with the New count and saturates at `glowFullAt` conversations.
        static let glowCalm: Double = 0.03
        static let glowActiveLight: Double = 0.15
        static let glowActiveDark: Double = 0.17
        static let glowFullAt = 5

        static func glowStrength(newCount: Int, dark: Bool) -> Double {
            guard newCount > 0 else { return glowCalm }
            let active = dark ? glowActiveDark : glowActiveLight
            let ratio = min(Double(newCount), Double(glowFullAt)) / Double(glowFullAt)
            // Even one new message is clearly brighter than inbox zero.
            return glowCalm + (active - glowCalm) * (0.55 + 0.45 * ratio)
        }
    }
}

enum InboxWidgetFamily: String, CaseIterable, Identifiable {
    case small
    case medium

    var id: String { rawValue }

    var size: CGSize {
        switch self {
        case .small: return AppTheme.Widget.smallSize
        case .medium: return AppTheme.Widget.mediumSize
        }
    }
}

/// One "Today's inbox" widget at a family's size: has-mail or inbox-zero, from the snapshot.
struct InboxWidgetMock: View {
    let family: InboxWidgetFamily
    let snapshot: InboxWidgetSnapshot

    var body: some View {
        content
            .padding(AppTheme.Widget.padding)
            .frame(width: family.size.width, height: family.size.height, alignment: .topLeading)
            .background { InboxWidgetAmbientBackground(newCount: snapshot.newCount) }
            .clipShape(RoundedRectangle(cornerRadius: AppTheme.Widget.cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: AppTheme.Widget.cornerRadius, style: .continuous)
                    .strokeBorder(AppTheme.line.opacity(0.6), lineWidth: 0.5)
            }
            .environment(\.font, .inter(size: 13))
    }

    @ViewBuilder
    private var content: some View {
        switch (family, snapshot.isInboxZero) {
        case (.small, false): SmallHasMail(snapshot: snapshot)
        case (.small, true): SmallInboxZero(snapshot: snapshot)
        case (.medium, false): MediumHasMail(snapshot: snapshot)
        case (.medium, true): MediumInboxZero(snapshot: snapshot)
        }
    }
}

// MARK: - Glass

extension View {
    /// Glass for the widget pieces. In the app (gallery) it's the real `liquidGlass`; in the
    /// widget extension Liquid Glass and materials don't render live, so it falls back to
    /// a translucent `surface` fill with the chrome's white hairline (what Android draws).
    @ViewBuilder
    func inboxWidgetGlass<S: InsettableShape>(in shape: S) -> some View {
        #if INBOXIES_WIDGET
        self
            .background { shape.fill(AppTheme.surface.opacity(0.6)) }
            .overlay { shape.strokeBorder(Color.white.opacity(0.45), lineWidth: 0.5) }
            .overlay { shape.strokeBorder(AppTheme.line.opacity(0.5), lineWidth: 0.5) }
        #else
        self.liquidGlass(in: shape)
        #endif
    }
}

// MARK: - Ambient background

/// Surface with a soft ink bloom (grey-scale only): a hot corner top-trailing and a
/// dimmer echo bottom-leading. Deeper as New grows; nearly gone at inbox zero.
struct InboxWidgetAmbientBackground: View {
    let newCount: Int
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let strength = AppTheme.Widget.glowStrength(newCount: newCount, dark: colorScheme == .dark)
        GeometryReader { proxy in
            let reach = max(proxy.size.width, proxy.size.height)
            ZStack {
                AppTheme.surface
                RadialGradient(
                    colors: [AppTheme.ink.opacity(strength), AppTheme.ink.opacity(0)],
                    center: UnitPoint(x: 1.0, y: -0.05),
                    startRadius: 0,
                    endRadius: reach * 0.95
                )
                RadialGradient(
                    colors: [AppTheme.ink.opacity(strength * 0.45), AppTheme.ink.opacity(0)],
                    center: UnitPoint(x: -0.1, y: 1.1),
                    startRadius: 0,
                    endRadius: reach * 0.7
                )
                // Top sheen so the glass pills have something to catch.
                LinearGradient(
                    colors: [Color.white.opacity(colorScheme == .dark ? 0.05 : 0.35), .clear],
                    startPoint: .top,
                    endPoint: .center
                )
            }
        }
    }
}

// MARK: - Small

private struct SmallHasMail: View {
    let snapshot: InboxWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            InboxWidgetHeader(isLive: true)
            Spacer(minLength: 0)
            InboxWidgetCount(count: snapshot.newCount, size: AppTheme.Widget.countSize)
            Text(snapshot.newCount == 1 ? "New conversation" : "New conversations")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.muted)
                .padding(.top, 2)
            Spacer(minLength: 10)
            HStack(alignment: .center, spacing: 6) {
                InboxWidgetAvatarStack(names: snapshot.threads.map(\.senderName), extra: max(snapshot.newCount - min(snapshot.threads.count, 3), 0))
                Spacer(minLength: 0)
                if snapshot.replyLaterCount > 0 {
                    InboxWidgetReplyLaterPill(count: snapshot.replyLaterCount, compact: true)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct SmallInboxZero: View {
    let snapshot: InboxWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            InboxWidgetHeader(isLive: false)
            Spacer(minLength: 0)
            InboxWidgetZeroMark(size: 38)
            Text("Inbox zero")
                .font(.inter(size: 17, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
                .padding(.top, 10)
            Text(InboxWidgetSnapshot.inboxZeroLine(on: snapshot.updatedAt))
                .font(.inter(size: 12))
                .foregroundStyle(AppTheme.muted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Medium

private struct MediumHasMail: View {
    let snapshot: InboxWidgetSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                InboxWidgetHeader(isLive: true)
                Spacer(minLength: 0)
                InboxWidgetCount(count: snapshot.newCount, size: AppTheme.Widget.countSize)
                Text("New")
                    .font(.inter(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.top, 2)
                Spacer(minLength: 10)
                if snapshot.replyLaterCount > 0 {
                    InboxWidgetReplyLaterPill(count: snapshot.replyLaterCount, compact: false)
                }
            }
            .frame(width: 108, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .topLeading)

            InboxWidgetThreadPanel(threads: Array(snapshot.threads.prefix(3)))
        }
    }
}

private struct MediumInboxZero: View {
    let snapshot: InboxWidgetSnapshot

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            InboxWidgetZeroMark(size: 64)
            VStack(alignment: .leading, spacing: 0) {
                InboxWidgetHeader(isLive: false)
                Text("Inbox zero")
                    .font(.inter(size: 22, weight: .bold))
                    .tracking(-0.3)
                    .foregroundStyle(AppTheme.ink)
                    .padding(.top, 14)
                Text(InboxWidgetSnapshot.inboxZeroLine(on: snapshot.updatedAt))
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
                    .padding(.top, 3)
                Spacer(minLength: 10)
                if snapshot.replyLaterCount > 0 {
                    InboxWidgetReplyLaterPill(count: snapshot.replyLaterCount, compact: false)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Pieces

/// "Inbox" with the tray glyph; the unread dot when there's something new.
struct InboxWidgetHeader: View {
    let isLive: Bool

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "tray.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
            Text("Inbox")
                .font(.inter(size: 12, weight: .semibold))
                .foregroundStyle(AppTheme.ink.opacity(0.8))
            if isLive {
                Circle()
                    .fill(AppTheme.unread)
                    .frame(width: 5, height: 5)
            }
        }
    }
}

struct InboxWidgetCount: View {
    let count: Int
    let size: CGFloat

    var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.inter(size: size, weight: .bold))
            .tracking(-1.5)
            .foregroundStyle(AppTheme.ink)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            // WidgetKit plays this when a new timeline entry changes the count (iOS 17+).
            .contentTransition(.numericText(value: Double(count)))
            // Tinted / clear home screens (iOS 26): the user's tint replaces ink.
            .widgetAccentable()
    }
}

/// Initials avatar: grey ink-tinted disc (lightens down the stack), ringed in surface
/// so overlaps read cleanly.
struct InboxWidgetAvatar: View {
    let name: String
    var size: CGFloat = AppTheme.Widget.avatarSize
    var index: Int = 0

    var body: some View {
        Text(AvatarInitials.from(name))
            .font(.inter(size: size * 0.38, weight: .semibold))
            .foregroundStyle(AppTheme.ink)
            .frame(width: size, height: size)
            .background {
                Circle()
                    .fill(AppTheme.surface)
                    .overlay { Circle().fill(AppTheme.ink.opacity(0.14 - Double(index) * 0.03)) }
            }
            .overlay { Circle().strokeBorder(AppTheme.surface, lineWidth: AppTheme.Widget.avatarRing) }
    }
}

private struct InboxWidgetAvatarStack: View {
    let names: [String]
    let extra: Int

    var body: some View {
        HStack(spacing: -AppTheme.Widget.avatarOverlap) {
            ForEach(Array(names.prefix(3).enumerated()), id: \.offset) { index, name in
                InboxWidgetAvatar(name: name, index: index)
                    .zIndex(Double(3 - index))
            }
            if extra > 0 {
                Text("+\(extra)")
                    .font(.inter(size: 10, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .frame(width: AppTheme.Widget.avatarSize, height: AppTheme.Widget.avatarSize)
                    .background { Circle().fill(AppTheme.pillFill) }
                    .overlay { Circle().strokeBorder(AppTheme.surface, lineWidth: AppTheme.Widget.avatarRing) }
            }
        }
    }
}

/// Glass pill: clock glyph + count ("2" compact, "2 Reply later" otherwise).
struct InboxWidgetReplyLaterPill: View {
    let count: Int
    let compact: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "clock")
                .font(.system(size: 10, weight: .semibold))
            Text(compact ? "\(count)" : "\(count) Reply later")
                .font(.inter(size: 11, weight: .semibold))
                .lineLimit(1)
        }
        .foregroundStyle(AppTheme.ink.opacity(0.85))
        .padding(.horizontal, compact ? 8 : 9)
        .frame(height: 24)
        .inboxWidgetGlass(in: Capsule())
        .accessibilityLabel("\(count) Reply later")
    }
}

/// Inbox-zero mark: ink check inside a glass disc with a faint ink halo.
struct InboxWidgetZeroMark: View {
    let size: CGFloat

    var body: some View {
        Image(systemName: "checkmark")
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(AppTheme.ink)
            .widgetAccentable()
            .frame(width: size, height: size)
            .inboxWidgetGlass(in: Circle())
            .background {
                Circle()
                    .fill(AppTheme.ink.opacity(0.10))
                    .blur(radius: size * 0.3)
            }
    }
}

/// Top three New threads in one glass panel with flat rows and hairlines.
private struct InboxWidgetThreadPanel: View {
    let threads: [InboxWidgetSnapshot.Thread]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(threads.enumerated()), id: \.element.id) { index, thread in
                if index > 0 {
                    Rectangle()
                        .fill(AppTheme.List.separatorColor)
                        .frame(height: AppTheme.List.separatorHeight)
                        .padding(.leading, 10 + AppTheme.Widget.rowAvatarSize + 9)
                }
                InboxWidgetThreadRow(thread: thread, index: index)
                    .frame(maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .inboxWidgetGlass(in: RoundedRectangle(cornerRadius: AppTheme.Widget.threadPanelRadius, style: .continuous))
    }
}

private struct InboxWidgetThreadRow: View {
    let thread: InboxWidgetSnapshot.Thread
    let index: Int

    var body: some View {
        HStack(spacing: 9) {
            InboxWidgetAvatar(name: thread.senderName, size: AppTheme.Widget.rowAvatarSize, index: index)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(thread.senderName)
                        .font(.inter(size: 12, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Text(thread.receivedAt.formatted(date: .omitted, time: .shortened))
                        .font(.inter(size: AppTheme.List.date, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
                Text(thread.subject)
                    .font(.inter(size: 11))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
    }
}

// MARK: - Previews

#Preview("Small · new mail", traits: .sizeThatFitsLayout) {
    InboxWidgetMock(family: .small, snapshot: .sampleHasMail).padding()
}

#Preview("Small · inbox zero", traits: .sizeThatFitsLayout) {
    InboxWidgetMock(family: .small, snapshot: .sampleInboxZero).padding()
}

#Preview("Medium · new mail", traits: .sizeThatFitsLayout) {
    InboxWidgetMock(family: .medium, snapshot: .sampleHasMail).padding()
}

#Preview("Medium · inbox zero", traits: .sizeThatFitsLayout) {
    InboxWidgetMock(family: .medium, snapshot: .sampleInboxZero).padding()
}

#if DEBUG && !INBOXIES_WIDGET
#Preview("Gallery · dark") {
    InboxWidgetGallery().preferredColorScheme(.dark)
}
#endif
