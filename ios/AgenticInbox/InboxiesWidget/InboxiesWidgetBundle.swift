import SwiftUI
import WidgetKit

@main
struct InboxiesWidgetBundle: WidgetBundle {
    init() {
        // Belt and braces next to UIAppFonts: Inter must be there before the first render.
        AppTheme.registerFontsIfNeeded()
    }

    var body: some Widget {
        TodayInboxWidget()
    }
}
