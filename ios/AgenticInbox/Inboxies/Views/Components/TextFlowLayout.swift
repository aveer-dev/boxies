import SwiftUI

/// A Layout that arranges inline subviews (such as words and pills) horizontally,
/// wrapping rows onto subsequent lines and vertically centering each item within the row.
struct TextFlowLayout: Layout {
    var horizontalSpacing: CGFloat = 4
    var verticalSpacing: CGFloat = 4

    struct Row {
        var range: Range<Int>
        var size: CGSize
        var items: [CGSize]
    }

    private func computeRows(proposal: ProposedViewSize, subviews: Subviews) -> [Row] {
        let maxWidth = proposal.width ?? .infinity
        var rows: [Row] = []
        var currentRowIndices: [Int] = []
        var currentRowItems: [CGSize] = []
        var currentX: CGFloat = 0
        var currentRowHeight: CGFloat = 0

        for (index, subview) in subviews.enumerated() {
            let itemSize = subview.sizeThatFits(.unspecified)
            if currentX + itemSize.width > maxWidth && !currentRowIndices.isEmpty {
                let rowWidth = max(0, currentX - horizontalSpacing)
                rows.append(Row(
                    range: currentRowIndices.first!..<(currentRowIndices.last! + 1),
                    size: CGSize(width: rowWidth, height: currentRowHeight),
                    items: currentRowItems
                ))
                currentRowIndices = []
                currentRowItems = []
                currentX = 0
                currentRowHeight = 0
            }

            currentRowIndices.append(index)
            currentRowItems.append(itemSize)
            currentX += itemSize.width + horizontalSpacing
            currentRowHeight = max(currentRowHeight, itemSize.height)
        }

        if !currentRowIndices.isEmpty {
            let rowWidth = max(0, currentX - horizontalSpacing)
            rows.append(Row(
                range: currentRowIndices.first!..<(currentRowIndices.last! + 1),
                size: CGSize(width: rowWidth, height: currentRowHeight),
                items: currentRowItems
            ))
        }

        return rows
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        if rows.isEmpty { return .zero }

        var totalWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        for (i, row) in rows.enumerated() {
            totalWidth = max(totalWidth, row.size.width)
            totalHeight += row.size.height + (i > 0 ? verticalSpacing : 0)
        }
        return CGSize(width: totalWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        var currentY = bounds.minY

        for (rowIndex, row) in rows.enumerated() {
            if rowIndex > 0 {
                currentY += verticalSpacing
            }
            var currentX = bounds.minX

            for (itemIndexInRow, subviewIndex) in row.range.enumerated() {
                let subview = subviews[subviewIndex]
                let itemSize = row.items[itemIndexInRow]
                let yOffset = currentY + (row.size.height - itemSize.height) / 2.0
                subview.place(
                    at: CGPoint(x: currentX, y: yOffset),
                    proposal: ProposedViewSize(itemSize)
                )
                currentX += itemSize.width + horizontalSpacing
            }
            currentY += row.size.height
        }
    }
}
