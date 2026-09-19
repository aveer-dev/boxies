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

    private var isHTML: Bool {
        htmlOrText.range(of: #"</?[a-zA-Z][^>]*>"#, options: .regularExpression) != nil
    }

    private var sanitizedSplit: EmailHTMLSanitizer.SplitBody {
        EmailHTMLSanitizer.prepare(htmlWithImages ?? htmlOrText)
    }

    private var bodyHTML: String {
        sanitizedSplit.main
    }

    private var showLoading: Bool {
        isHTML && (isWebLoading || webHeight <= 1)
    }

    private var hasQuotedReplies: Bool {
        if isHTML {
            return sanitizedSplit.quote != nil
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

                ZStack(alignment: .topLeading) {
                    HTMLWebView(
                        html: wrappedHTML,
                        contentHeight: $webHeight,
                        isLoading: $isWebLoading
                    )
                    .frame(maxWidth: .infinity, alignment: .top)
                    .frame(height: max(webHeight, 1))
                    .opacity(showLoading ? 0 : 1)

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
                    if let quote = (isHTML ? sanitizedSplit.quote : plainTextParts.quote) {
                        activeQuotedContent = QuotedMailContent(text: quote, isHTML: isHTML)
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
        .onChange(of: resolveTaskID) { _, _ in
            activeQuotedContent = nil
            webHeight = 1
            isWebLoading = true
        }
        .onChange(of: emailId) { _, _ in
            activeQuotedContent = nil
            webHeight = 1
            isWebLoading = true
        }
        .sheet(item: $activeQuotedContent) { quoted in
            QuotedRepliesModalView(
                content: quoted.text,
                isHTML: quoted.isHTML,
                attachments: attachments
            )
        }
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
        <meta http-equiv="Content-Security-Policy" content="\(EmailHTMLSanitizer.contentSecurityPolicy)">
        <style>
          :root { color-scheme: light dark; }
          html, body {
            margin: 0;
            padding: 0;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible;
          }
          body {
            display: flow-root;
            padding-bottom: 6px;
            font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: \(Int(AppTheme.FontSize.body))px;
            line-height: 1.45;
            color: #1f1f23;
            word-wrap: break-word;
            overflow-wrap: anywhere;
          }
          img { max-width: 100%; height: auto; }
          a { color: #2659d9; }
          pre, code { white-space: pre-wrap; }
          [style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
            position: relative !important;
          }

          @media (prefers-color-scheme: dark) {
            body {
              color: #f7f7f8;
            }
            a { color: #5888fb; }
          }

          .gmail_quote, .yahoo_quoted, .protonmail_quote, #divRplyFwdMsg, blockquote[type="cite"], #appendonsend {
            display: none !important;
          }
        </style>
        </head>
        <body>\(bodyHTML)
        </body>
        </html>
        """
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

    static let heightScriptSource = """
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
    window.addEventListener('load', postHeight);
    window.addEventListener('resize', postHeight);
    document.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('load', postHeight);
      img.addEventListener('error', postHeight);
    });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(postHeight).observe(document.body);
    }
    postHeight();
    """

    static func configuration(allowsJavaScript: Bool, heightHandler: WKScriptMessageHandler?) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = allowsJavaScript
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.suppressesIncrementalRendering = false
        if let heightHandler, allowsJavaScript {
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
        let config = EmailWebViewIsolation.configuration(allowsJavaScript: true, heightHandler: context.coordinator)
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
            webView.evaluateJavaScript(
                "Math.ceil(Math.max(document.body.offsetHeight, document.body.getBoundingClientRect().height, document.body.scrollHeight))",
                in: nil,
                in: EmailWebViewIsolation.heightWorld
            ) { [weak self] result in
                switch result {
                case .success(let value):
                    self?.applyHeight(value)
                case .failure:
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
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                Text("Previous Replies")
                    .font(.inter(size: 17, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)

                Spacer()

                Button {
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
                    QuotedHTMLFullView(html: content)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        let fullHTML = wrapQuotedHTML(html)
        webView.loadHTMLString(fullHTML, baseURL: EmailHTMLSanitizer.opaqueOrigin)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var loadedHTML: String?

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

    private func wrapQuotedHTML(_ bodyContent: String) -> String {
        let sanitized = EmailHTMLSanitizer.sanitize(bodyContent)
        return """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <meta http-equiv="Content-Security-Policy" content="\(EmailHTMLSanitizer.contentSecurityPolicy)">
        <style>
          :root { color-scheme: light dark; }
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
            color: #1f1f23;
            word-wrap: break-word;
            overflow-wrap: anywhere;
          }
          img { max-width: 100%; height: auto; }
          a { color: #2659d9; }
          pre, code { white-space: pre-wrap; }
          [style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
            position: relative !important;
          }
          blockquote {
            border-left: 2px solid #d0d0d4;
            margin: 10px 0;
            padding-left: 12px;
            color: #5a5a60;
          }
          p, div, span, td, th, blockquote {
            font-size: \(Int(AppTheme.FontSize.body))px !important;
          }

          @media (prefers-color-scheme: dark) {
            body { color: #f7f7f8; }
            a { color: #5888fb; }
            blockquote {
              border-left-color: #3f3f46;
              color: #a1a1aa;
            }
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

