import SwiftUI

// "Today's inbox" widget, round 2: depth (AVE-138). A deck of New mail you can flip
// through on the home screen. Everything here is something a real widget can draw or
// do: layered cards, shading and shadows are static rendering; the › button is an
// interactive `Button(intent:)` (iOS 17+) that moves the front card to the next thread,
// and WidgetKit animates the change between timeline entries. No gestures, no tilt,
// no continuous animation (widgets can't). The tilt "depth inspector" in the gallery
// is labelled preview-only.
// Android twin: `ui/widget/InboxWidgetDepth.kt`.

extension AppTheme.Widget {
    /// Card-stack tokens. Shading and shadows are black (the glass chrome's shadow color),
    /// so the stack stays grey-scale in both themes.
    enum Depth {
        /// Cards drawn behind the front one.
        static let backLayers = 2
        /// Each card back shrinks by this much (anchored at its top edge)...
        static let scaleStep: CGFloat = 0.06
        /// ...and peeks this far above the card in front of it.
        static let rise: CGFloat = 7
        /// `Color.black` laid over each card back, per layer (light / dark).
        static let shadeLight: Double = 0.045
        static let shadeDark: Double = 0.16
        /// Dark mode lifts the front card with a little `ink` (elevated surfaces are lighter).
        static let frontLiftDark: Double = 0.05
        static let cardRadius: CGFloat = 16
        static let cardShadowLight: Double = 0.10
        static let cardShadowDark: Double = 0.45
        /// Top-edge highlight (light catching the card's lip).
        static let lipLight: Double = 0.95
        static let lipDark: Double = 0.16
        static let nextButtonSize: CGFloat = 26
        static let dotSize: CGFloat = 4
        /// Where a dealt card goes: off to the trailing side with a slight turn.
        static let dealOffset = CGSize(width: 52, height: 10)
        static let dealRotation: Double = 7
        /// Inbox-zero mark floats this far above its ground shadow.
        static let floatHeight: CGFloat = 8
        /// The app's chrome spring. In the real widget WidgetKit drives the transition.
        static let flip = Animation.spring(response: 0.32, dampingFraction: 0.86)
    }
}

/// Where a card sits in the deck. `slot` 0 is the front; it wraps around the thread list.
struct InboxWidgetDeckPose: Equatable {
    var scale: CGFloat = 1
    var offset: CGSize = .zero
    var rotation: Double = 0
    var opacity: Double = 1
    /// How many layers back (drives shade); 0 for the front card.
    var depth: Int = 0
    var zIndex: Double = 0

    /// Same math as Android `InboxWidgetDeckPose.forSlot`.
    static func forSlot(_ slot: Int, count: Int, spread: CGFloat = 1) -> InboxWidgetDeckPose {
        typealias D = AppTheme.Widget.Depth
        let visible = D.backLayers + 1
        // The card that was just dealt off the front (only when the deck is deeper than what shows).
        if count > visible, slot == count - 1 {
            return InboxWidgetDeckPose(
                scale: 1,
                offset: D.dealOffset,
                rotation: D.dealRotation,
                opacity: 0,
                depth: 0,
                zIndex: 10
            )
        }
        let layer = min(slot, visible)
        return InboxWidgetDeckPose(
            scale: 1 - D.scaleStep * CGFloat(layer),
            offset: CGSize(width: 0, height: -D.rise * spread * CGFloat(layer)),
            rotation: 0,
            opacity: slot < visible ? 1 : 0,
            depth: layer,
            zIndex: Double(visible - layer)
        )
    }
}

/// One "Today's inbox" widget in the depth direction: a card deck for New mail, a floating
/// check for inbox zero. `front` is which thread is on top; `onNext` stands in for the
/// widget's `Button(intent: ShowNextThreadIntent())` (nil hides nothing; the button still draws).
struct InboxWidgetDepthMock: View {
    let family: InboxWidgetFamily
    let snapshot: InboxWidgetSnapshot
    var front: Int = 0
    var spread: CGFloat = 1
    var onNext: (() -> Void)?

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
        case (.small, false):
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    InboxWidgetHeader(isLive: true)
                    Spacer(minLength: 4)
                    Text("\(snapshot.newCount)")
                        .font(.inter(size: 13, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(snapshot.newCount)))
                    Text(" new")
                        .font(.inter(size: 12, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                }
                InboxWidgetDeck(threads: snapshot.threads, front: front, compact: true, spread: spread, onNext: onNext)
                    .padding(.top, 10 + AppTheme.Widget.Depth.rise * CGFloat(AppTheme.Widget.Depth.backLayers) * spread)
            }
        case (.small, true):
            VStack(alignment: .leading, spacing: 0) {
                InboxWidgetHeader(isLive: false)
                Spacer(minLength: 0)
                InboxWidgetFloatingZeroMark(size: 38)
                Text("Inbox zero")
                    .font(.inter(size: 17, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .padding(.top, 12)
                Text(InboxWidgetSnapshot.inboxZeroLine(on: snapshot.updatedAt))
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        case (.medium, false):
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

                InboxWidgetDeck(threads: snapshot.threads, front: front, compact: false, spread: spread, onNext: onNext)
                    .padding(.top, AppTheme.Widget.Depth.rise * CGFloat(AppTheme.Widget.Depth.backLayers) * spread)
            }
        case (.medium, true):
            HStack(alignment: .center, spacing: 18) {
                InboxWidgetFloatingZeroMark(size: 64)
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
}

// MARK: - Deck

/// The New-mail deck: every stored thread is drawn, posed by its slot from `front`.
/// In WidgetKit the same view identity (`thread.id`) lets the system animate the
/// pose change between timeline entries when the intent bumps `front`.
struct InboxWidgetDeck: View {
    let threads: [InboxWidgetSnapshot.Thread]
    let front: Int
    let compact: Bool
    var spread: CGFloat = 1
    var onNext: (() -> Void)?

    var body: some View {
        let count = threads.count
        ZStack(alignment: .top) {
            ForEach(Array(threads.enumerated()), id: \.element.id) { index, thread in
                let slot = count == 0 ? 0 : ((index - front) % count + count) % count
                let pose = InboxWidgetDeckPose.forSlot(slot, count: count, spread: spread)
                InboxWidgetDeckCard(
                    thread: thread,
                    depth: pose.depth,
                    isFront: slot == 0,
                    compact: compact,
                    position: slot == 0 ? index : nil,
                    total: count,
                    onNext: onNext
                )
                .scaleEffect(pose.scale, anchor: .top)
                .rotationEffect(.degrees(pose.rotation), anchor: .bottomTrailing)
                .offset(pose.offset)
                .opacity(pose.opacity)
                .zIndex(pose.zIndex)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// One card. Back cards keep their content but hide it, so it fades in as they come forward.
private struct InboxWidgetDeckCard: View {
    let thread: InboxWidgetSnapshot.Thread
    let depth: Int
    let isFront: Bool
    let compact: Bool
    /// Index of the front thread, for the position dots (nil on back cards).
    let position: Int?
    let total: Int
    var onNext: (() -> Void)?

    @Environment(\.colorScheme) private var colorScheme

    private typealias D = AppTheme.Widget.Depth

    var body: some View {
        let dark = colorScheme == .dark
        let shape = RoundedRectangle(cornerRadius: D.cardRadius, style: .continuous)
        cardContent
            .opacity(isFront ? 1 : 0)
            .padding(compact ? 10 : 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background {
                ZStack {
                    shape.fill(AppTheme.surface)
                    if dark { shape.fill(AppTheme.ink.opacity(D.frontLiftDark)) }
                    shape.fill(Color.black.opacity((dark ? D.shadeDark : D.shadeLight) * Double(depth)))
                }
                .shadow(color: .black.opacity(dark ? D.cardShadowDark : D.cardShadowLight), radius: 8, y: 3)
            }
            .overlay {
                // Light on the top lip, fading down the sides: reads as a card with thickness.
                shape.strokeBorder(
                    LinearGradient(
                        colors: [Color.white.opacity(dark ? D.lipDark : D.lipLight), Color.white.opacity(0)],
                        startPoint: .top,
                        endPoint: .center
                    ),
                    lineWidth: 0.75
                )
            }
            .overlay { shape.strokeBorder(AppTheme.line.opacity(dark ? 0.5 : 0.7), lineWidth: 0.5) }
            .accessibilityElement(children: .combine)
    }

    private var cardContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: compact ? 6 : 8) {
                InboxWidgetAvatar(name: thread.senderName, size: compact ? 20 : 24)
                Text(thread.senderName)
                    .font(.inter(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if !compact {
                    Text(thread.receivedAt.formatted(date: .omitted, time: .shortened))
                        .font(.inter(size: AppTheme.List.date, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }
            Text(thread.subject)
                .font(.inter(size: compact ? 11 : 12))
                .foregroundStyle(AppTheme.muted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, compact ? 5 : 7)
            Spacer(minLength: 0)
            HStack(spacing: 0) {
                InboxWidgetDeckDots(position: position ?? 0, total: total)
                Spacer(minLength: 0)
                InboxWidgetNextButton(onNext: onNext)
            }
        }
    }
}

/// Where the front card sits in the deck. Grey-scale: current dot `ink`, the rest faint.
private struct InboxWidgetDeckDots: View {
    let position: Int
    let total: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<min(total, InboxWidgetSnapshot.maxThreads), id: \.self) { index in
                Capsule()
                    .fill(AppTheme.ink.opacity(index == position ? 0.85 : 0.18))
                    .frame(width: index == position ? AppTheme.Widget.Depth.dotSize * 2.5 : AppTheme.Widget.Depth.dotSize,
                           height: AppTheme.Widget.Depth.dotSize)
            }
        }
        .accessibilityLabel("Email \(position + 1) of \(total)")
    }
}

/// The deck's › control. In the widget: `Button(intent: ShowNextThreadIntent(mailboxId:))`.
struct InboxWidgetNextButton: View {
    var onNext: (() -> Void)?

    var body: some View {
        Button {
            onNext?()
        } label: {
            Image(systemName: "chevron.forward")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(AppTheme.surface)
                .frame(width: AppTheme.Widget.Depth.nextButtonSize, height: AppTheme.Widget.Depth.nextButtonSize)
                .background { Circle().fill(AppTheme.ink) }
                .shadow(color: .black.opacity(0.18), radius: 3, y: 1.5)
                .contentShape(Circle())
        }
        .buttonStyle(InboxWidgetPressStyle())
        .accessibilityLabel("Next email")
    }
}

/// Touch-down feedback for the gallery stand-in. Home-screen widgets get the system's own
/// press highlight on intent buttons; this just keeps the mock from feeling dead.
private struct InboxWidgetPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(AppTheme.Widget.Depth.flip, value: configuration.isPressed)
    }
}

// MARK: - Inbox zero

/// The inbox-zero check, lifted off the widget: a soft ground shadow sits under it so the
/// glass disc reads as floating. Static (no bobbing; widgets can't animate continuously).
struct InboxWidgetFloatingZeroMark: View {
    let size: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        InboxWidgetZeroMark(size: size)
            .offset(y: -AppTheme.Widget.Depth.floatHeight * (size / 64))
            .background(alignment: .bottom) {
                Ellipse()
                    .fill(Color.black.opacity(colorScheme == .dark ? 0.55 : 0.16))
                    .frame(width: size * 0.78, height: size * 0.16)
                    .blur(radius: size * 0.08)
                    .offset(y: size * 0.06)
            }
            .frame(width: size, height: size)
    }
}

// MARK: - Previews

#Preview("Depth · small · new mail", traits: .sizeThatFitsLayout) {
    InboxWidgetDepthMock(family: .small, snapshot: .sampleHasMail).padding()
}

#Preview("Depth · small · inbox zero", traits: .sizeThatFitsLayout) {
    InboxWidgetDepthMock(family: .small, snapshot: .sampleInboxZero).padding()
}

#Preview("Depth · medium · new mail", traits: .sizeThatFitsLayout) {
    InboxWidgetDepthMock(family: .medium, snapshot: .sampleHasMail).padding()
}

#Preview("Depth · medium · inbox zero", traits: .sizeThatFitsLayout) {
    InboxWidgetDepthMock(family: .medium, snapshot: .sampleInboxZero).padding()
}

#Preview("Depth · medium · dark", traits: .sizeThatFitsLayout) {
    InboxWidgetDepthMock(family: .medium, snapshot: .sampleHasMail, front: 2)
        .padding()
        .background(AppTheme.background)
        .preferredColorScheme(.dark)
}
