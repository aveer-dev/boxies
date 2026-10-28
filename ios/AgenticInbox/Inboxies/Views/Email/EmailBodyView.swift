import SwiftUI
import UIKit
import WebKit

/// Renders HTML email bodies; falls back to plain text when needed.
/// Inline `cid:` images are fetched via the attachment API and inlined as data URIs
/// (web does the same rewrite in `rewriteInlineImages`).
struct EmailBodyView: View {
    let htmlOrText: String
    var mailboxId: String?
    var emailId: String?
    var attachments: [Attachment] = []

    @State private var htmlWithImages: String?
    @State private var webHeight: CGFloat = 1
    @State private var isWebLoading = true
    @State private var isResolvingImages = false
    @State private var activeQuotedContent: QuotedMailContent? = nil
    /// Remote images stay blocked until the reader taps "Load images" (per message).
    @State private var allowsRemoteImages = false
    /// Sanitized body, computed once per source off the main actor (never during `body`).
    @State private var prepared: PreparedState?
    @Environment(\.colorScheme) private var colorScheme

    private struct PreparedState: Equatable {
        let emailKey: String
        let sourceKey: String
        let body: EmailHTMLSanitizer.PreparedBody
    }

    private var isHTML: Bool {
        htmlOrText.range(of: #"</?[a-zA-Z][^>]*>"#, options: .regularExpression) != nil
    }

    private var sourceHTML: String {
        htmlWithImages ?? htmlOrText
    }

    private var sanitizeKey: String {
        EmailHTMLSanitizer.cacheKey(emailId: emailId, html: sourceHTML)
    }

    private var bodyHTML: String {
        prepared?.body.main ?? ""
    }

    /// Dark mode: designed mail keeps its colours on a light paper card; simple mail goes dark.
    private var appearance: EmailBodyAppearance {
        EmailBodyAppearance(colorScheme: colorScheme, hasOwnColors: prepared?.body.mainHasOwnColors ?? false)
    }

    private var showLoading: Bool {
        isHTML && (prepared == nil || isWebLoading || webHeight <= 1)
    }

    private var hasBlockedRemoteImages: Bool {
        guard isHTML, !allowsRemoteImages else { return false }
        return prepared?.body.hasRemoteImages ?? false
    }

    /// Opted-in policy only after "Load images"; otherwise remote `https:` images are blocked.
    private var contentSecurityPolicy: String {
        allowsRemoteImages
            ? EmailHTMLSanitizer.contentSecurityPolicy
            : EmailHTMLSanitizer.remoteImagesBlockedPolicy
    }

    private var hasQuotedReplies: Bool {
        if isHTML {
            return prepared?.body.quote != nil
        } else {
            return plainTextParts.quote != nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isHTML {
                if isResolvingImages && !showLoading {
                    inlineImageLoadingBar
                }

                if hasBlockedRemoteImages && !showLoading {
                    remoteImagesBar
                        .transition(.opacity)
                }

                ZStack(alignment: .topLeading) {
                    if prepared != nil {
                        HTMLWebView(
                            html: wrappedHTML,
                            contentHeight: $webHeight,
                            isLoading: $isWebLoading
                        )
                        .frame(maxWidth: .infinity, alignment: .top)
                        .frame(height: max(webHeight, 1))
                        .background {
                            if appearance == .paper {
                                RoundedRectangle(cornerRadius: EmailBodyAppearance.paperCornerRadius, style: .continuous)
                                    .fill(AppTheme.mailPaper)
                            }
                        }
                        .opacity(showLoading ? 0 : 1)
                    }

                    if showLoading {
                        bodySkeleton
                            .transition(.opacity)
                    }
                }
            } else {
                let parts = plainTextParts
                MarkdownContentView(
                    text: parts.main,
                    fontSize: AppTheme.FontSize.body
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            }

            if hasQuotedReplies && !showLoading {
                Button {
                    if let quote = (isHTML ? prepared?.body.quote : plainTextParts.quote) {
                        activeQuotedContent = QuotedMailContent(
                            text: quote,
                            isHTML: isHTML,
                            allowsRemoteImages: allowsRemoteImages,
                            hasOwnColors: isHTML && (prepared?.body.quoteHasOwnColors ?? false)
                        )
                    }
                } label: {
                    GhostThreeDotButton()
                }
                .buttonStyle(GhostButtonStyle())
                .accessibilityLabel("Show previous email replies")
                .accessibilityHint("Opens previous email replies in a modal")
                .padding(.top, 4)
                .transition(.opacity)
            }
        }
        .task(id: resolveTaskID) {
            await resolveInlineImages()
        }
        .task(id: sanitizeKey) {
            await prepareBody()
        }
        .onChange(of: resolveTaskID) { _, _ in
            activeQuotedContent = nil
            webHeight = 1
            isWebLoading = true
        }
        .onChange(of: emailId) { _, _ in
            activeQuotedContent = nil
            allowsRemoteImages = false
            prepared = nil
            webHeight = 1
            isWebLoading = true
        }
        .sheet(item: $activeQuotedContent) { quoted in
            QuotedRepliesModalView(
                content: quoted.text,
                isHTML: quoted.isHTML,
                attachments: attachments,
                allowsRemoteImages: quoted.allowsRemoteImages,
                hasOwnColors: quoted.hasOwnColors
            )
        }
    }

    /// Web parity: remote images are opt-in per message.
    private var remoteImagesBar: some View {
        HStack(spacing: 6) {
            Image(systemName: "photo")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(AppTheme.muted)
            Text("Remote images are hidden")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.muted)
            Text("·")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.muted)
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    allowsRemoteImages = true
                }
            } label: {
                Text("Load images")
                    .font(.inter(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.accent)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Loads images from the sender's servers for this message")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(AppTheme.pillFill)
        .clipShape(Capsule())
    }

    private var inlineImageLoadingBar: some View {
        HStack(spacing: 6) {
            ProgressView()
                .controlSize(.small)
            Text("Loading inline images...")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.muted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(AppTheme.pillFill)
        .clipShape(Capsule())
    }

    private var bodySkeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text(isResolvingImages ? "Loading inline images..." : "Loading content...")
                    .font(.inter(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
            }
            .padding(.bottom, 2)

            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppTheme.line)
                    .frame(height: 14)
                    .frame(maxWidth: .infinity)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppTheme.line)
                    .frame(height: 14)
                    .frame(width: 260)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppTheme.line)
                    .frame(height: 14)
                    .frame(width: 180)
            }
            .skeletonPulse(true)
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var resolveTaskID: String {
        "\(emailId ?? "")|\(htmlOrText.count)|\(attachments.map(\.id).joined(separator: ","))"
    }

    private var plainTextParts: (main: String, quote: String?) {
        Self.splitPlainTextReplies(htmlOrText)
    }

    /// Splits plain text emails into the main reply message and the previous email replies if present.
    static func splitPlainTextReplies(_ text: String) -> (main: String, quote: String?) {
        let lines = text.components(separatedBy: "\n")
        let replyHeaderRegex = try? NSRegularExpression(
            pattern: #"^(On\s.+wrote:|From:\s.+|Sent:\s.+|---\s*Original Message|-----Original Message|---------- Forwarded message)"#,
            options: .caseInsensitive
        )

        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let isHeader: Bool = {
                guard let regex = replyHeaderRegex, !trimmed.isEmpty else { return false }
                let range = NSRange(location: 0, length: (trimmed as NSString).length)
                return regex.firstMatch(in: trimmed, range: range) != nil
            }()

            let isQuoteLine = trimmed.hasPrefix(">")

            if (isHeader || isQuoteLine) && index > 0 {
                let main = lines[0..<index].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                let quote = lines[index...].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                if !main.isEmpty && !quote.isEmpty {
                    return (main: main, quote: quote)
                }
            }
        }
        return (main: text, quote: nil)
    }

    private var wrappedHTML: String {
        """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <meta http-equiv="Content-Security-Policy" content="\(contentSecurityPolicy)">
        <style>
          :root { color-scheme: \(appearance.cssColorScheme); }
          html, body {
            margin: 0;
            padding: 0;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible;
            -webkit-text-size-adjust: 100%;
          }
          body {
            display: flow-root;
            padding-bottom: 6px;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: \(Int(AppTheme.FontSize.body))px;
            line-height: 1.45;
            color: \(appearance.text);
            word-wrap: break-word;
            overflow-wrap: anywhere;
          }
          img { max-width: 100%; height: auto; }
          a { color: \(appearance.link); }
          pre, code { white-space: pre-wrap; }
          [style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
            position: relative !important;
          }
          \(appearance == .paper ? "body { padding: \(EmailBodyAppearance.paperPadding); }" : "")

          .gmail_quote, .yahoo_quoted, .protonmail_quote, #divRplyFwdMsg, blockquote[type="cite"], #appendonsend {
            display: none !important;
          }
          \(EmailBodyFit.css)
        </style>
        </head>
        <body><div id="\(EmailBodyFit.scrollerID)"><div id="\(EmailBodyFit.boxID)"><div id="\(EmailBodyFit.contentID)">\(bodyHTML)</div></div></div>
        </body>
        </html>
        """
    }

    /// Keeps the current body on screen while inline images re-sanitize the same message;
    /// a different message starts from the skeleton.
    @MainActor
    private func prepareBody() async {
        guard isHTML else {
            prepared = nil
            return
        }
        let emailKey = EmailHTMLSanitizer.cacheKey(emailId: emailId, html: htmlOrText)
        let sourceKey = sanitizeKey
        if prepared?.sourceKey == sourceKey { return }
        if prepared?.emailKey != emailKey { prepared = nil }
        let source = sourceHTML
        let body = await EmailHTMLSanitizer.prepareOffMain(source, key: sourceKey)
        guard !Task.isCancelled, sanitizeKey == sourceKey else { return }
        prepared = PreparedState(emailKey: emailKey, sourceKey: sourceKey, body: body)
    }

    @MainActor
    private func resolveInlineImages() async {
        htmlWithImages = nil
        guard isHTML, let mailboxId, let emailId else { return }

        let targets = attachments.filter { $0.normalizedContentId != nil }
        guard !targets.isEmpty else { return }

        isResolvingImages = true
        defer { isResolvingImages = false }

        var replacements: [String: String] = [:]
        await withTaskGroup(of: (String, String)?.self) { group in
            for attachment in targets {
                guard let cid = attachment.normalizedContentId else { continue }
                group.addTask {
                    do {
                        let data = try await APIClient.shared.getAttachment(
                            mailboxId: mailboxId,
                            emailId: emailId,
                            attachmentId: attachment.id
                        )
                        let mime = attachment.mimetype.isEmpty
                            ? "application/octet-stream"
                            : attachment.mimetype
                        return (cid, "data:\(mime);base64,\(data.base64EncodedString())")
                    } catch {
                        return nil
                    }
                }
            }
            for await item in group {
                if let (cid, uri) = item {
                    replacements[cid] = uri
                }
            }
        }

        guard !Task.isCancelled, !replacements.isEmpty else { return }
        var next = htmlOrText
        for (cid, uri) in replacements {
            next = Self.replaceCID(cid, in: next, with: uri)
        }
        guard next != htmlOrText else { return }
        htmlWithImages = next
    }

    /// Mirrors web `rewriteInlineImages`: swap `cid:image001@example.com` for a loadable URL.
    static func replaceCID(_ cid: String, in html: String, with replacement: String) -> String {
        var result = html.replacingOccurrences(
            of: "cid:\(cid)",
            with: replacement,
            options: .caseInsensitive
        )
        result = result.replacingOccurrences(
            of: "cid:<\(cid)>",
            with: replacement,
            options: .caseInsensitive
        )
        return result
    }
}

private enum EmailWebViewIsolation {
    static let heightWorld = WKContentWorld.defaultClient

    /// Fits wide mail to the width (`EmailBodyFit`), then reports the body height.
    static let heightScriptSource = EmailBodyFit.script + """
    function postHeight() {
      const h = Math.ceil(Math.max(
        document.body.offsetHeight,
        document.body.getBoundingClientRect().height,
        document.body.scrollHeight
      ));
      if (window.webkit && window.webkit.messageHandlers.bodyHeight) {
        window.webkit.messageHandlers.bodyHeight.postMessage(h);
      }
    }
    function refitAndPost() {
      inboxiesFitBody();
      postHeight();
    }
    if (typeof ResizeObserver !== 'undefined') {
      // The scaled box has a fixed size; refit when the mail itself grows (fonts, images).
      var inboxiesContent = document.getElementById('\(EmailBodyFit.contentID)');
      if (inboxiesContent) { new ResizeObserver(refitAndPost).observe(inboxiesContent); }
    }
    window.addEventListener('load', refitAndPost);
    window.addEventListener('resize', refitAndPost);
    document.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('load', refitAndPost);
      img.addEventListener('error', refitAndPost);
    });
    if (typeof ResizeObserver !== 'undefined') {
      // Height only: the body follows the box, which the fit sizes.
      new ResizeObserver(postHeight).observe(document.body);
    }
    refitAndPost();
    """

    static func configuration(allowsJavaScript: Bool, heightHandler: WKScriptMessageHandler?) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = allowsJavaScript
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.suppressesIncrementalRendering = false
        // `allowsContentJavaScript` only gates the page's own scripts; this app-world
        // user script and `evaluateJavaScript(in: heightWorld)` run either way.
        if let heightHandler {
            config.userContentController.add(heightHandler, contentWorld: heightWorld, name: "bodyHeight")
            let script = WKUserScript(
                source: heightScriptSource,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true,
                in: heightWorld
            )
            config.userContentController.addUserScript(script)
        }
        return config
    }

    /// `target=_blank` never creates an in-app WKWebView; user-activated http(s)/mailto go to the system.
    static func createPopup(for action: WKNavigationAction) -> WKWebView? {
        apply(EmailLinkPolicy.decide(url: action.request.url, navigationType: action.navigationType))
        return nil
    }

    static func decidePolicy(
        for action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let decision = EmailLinkPolicy.decide(url: action.request.url, navigationType: action.navigationType)
        apply(decision)
        decisionHandler(decision.navigationPolicy)
    }

    private static func apply(_ decision: EmailLinkPolicy.Decision) {
        if case .openExternally(let url) = decision {
            UIApplication.shared.open(url)
        }
    }
}

/// Wide mail (fixed 600px+ newsletter cards, rigid tables) on a phone-width body (AVE-89).
/// The inline mail WebView never scrolls itself (the thread `ScrollView` does), so overflow
/// used to be clipped with no way to reach it. Now the body is scaled down to fit the width (Apple Mail / Gmail behaviour), never below `minScale` so text stays
/// legible; whatever still overflows scrolls sideways inside `scrollerID`, while vertical
/// drags keep going to the thread. Android twin: `EmailBodyFit` in `EmailBodyView.kt`.
enum EmailBodyFit {
    static let scrollerID = "inboxies-scroll"
    static let boxID = "inboxies-fit-box"
    static let contentID = "inboxies-fit"
    static let minScale = 0.5

    static let css = """
    #\(scrollerID) { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; }
    #\(scrollerID), #\(scrollerID) * { -webkit-text-size-adjust: none !important; text-size-adjust: none !important; }
    """

    /// Defines `inboxiesFitBody()`; idempotent, so it can rerun on load, image load and resize.
    /// Lays the mail out at its natural width, scales it with `transform` (CSS `zoom` leaves
    /// glyphs unscaled in iOS WebKit), and sizes a clipping box to the scaled size so the
    /// reported body height stays exact.
    static let script = """
    function inboxiesFitBody() {
      var scroller = document.getElementById('\(scrollerID)');
      var box = document.getElementById('\(boxID)');
      var content = document.getElementById('\(contentID)');
      if (!scroller || !box || !content) { return; }
      box.style.overflow = '';
      box.style.width = '';
      box.style.height = '';
      content.style.width = '';
      content.style.transform = '';
      var avail = scroller.clientWidth;
      var natural = scroller.scrollWidth;
      if (avail <= 0 || natural <= avail + 1) { return; }
      var scale = Math.max(\(minScale), avail / natural);
      content.style.width = natural + 'px';
      content.style.transformOrigin = '0 0';
      content.style.transform = 'scale(' + scale + ')';
      // The box clips the unscaled layout, so the scroll range is the scaled width only.
      box.style.overflow = 'hidden';
      box.style.width = Math.ceil(natural * scale) + 'px';
      box.style.height = Math.ceil(content.offsetHeight * scale) + 'px';
    }

    """
}

/// Pure navigation policy for sanitized mail WebViews. Isolated from WKWebView so Simulator
/// fixtures and source tests can assert the same rules the delegates use.
enum EmailLinkPolicy {
    enum Decision: Equatable {
        case allow
        case cancel
        case openExternally(URL)

        var navigationPolicy: WKNavigationActionPolicy {
            switch self {
            case .allow: return .allow
            case .cancel, .openExternally: return .cancel
            }
        }
    }

    static func decide(url: URL?, navigationType: WKNavigationType) -> Decision {
        guard let url else { return .cancel }
        let scheme = url.scheme?.lowercased() ?? ""
        // Initial loadHTMLString uses this host with navigationType `.other`.
        // Never allow in-WebView clicks to stay on the opaque origin.
        if url.host == "inboxies.invalid" {
            if navigationType == .other || navigationType == .reload {
                return .allow
            }
            return .cancel
        }
        if navigationType == .other && (scheme == "about" || url.absoluteString.isEmpty) {
            return .allow
        }
        if ["http", "https", "mailto"].contains(scheme) {
            if navigationType == .linkActivated {
                return .openExternally(url)
            }
            return .cancel
        }
        return .cancel
    }
}

private struct HTMLWebView: UIViewRepresentable {
    let html: String
    @Binding var contentHeight: CGFloat
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(height: $contentHeight, isLoading: $isLoading)
    }

    func makeUIView(context: Context) -> WKWebView {
        // Page JS stays off; the height probe is an app-world user script, which still runs.
        let config = EmailWebViewIsolation.configuration(allowsJavaScript: false, heightHandler: context.coordinator)
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.height = $contentHeight
        context.coordinator.isLoading = $isLoading
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        DispatchQueue.main.async {
            self.isLoading = true
        }
        // Opaque-to-API origin so sanitized mail still cannot read backend cookies.
        webView.loadHTMLString(html, baseURL: EmailHTMLSanitizer.opaqueOrigin)
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(
            forName: "bodyHeight",
            contentWorld: EmailWebViewIsolation.heightWorld
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var height: Binding<CGFloat>
        var isLoading: Binding<Bool>
        var loadedHTML: String?

        init(height: Binding<CGFloat>, isLoading: Binding<Bool>) {
            self.height = height
            self.isLoading = isLoading
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            if message.name == "bodyHeight" {
                applyHeight(message.body)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            EmailWebViewIsolation.decidePolicy(for: navigationAction, decisionHandler: decisionHandler)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            EmailWebViewIsolation.createPopup(for: navigationAction)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // ObjC entry point on purpose: with an iOS 17 target the Swift `Result` overload links
            // /usr/lib/swift/libswiftWebKit.dylib, which the iOS 18.5 runtime lacks (dyld abort at launch).
            webView.__evaluateJavaScript(
                "inboxiesFitBody(); Math.ceil(Math.max(document.body.offsetHeight, document.body.getBoundingClientRect().height, document.body.scrollHeight))",
                inFrame: nil,
                in: EmailWebViewIsolation.heightWorld
            ) { [weak self] value, error in
                if error == nil {
                    self?.applyHeight(value)
                } else {
                    DispatchQueue.main.async {
                        self?.isLoading.wrappedValue = false
                    }
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async { [weak self] in
                self?.isLoading.wrappedValue = false
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async { [weak self] in
                self?.isLoading.wrappedValue = false
            }
        }

        private func applyHeight(_ raw: Any?) {
            let measured: CGFloat
            if let number = raw as? Double {
                measured = CGFloat(number)
            } else if let number = raw as? CGFloat {
                measured = number
            } else if let number = raw as? Int {
                measured = CGFloat(number)
            } else if let number = raw as? NSNumber {
                measured = CGFloat(truncating: number)
            } else {
                DispatchQueue.main.async {
                    self.isLoading.wrappedValue = false
                }
                return
            }
            let next = max(measured.rounded(.up), 1)
            DispatchQueue.main.async {
                if abs(self.height.wrappedValue - next) > 1 {
                    self.height.wrappedValue = next
                }
                self.isLoading.wrappedValue = false
            }
        }
    }
}

/// Data model for quoted content presented in the modal sheet.
struct QuotedMailContent: Identifiable {
    let id = UUID()
    let text: String
    let isHTML: Bool
    var allowsRemoteImages = false
    /// Sanitized quoted HTML sets its own colours (paper card in dark mode).
    var hasOwnColors = false
}

/// How an HTML mail body is coloured. Dark mode follows Gmail / Apple Mail / Hey:
/// simple mail (no colours of its own) takes the app theme; designed mail
/// (`EmailHTMLSanitizer.hasOwnColors`) is shown as designed on a light paper card,
/// so it never turns into dark-on-dark text. Light mode is unchanged.
/// The sanitizer strips `<style>` / `<meta>`, so a mail's own dark variant can't apply.
enum EmailBodyAppearance: Equatable {
    case light
    case dark
    case paper

    static let paperCornerRadius: CGFloat = 12
    static let paperPadding = "14px 16px"

    init(colorScheme: ColorScheme, hasOwnColors: Bool) {
        if colorScheme == .dark {
            self = hasOwnColors ? .paper : .dark
        } else {
            self = .light
        }
    }

    var cssColorScheme: String { self == .dark ? "dark" : "light" }
    var text: String { self == .dark ? "#f7f7f8" : "#1f1f23" }
    var link: String { self == .dark ? "#5888fb" : "#2659d9" }
    var quoteBorder: String { self == .dark ? "#3f3f46" : "#d0d0d4" }
    var quoteText: String { self == .dark ? "#a1a1aa" : "#5a5a60" }
}

/// Horizontal three-dot toggle button with ghost styling.
struct GhostThreeDotButton: View {
    var body: some View {
        HStack(spacing: 3) {
            Circle()
                .fill(AppTheme.muted)
                .frame(width: 3.5, height: 3.5)
            Circle()
                .fill(AppTheme.muted)
                .frame(width: 3.5, height: 3.5)
            Circle()
                .fill(AppTheme.muted)
                .frame(width: 3.5, height: 3.5)
        }
        .frame(width: 34, height: 20)
        .contentShape(Rectangle())
    }
}

/// Ghost button style with transparent background and subtle press state.
struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(configuration.isPressed ? AppTheme.pillFill.opacity(0.85) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(
                        configuration.isPressed ? AppTheme.line : AppTheme.line.opacity(0.55),
                        lineWidth: 0.75
                    )
            )
            .opacity(configuration.isPressed ? 0.75 : 1.0)
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Modal sheet displaying previous email replies in full without constraining the parent view.
struct QuotedRepliesModalView: View {
    let content: String
    let isHTML: Bool
    var attachments: [Attachment] = []
    var allowsRemoteImages = false
    var hasOwnColors = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    private var appearance: EmailBodyAppearance {
        EmailBodyAppearance(colorScheme: colorScheme, hasOwnColors: hasOwnColors)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                Text("Previous Replies")
                    .font(.inter(size: 17, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)

                Spacer()

                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 52, height: 52)
                        .liquidGlass(in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            ZStack {
                AppTheme.background.ignoresSafeArea()

                if isHTML {
                    if appearance == .paper {
                        QuotedHTMLFullView(html: content, allowsRemoteImages: allowsRemoteImages, appearance: appearance)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(
                                AppTheme.mailPaper,
                                in: RoundedRectangle(cornerRadius: EmailBodyAppearance.paperCornerRadius, style: .continuous)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: EmailBodyAppearance.paperCornerRadius, style: .continuous))
                            .padding(.horizontal, 12)
                            .padding(.bottom, 12)
                    } else {
                        QuotedHTMLFullView(html: content, allowsRemoteImages: allowsRemoteImages, appearance: appearance)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            MarkdownContentView(
                                text: content,
                                fontSize: AppTheme.FontSize.body
                            )
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                    }
                }
            }
        }
        .background(AppTheme.background)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
    }
}

/// Full scrollable web view for quoted HTML in a modal.
private struct QuotedHTMLFullView: UIViewRepresentable {
    let html: String
    var allowsRemoteImages = false
    var appearance: EmailBodyAppearance = .light

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = EmailWebViewIsolation.configuration(allowsJavaScript: false, heightHandler: nil)
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.bounces = true
        webView.scrollView.backgroundColor = .clear
        webView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        webView.setContentHuggingPriority(.defaultLow, for: .vertical)
        webView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        webView.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let key = "\(allowsRemoteImages)|\(appearance)|\(EmailHTMLSanitizer.cacheKey(emailId: nil, html: html))"
        guard context.coordinator.loadedKey != key else { return }
        context.coordinator.loadedKey = key
        let source = html
        let allowsRemoteImages = allowsRemoteImages
        let appearance = appearance
        let coordinator = context.coordinator
        Task { @MainActor [weak webView] in
            let sanitized = await EmailHTMLSanitizer.sanitizeOffMain(source)
            guard let webView, coordinator.loadedKey == key else { return }
            let fullHTML = Self.wrapQuotedHTML(sanitized, allowsRemoteImages: allowsRemoteImages, appearance: appearance)
            webView.loadHTMLString(fullHTML, baseURL: EmailHTMLSanitizer.opaqueOrigin)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var loadedKey: String?

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            EmailWebViewIsolation.decidePolicy(for: navigationAction, decisionHandler: decisionHandler)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            EmailWebViewIsolation.createPopup(for: navigationAction)
        }
    }

    private static func wrapQuotedHTML(
        _ sanitized: String,
        allowsRemoteImages: Bool,
        appearance: EmailBodyAppearance
    ) -> String {
        let contentSecurityPolicy = allowsRemoteImages
            ? EmailHTMLSanitizer.contentSecurityPolicy
            : EmailHTMLSanitizer.remoteImagesBlockedPolicy
        return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <meta http-equiv="Content-Security-Policy" content="\(contentSecurityPolicy)">
        <style>
          :root { color-scheme: \(appearance.cssColorScheme); }
          html, body {
            margin: 0;
            padding: 16px 20px 32px 20px;
            background-color: transparent;
            -webkit-text-size-adjust: 100%;
          }
          body {
            display: flow-root;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: \(Int(AppTheme.FontSize.body))px;
            line-height: 1.5;
            color: \(appearance.text);
            word-wrap: break-word;
            overflow-wrap: anywhere;
          }
          img { max-width: 100%; height: auto; }
          a { color: \(appearance.link); }
          pre, code { white-space: pre-wrap; }
          [style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
            position: relative !important;
          }
          blockquote {
            border-left: 2px solid \(appearance.quoteBorder);
            margin: 10px 0;
            padding-left: 12px;
            color: \(appearance.quoteText);
          }
          p, div, span, td, th, blockquote {
            font-size: \(Int(AppTheme.FontSize.body))px !important;
          }
        </style>
        </head>
        <body>
          \(sanitized)
        </body>
        </html>
        """
    }
}

enum HTMLHardenFixture {
    static let html = """
    <p>Hello from the HTML harden fixture.</p>
    <p>Safe links:
      <a href="https://example.com/ok">https example</a>
      <a href="mailto:jordan@example.com">mailto Jordan</a>
      <a href="https://example.com/blank" target="_blank">target blank</a>
    </p>
    <p>Blocked:
      <a href="javascript:alert(1)">javascript alert</a>
      <a href="https://inboxies.invalid/stay">opaque origin</a>
      <img src="x" onerror="alert(1)">
    </p>
    <p>Remote image (hidden until "Load images"):
      <img src="https://example.com/pixel.gif" width="1" height="1" alt="">
    </p>
    <script>document.title = "xss"</script>
    <blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em;">
    On Tue, Sep 8, 2026, at 4:32 PM, Alex Rivera wrote:<br>
    Previous message with a <a href="https://quoted.example/thread">quoted link</a>
    and <script>document.write("quoted-xss")</script>
    </blockquote>
    """

    static var sanitizerChecks: [(label: String, passed: Bool)] {
        let cleaned = EmailHTMLSanitizer.sanitize(html)
        let split = EmailHTMLSanitizer.prepare(html)
        return [
            ("strips script tags", !cleaned.lowercased().contains("<script")),
            ("strips onerror", !cleaned.lowercased().contains("onerror")),
            ("keeps https links", cleaned.contains("https://example.com/ok")),
            ("strips javascript: href", !cleaned.lowercased().contains("javascript:")),
            ("splits quoted replies", split.quote != nil),
        ]
    }

    static var policyChecks: [(label: String, passed: Bool)] {
        let load = URL(string: "https://inboxies.invalid/")!
        let https = URL(string: "https://example.com/ok")!
        let mailto = URL(string: "mailto:jordan@example.com")!
        let js = URL(string: "javascript:alert(1)")!
        let opaqueClick = URL(string: "https://inboxies.invalid/stay")!
        return [
            ("initial opaque load allowed", EmailLinkPolicy.decide(url: load, navigationType: .other) == .allow),
            ("https tap opens externally", EmailLinkPolicy.decide(url: https, navigationType: .linkActivated) == .openExternally(https)),
            ("mailto tap opens externally", EmailLinkPolicy.decide(url: mailto, navigationType: .linkActivated) == .openExternally(mailto)),
            ("javascript: cancelled", EmailLinkPolicy.decide(url: js, navigationType: .linkActivated) == .cancel),
            ("inboxies.invalid click cancelled", EmailLinkPolicy.decide(url: opaqueClick, navigationType: .linkActivated) == .cancel),
            ("target=_blank uses cancel+external, not a new WebView", EmailLinkPolicy.decide(url: https, navigationType: .linkActivated) == .openExternally(https)),
        ]
    }
}

#if DEBUG
struct HTMLHardenFixtureView: View {
    @State private var quoted: QuotedMailContent?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    EmailBodyView(htmlOrText: HTMLHardenFixture.html)
                    Button("Open quoted sheet") {
                        if let quote = EmailHTMLSanitizer.prepare(HTMLHardenFixture.html).quote {
                            quoted = QuotedMailContent(text: quote, isHTML: true)
                        }
                    }
                    .font(.inter(size: 15, weight: .medium))
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(AppTheme.pillFill)
                    .foregroundStyle(AppTheme.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityIdentifier("html-harden-open-quoted")
                    checks("Sanitizer", HTMLHardenFixture.sanitizerChecks)
                    checks("Link policy", HTMLHardenFixture.policyChecks)
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("HTML harden")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $quoted) { item in
                QuotedRepliesModalView(content: item.text, isHTML: true)
            }
            .task {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                if quoted == nil, let quote = EmailHTMLSanitizer.prepare(HTMLHardenFixture.html).quote {
                    quoted = QuotedMailContent(text: quote, isHTML: true)
                }
            }
        }
    }

    private func checks(_ title: String, _ rows: [(label: String, passed: Bool)]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.inter(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.muted)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: row.passed ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(row.passed ? AppTheme.accent : AppTheme.deepDarkRed)
                    Text(row.label)
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.ink)
                }
                .accessibilityIdentifier("html-harden-\(row.passed ? "pass" : "fail")-\(row.label)")
            }
        }
    }
}
#endif

#Preview("Email Body with Quoted Replies") {
    ScrollView {
        VStack(alignment: .leading, spacing: 24) {
            Text("HTML Reply with Quoted Content")
                .font(.inter(size: 14, weight: .semibold))
                .foregroundStyle(AppTheme.muted)

            EmailBodyView(
                htmlOrText: """
                <p>Hi Alex,</p>
                <p>Sounds great, let's schedule the product design review for Thursday at 2:00 PM.</p>
                <p>Best,<br>Jordan</p>
                <br>
                <blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">
                On Tue, Sep 8, 2026, at 4:32 PM, Alex Rivera wrote:<br><br>
                Hey Jordan, could you confirm your availability for the product design review this week? We'd love to finalize the roadmap.
                </blockquote>
                """
            )

            Divider()

            Text("Plain Text Reply with Quoted Content")
                .font(.inter(size: 14, weight: .semibold))
                .foregroundStyle(AppTheme.muted)

            EmailBodyView(
                htmlOrText: """
                Hi Alex,

                Thursday at 2:00 PM works perfectly for me.

                On Tue, Sep 8, 2026, at 4:32 PM, Alex Rivera wrote:
                > Hey Jordan, could you confirm your availability for the product design review this week?
                > We'd love to finalize the roadmap.
                """
            )
        }
        .padding(16)
    }
}

