import SwiftUI
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
    @State private var extractedHTMLQuote: String? = nil
    @State private var activeQuotedContent: QuotedMailContent? = nil

    private var isHTML: Bool {
        htmlOrText.range(of: #"</?[a-zA-Z][^>]*>"#, options: .regularExpression) != nil
    }

    private var bodyHTML: String {
        htmlWithImages ?? htmlOrText
    }

    private var showLoading: Bool {
        isHTML && (isWebLoading || webHeight <= 1)
    }

    private var hasQuotedReplies: Bool {
        if isHTML {
            return extractedHTMLQuote != nil
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
                        isLoading: $isWebLoading,
                        onQuoteExtracted: { quote in
                            extractedHTMLQuote = quote
                        }
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
                    if let quote = (isHTML ? extractedHTMLQuote : plainTextParts.quote) {
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
            extractedHTMLQuote = nil
            activeQuotedContent = nil
            webHeight = 1
            isWebLoading = true
        }
        .onChange(of: emailId) { _, _ in
            extractedHTMLQuote = nil
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
        <style>
          :root { color-scheme: light; }
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

          /* Pre-emptively hide standard quotes so they take 0 layout space */
          .gmail_quote, .yahoo_quoted, .protonmail_quote, #divRplyFwdMsg, blockquote[type="cite"], #appendonsend {
            display: none !important;
          }
        </style>
        </head>
        <body>\(bodyHTML)
        <script>
          function postHeight() {
            const h = Math.ceil(
              Math.max(
                document.body.offsetHeight,
                document.body.getBoundingClientRect().height,
                document.body.scrollHeight
              )
            );
            if (window.webkit && window.webkit.messageHandlers.bodyHeight) {
              window.webkit.messageHandlers.bodyHeight.postMessage(h);
            }
          }

          function extractQuotedReplies() {
            var explicitSelectors = [
              '.gmail_quote',
              '.yahoo_quoted',
              '.protonmail_quote',
              '#divRplyFwdMsg',
              'blockquote[type="cite"]'
            ];

            var targetRoot = null;
            var headerEl = null;

            for (var i = 0; i < explicitSelectors.length; i++) {
              var found = document.querySelector(explicitSelectors[i]);
              if (found) {
                targetRoot = found;
                while (targetRoot.parentElement && targetRoot.parentElement !== document.body) {
                  var pMatches = false;
                  for (var s = 0; s < explicitSelectors.length; s++) {
                    if (targetRoot.parentElement.matches && targetRoot.parentElement.matches(explicitSelectors[s])) {
                      pMatches = true;
                      break;
                    }
                  }
                  if (pMatches) {
                    targetRoot = targetRoot.parentElement;
                  } else {
                    break;
                  }
                }
                break;
              }
            }

            if (!targetRoot) {
              var append = document.getElementById('appendonsend');
              if (append && append.nextElementSibling) {
                targetRoot = append;
              }
            }

            if (!targetRoot) {
              var bqs = document.querySelectorAll('blockquote');
              for (var j = 0; j < bqs.length; j++) {
                var bq = bqs[j];
                if (bq.parentElement && bq.parentElement.closest('blockquote')) continue;

                var text = (bq.textContent || '').trim();
                var style = (bq.getAttribute('style') || '').toLowerCase();
                var hasReplyPattern = /on\\s.+wrote:\\s*/i.test(text) ||
                                      /wrote:\\s*$/im.test(text) ||
                                      /original message/i.test(text) ||
                                      /from:\\s.+\\n?(sent|date):/i.test(text) ||
                                      style.indexOf('border-left') !== -1;

                var hasSubstantialAfter = false;
                var sibling = bq.nextElementSibling;
                while (sibling) {
                  var sibText = (sibling.textContent || '').trim();
                  var isSig = sibling.className && (typeof sibling.className === 'string') &&
                              (sibling.className.indexOf('signature') !== -1 || sibling.className.indexOf('gmail_signature') !== -1);
                  if (sibText.length > 40 && !isSig) {
                    hasSubstantialAfter = true;
                    break;
                  }
                  sibling = sibling.nextElementSibling;
                }

                if (hasReplyPattern || !hasSubstantialAfter) {
                  targetRoot = bq;
                  break;
                }
              }
            }

            if (!targetRoot) {
              postHeight();
              return;
            }

            var prev = targetRoot.previousElementSibling;
            while (prev && (prev.tagName === 'BR' || (prev.textContent || '').trim() === '')) {
              prev = prev.previousElementSibling;
            }
            if (prev) {
              var pText = (prev.textContent || '').trim();
              var isAttr = prev.classList && (prev.classList.contains('gmail_attr') || prev.classList.contains('moz-cite-prefix'));
              if (/^(on\\s.+wrote:|from:\\s.+|---\\s*original message|-----original message)/i.test(pText) || isAttr) {
                headerEl = prev;
              }
            }

            var startEl = headerEl || targetRoot;
            var parent = startEl.parentNode;
            if (!parent) {
              postHeight();
              return;
            }

            var quoteHtmlParts = [];
            var curr = startEl;
            var nodesToRemove = [];
            while (curr) {
              var nextNode = curr.nextSibling;
              if (curr.nodeType === 1) {
                if (curr.tagName !== 'SCRIPT') {
                  curr.style.removeProperty('display');
                  quoteHtmlParts.push(curr.outerHTML);
                  nodesToRemove.push(curr);
                }
              } else if (curr.nodeType === 3) {
                quoteHtmlParts.push(curr.textContent);
                nodesToRemove.push(curr);
              }
              curr = nextNode;
            }

            for (var k = 0; k < nodesToRemove.length; k++) {
              var node = nodesToRemove[k];
              if (node.parentNode) {
                node.parentNode.removeChild(node);
              }
            }

            while (parent.lastChild) {
              var last = parent.lastChild;
              if (last.nodeType === 3 && (last.textContent || '').trim() === '') {
                parent.removeChild(last);
              } else if (last.nodeType === 1) {
                var tag = last.tagName;
                var isBlank = (last.textContent || '').trim() === '' && !last.querySelector('img');
                if (tag === 'BR' || (isBlank && (tag === 'P' || tag === 'DIV'))) {
                  parent.removeChild(last);
                } else {
                  break;
                }
              } else {
                break;
              }
            }

            var fullQuoteHtml = quoteHtmlParts.join('').trim();
            if (fullQuoteHtml && window.webkit && window.webkit.messageHandlers.quotedContent) {
              window.webkit.messageHandlers.quotedContent.postMessage(fullQuoteHtml);
            }

            postHeight();
          }

          extractQuotedReplies();
          window.addEventListener('load', function() {
            extractQuotedReplies();
            postHeight();
          });
          window.addEventListener('resize', postHeight);
          document.querySelectorAll('img').forEach(function (img) {
            img.addEventListener('load', postHeight);
            img.addEventListener('error', postHeight);
          });
          if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(postHeight).observe(document.body);
          }
          postHeight();
        </script>
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

private struct HTMLWebView: UIViewRepresentable {
    let html: String
    @Binding var contentHeight: CGFloat
    @Binding var isLoading: Bool
    var onQuoteExtracted: ((String) -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(height: $contentHeight, isLoading: $isLoading, onQuoteExtracted: onQuoteExtracted)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "bodyHeight")
        config.userContentController.add(context.coordinator, name: "quotedContent")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.height = $contentHeight
        context.coordinator.isLoading = $isLoading
        context.coordinator.onQuoteExtracted = onQuoteExtracted
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        DispatchQueue.main.async {
            self.isLoading = true
        }
        // A real https origin lets remote images load. Do not use the API host —
        // email HTML is unsanitized and must not be same-origin with the backend.
        webView.loadHTMLString(html, baseURL: URL(string: "https://inboxies.invalid/"))
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "bodyHeight")
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "quotedContent")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var height: Binding<CGFloat>
        var isLoading: Binding<Bool>
        var onQuoteExtracted: ((String) -> Void)?
        var loadedHTML: String?

        init(
            height: Binding<CGFloat>,
            isLoading: Binding<Bool>,
            onQuoteExtracted: ((String) -> Void)? = nil
        ) {
            self.height = height
            self.isLoading = isLoading
            self.onQuoteExtracted = onQuoteExtracted
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            if message.name == "bodyHeight" {
                applyHeight(message.body)
            } else if message.name == "quotedContent" {
                if let quote = message.body as? String, !quote.isEmpty {
                    DispatchQueue.main.async { [weak self] in
                        self?.onQuoteExtracted?(quote)
                    }
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript(
                """
                if (typeof extractQuotedReplies === 'function') { extractQuotedReplies(); }
                Math.ceil(Math.max(document.body.offsetHeight, document.body.getBoundingClientRect().height, document.body.scrollHeight))
                """
            ) { [weak self] result, _ in
                self?.applyHeight(result)
                DispatchQueue.main.async {
                    self?.isLoading.wrappedValue = false
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
            } else {
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
        let webView = WKWebView()
        webView.isOpaque = false
        webView.backgroundColor = .clear
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
        webView.loadHTMLString(fullHTML, baseURL: URL(string: "https://inboxies.invalid/"))
    }

    final class Coordinator {
        var loadedHTML: String?
    }

    private func wrapQuotedHTML(_ bodyContent: String) -> String {
        """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <style>
          :root { color-scheme: light; }
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
          blockquote {
            border-left: 2px solid #d0d0d4;
            margin: 10px 0;
            padding-left: 12px;
            color: #5a5a60;
          }
          p, div, span, td, th, blockquote {
            font-size: \(Int(AppTheme.FontSize.body))px !important;
          }
        </style>
        </head>
        <body>
          \(bodyContent)
        </body>
        </html>
        """
    }
}

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

