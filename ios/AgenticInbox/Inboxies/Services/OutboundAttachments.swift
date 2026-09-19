import Foundation
import ImageIO
import UniformTypeIdentifiers

enum OutboundLimits {
    static let maxMessageBytes = 5 * 1024 * 1024
    static let sizeError = "Message exceeds the 5 MiB outbound limit"
    static let videoReject = "Videos aren't supported (5 MiB send limit)"
    static let maxImageEdge: CGFloat = 1600
    static let jpegQualities: [CGFloat] = [0.72, 0.55, 0.4]

    static func utf8ByteLength(_ value: String) -> Int {
        value.utf8.count
    }

    static func estimateMessageBytes(html: String, text: String, attachmentBytes: [Int]) -> Int {
        utf8ByteLength(html) + utf8ByteLength(text) + attachmentBytes.reduce(0, +)
    }

    static func remainingBudget(html: String, text: String, attachmentBytes: [Int]) -> Int {
        max(0, maxMessageBytes - estimateMessageBytes(html: html, text: text, attachmentBytes: attachmentBytes))
    }
}

struct ComposePendingAttachment: Identifiable, Equatable {
    let id: UUID
    var filename: String
    var mimeType: String
    var size: Int
    var base64: String

    init(id: UUID = UUID(), filename: String, mimeType: String, size: Int, base64: String) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.size = size
        self.base64 = base64
    }

    var sendPayload: [String: Any] {
        [
            "content": base64,
            "filename": filename,
            "type": mimeType,
            "disposition": "attachment",
        ]
    }
}

enum OutboundAttachmentError: LocalizedError {
    case video
    case tooLarge
    case unreadable

    var errorDescription: String? {
        switch self {
        case .video: return OutboundLimits.videoReject
        case .tooLarge: return OutboundLimits.sizeError
        case .unreadable: return "Couldn't read that file."
        }
    }
}

enum OutboundImageCompressor {
    static func prepare(
        data: Data,
        filename: String,
        mimeType: String,
        budget: Int
    ) throws -> ComposePendingAttachment {
        let mime = mimeType.isEmpty ? Self.mime(for: filename) : mimeType
        if Self.isVideo(mime: mime, filename: filename) {
            throw OutboundAttachmentError.video
        }
        if Self.shouldReencodeAsJpeg(mime: mime, filename: filename, byteLength: data.count, budget: budget) {
            if let jpeg = compressImage(data, filename: filename, budget: budget) {
                return jpeg
            }
            throw OutboundAttachmentError.tooLarge
        }
        guard data.count > 0, data.count <= budget else {
            throw OutboundAttachmentError.tooLarge
        }
        return ComposePendingAttachment(
            filename: filename.isEmpty ? "untitled" : filename,
            mimeType: mime,
            size: data.count,
            base64: data.base64EncodedString()
        )
    }

    private static func compressImage(_ data: Data, filename: String, budget: Int) -> ComposePendingAttachment? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let original = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            guard data.count <= budget else { return nil }
            return ComposePendingAttachment(
                filename: filename,
                mimeType: mime(for: filename),
                size: data.count,
                base64: data.base64EncodedString()
            )
        }

        var edge = min(OutboundLimits.maxImageEdge, CGFloat(max(original.width, original.height)))
        while edge >= 320 {
            let size = scaledSize(width: original.width, height: original.height, maxEdge: edge)
            guard let resized = resize(original, to: size) else { break }
            for quality in OutboundLimits.jpegQualities {
                guard let jpeg = jpegData(resized, quality: quality), jpeg.count <= budget else { continue }
                let name = jpegFilename(filename)
                return ComposePendingAttachment(
                    filename: name,
                    mimeType: "image/jpeg",
                    size: jpeg.count,
                    base64: jpeg.base64EncodedString()
                )
            }
            let next = max(320, floor(edge * 0.75))
            if next >= edge { break }
            edge = next
        }
        return nil
    }

    private static func scaledSize(width: Int, height: Int, maxEdge: CGFloat) -> CGSize {
        let longest = CGFloat(max(width, height))
        if longest <= maxEdge {
            return CGSize(width: width, height: height)
        }
        let scale = maxEdge / longest
        return CGSize(
            width: max(1, round(CGFloat(width) * scale)),
            height: max(1, round(CGFloat(height) * scale))
        )
    }

    private static func resize(_ image: CGImage, to size: CGSize) -> CGImage? {
        let width = Int(size.width)
        let height = Int(size.height)
        guard let ctx = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
        return ctx.makeImage()
    }

    private static func jpegData(_ image: CGImage, quality: CGFloat) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(dest, image, [
            kCGImageDestinationLossyCompressionQuality: quality
        ] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return data as Data
    }

    private static func jpegFilename(_ filename: String) -> String {
        let base = (filename as NSString).deletingPathExtension
        let stem = base.isEmpty ? "image" : base
        return "\(stem).jpg"
    }

    static func shouldReencodeAsJpeg(mime: String, filename: String, byteLength: Int, budget: Int) -> Bool {
        guard isImage(mime: mime, filename: filename) else { return false }
        let type = mime.lowercased()
        let ext = (filename as NSString).pathExtension.lowercased()
        if type == "image/gif" || ext == "gif" { return false }
        if type == "image/svg+xml" || ext == "svg" { return false }
        if (type == "image/png" || ext == "png") && byteLength <= budget && byteLength <= 256 * 1024 {
            return false
        }
        return true
    }

    static func isImage(mime: String, filename: String) -> Bool {
        if mime.lowercased().hasPrefix("image/") { return true }
        let ext = (filename as NSString).pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif"].contains(ext)
    }

    static func isVideo(mime: String, filename: String) -> Bool {
        if mime.lowercased().hasPrefix("video/") { return true }
        let ext = (filename as NSString).pathExtension.lowercased()
        return ["mp4", "mov", "m4v", "avi", "mkv", "webm", "mpeg", "mpg"].contains(ext)
    }

    static func mime(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        if let type = UTType(filenameExtension: ext), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }
}
