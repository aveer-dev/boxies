import MachO
import XCTest

/// With an iOS 17 deployment target, WebKit's Swift-only APIs (`Result`/`async`
/// `evaluateJavaScript(_:in:in:)`, `callAsyncJavaScript`, `createPDF`, `find`, `pdf`, …) link
/// /usr/lib/swift/libswiftWebKit.dylib. The iOS 18.5 runtime has no such file, so dyld aborts
/// before `main`. iOS 26+ simulators symlink it to WebKit, so only this check catches it there.
final class WebKitLinkageTests: XCTestCase {
    func testAppDoesNotStronglyLinkSwiftWebKitOverlay() {
        let overlay = "/usr/lib/swift/libswiftWebKit.dylib"
        var offenders: [String] = []
        for index in 0..<_dyld_image_count() {
            guard let header = _dyld_get_image_header(index),
                  let name = _dyld_get_image_name(index).map({ String(cString: $0) }),
                  name.contains("/Inboxies.app/") else { continue }
            if Self.strongDylibs(of: header).contains(overlay) {
                offenders.append(name)
            }
        }
        XCTAssertEqual(offenders, [], "Use the ObjC WebKit API (e.g. __evaluateJavaScript) instead of the Swift overlay")
    }

    private static func strongDylibs(of header: UnsafePointer<mach_header>) -> [String] {
        var names: [String] = []
        var command = UnsafeRawPointer(header).advanced(by: MemoryLayout<mach_header_64>.size)
        for _ in 0..<header.pointee.ncmds {
            let load = command.loadUnaligned(as: load_command.self)
            if load.cmd == UInt32(LC_LOAD_DYLIB) {
                let dylib = command.loadUnaligned(as: dylib_command.self)
                let path = command.advanced(by: Int(dylib.dylib.name.offset)).assumingMemoryBound(to: CChar.self)
                names.append(String(cString: path))
            }
            command = command.advanced(by: Int(load.cmdsize))
        }
        return names
    }
}
