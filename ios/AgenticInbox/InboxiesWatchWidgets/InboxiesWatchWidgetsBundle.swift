import SwiftUI
import WidgetKit

/// Watch complications and the Smart Stack widget (AVE-146, docs/watch-companion-plan.md
/// phase 3). Embedded in the `InboxiesWatch` app.
@main
struct InboxiesWatchWidgetsBundle: WidgetBundle {
    var body: some Widget {
        InboxGlanceWidget()
    }
}
