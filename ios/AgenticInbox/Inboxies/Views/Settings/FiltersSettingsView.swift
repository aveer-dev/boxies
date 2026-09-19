import SwiftUI

/// Gmail-style inbound filters: from / list / subject → folder, skip auto-draft, forward.
struct FiltersSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var rules: [InboxFilterRule] = []
    @State private var editorDraft: FilterEditorDraft?
    @State private var actionRuleId: String?
    @State private var isSelectMode = false
    @State private var selectedIds: Set<String> = []
    @State private var isSaving = false
    @State private var saveMessage: String?

    private var mailboxEmail: String {
        app.selectedMailbox?.email ?? ""
    }

    private var actionRule: InboxFilterRule? {
        guard let actionRuleId else { return nil }
        return rules.first(where: { $0.id == actionRuleId })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("If a message matches, file it, skip auto-draft, or forward. First matching rule wins.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)

                Text("Conditions use AND. For sender, use an address, @domain.com, or a substring. For lists, use List-Id text or * for any mailing list.")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)

                if rules.isEmpty {
                    Text("No filters yet.")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.vertical, 8)
                }

                ForEach($rules) { $rule in
                    filterRow(rule: $rule)
                }

                if !isSelectMode {
                    Button {
                        editorDraft = FilterEditorDraft.new()
                    } label: {
                        Text("Add filter")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    }
                    .padding(.top, 4)
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle(isSelectMode
            ? (selectedIds.isEmpty ? "Select filters" : "\(selectedIds.count) selected")
            : "Filters")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if isSelectMode {
                    Button("Cancel") {
                        exitSelectMode()
                    }
                    .fontWeight(.medium)
                } else {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.inter(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if isSelectMode {
                    Button("Delete", role: .destructive) {
                        deleteSelected()
                    }
                    .disabled(selectedIds.isEmpty)
                    .fontWeight(.semibold)
                } else {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(isSaving || app.selectedMailbox == nil)
                    .fontWeight(.semibold)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let saveMessage {
                Text(saveMessage)
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppTheme.pillFill, in: Capsule())
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .sheet(item: $editorDraft) { draft in
            FilterEditorSheet(
                draft: draft,
                folders: app.folders,
                mailboxEmail: mailboxEmail,
                onCancel: { editorDraft = nil },
                onSave: { rule in
                    if rules.contains(where: { $0.id == rule.id }) {
                        if let index = rules.firstIndex(where: { $0.id == rule.id }) {
                            rules[index] = rule
                        }
                    } else {
                        rules.append(rule)
                    }
                    editorDraft = nil
                }
            )
            .presentationDetents([.large])
            .applyThemeController()
        }
        .confirmationDialog(
            actionRuleTitle,
            isPresented: Binding(
                get: { actionRuleId != nil },
                set: { if !$0 { actionRuleId = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let id = actionRuleId {
                    rules.removeAll { $0.id == id }
                }
                actionRuleId = nil
            }
            Button("Cancel", role: .cancel) {
                actionRuleId = nil
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.82), value: isSelectMode)
        .sensoryFeedback(.selection, trigger: isSelectMode)
        .onAppear {
            rules = app.selectedMailbox?.settings?.filters ?? []
        }
        .applyThemeController()
    }

    private var actionRuleTitle: String {
        guard let rule = actionRule else { return "Filter" }
        return rule.name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            ?? "Untitled filter"
    }

    @ViewBuilder
    private func filterRow(rule: Binding<InboxFilterRule>) -> some View {
        let id = rule.wrappedValue.id
        let isSelected = selectedIds.contains(id)

        HStack(alignment: .center, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                if isSelectMode {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 22))
                        .foregroundStyle(isSelected ? AppTheme.ink : AppTheme.muted.opacity(0.6))
                        .transition(.scale.combined(with: .opacity))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(rule.wrappedValue.name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                        ?? "Untitled filter")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                    Text(summary(for: rule.wrappedValue))
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture {
                if isSelectMode {
                    toggleSelection(id)
                } else {
                    actionRuleId = id
                }
            }
            .onLongPressGesture(minimumDuration: 0.35) {
                guard !isSelectMode else { return }
                withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                    isSelectMode = true
                    selectedIds = [id]
                }
            }

            Toggle("", isOn: Binding(
                get: { rule.wrappedValue.enabled ?? true },
                set: { rule.wrappedValue.enabled = $0 }
            ))
            .labelsHidden()
            .tint(AppTheme.accent)
        }
        .padding(12)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 1)
        )
    }

    private func toggleSelection(_ id: String) {
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    private func exitSelectMode() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
            isSelectMode = false
            selectedIds = []
        }
    }

    private func deleteSelected() {
        rules.removeAll { selectedIds.contains($0.id) }
        exitSelectMode()
    }

    private func summary(for rule: InboxFilterRule) -> String {
        var conditions: [String] = []
        if let from = rule.from?.trimmingCharacters(in: .whitespacesAndNewlines), !from.isEmpty {
            conditions.append("from \(from)")
        }
        if let list = rule.list?.trimmingCharacters(in: .whitespacesAndNewlines), !list.isEmpty {
            conditions.append(list == "*" ? "any list" : "list \(list)")
        }
        if let subject = rule.subject?.trimmingCharacters(in: .whitespacesAndNewlines), !subject.isEmpty {
            conditions.append("subject \"\(subject)\"")
        }

        var actions: [String] = []
        if let folderId = rule.folderId, !folderId.isEmpty {
            let name = app.folders.first(where: { $0.id == folderId })?.name ?? folderId
            actions.append(name)
        }
        if rule.skipAutoDraft == true {
            actions.append("skip auto-draft")
        }
        if let forwardTo = rule.forwardTo?.trimmingCharacters(in: .whitespacesAndNewlines), !forwardTo.isEmpty {
            actions.append("forward to \(forwardTo)")
        }

        let left = conditions.isEmpty ? "no conditions" : conditions.joined(separator: ", ")
        let right = actions.isEmpty ? "no actions" : actions.joined(separator: ", ")
        return "\(left) → \(right)"
    }

    private func save() async {
        let cleaned = rules.map { rule -> InboxFilterRule in
            InboxFilterRule(
                id: rule.id,
                enabled: rule.enabled ?? true,
                name: rule.name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                from: rule.from?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                list: rule.list?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                subject: rule.subject?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                folderId: rule.folderId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                skipAutoDraft: (rule.skipAutoDraft == true) ? true : nil,
                forwardTo: rule.forwardTo?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            )
        }

        for rule in cleaned {
            let hasCondition = rule.from != nil || rule.list != nil || rule.subject != nil
            let hasAction = rule.folderId != nil || rule.skipAutoDraft == true || rule.forwardTo != nil
            if !hasCondition {
                await flash("Each filter needs a from, list, or subject condition")
                return
            }
            if !hasAction {
                await flash("Each filter needs a folder, skip auto-draft, or forward action")
                return
            }
            if let forwardTo = rule.forwardTo {
                if !forwardTo.contains("@") {
                    await flash("Enter a valid filter forward address")
                    return
                }
                if forwardTo.lowercased() == mailboxEmail.lowercased() {
                    await flash("Filter forward address cannot be this mailbox")
                    return
                }
            }
        }

        if cleaned.count > 50 {
            await flash("At most 50 filters allowed")
            return
        }

        isSaving = true
        defer { isSaving = false }

        let success = await app.updateMailboxSettings { settings in
            settings.filters = cleaned
        }

        await flash(success ? "Filters saved" : "Failed to save", success: success)
    }

    private func flash(_ message: String, success: Bool = false) async {
        withAnimation { saveMessage = message }
        try? await Task.sleep(nanoseconds: success ? 1_200_000_000 : 2_000_000_000)
        withAnimation { saveMessage = nil }
    }
}

// MARK: - Editor modal

private struct FilterEditorDraft: Identifiable {
    let id: String
    var rule: InboxFilterRule
    var isNew: Bool

    static func new() -> FilterEditorDraft {
        let id = UUID().uuidString
        return FilterEditorDraft(
            id: id,
            rule: InboxFilterRule(
                id: id,
                enabled: true,
                name: "",
                from: nil,
                list: nil,
                subject: nil,
                folderId: nil,
                skipAutoDraft: false,
                forwardTo: nil
            ),
            isNew: true
        )
    }
}

private struct FilterEditorSheet: View {
    @State private var rule: InboxFilterRule
    @State private var errorMessage: String?

    let isNew: Bool
    let folders: [Folder]
    let mailboxEmail: String
    var onCancel: () -> Void
    var onSave: (InboxFilterRule) -> Void

    init(
        draft: FilterEditorDraft,
        folders: [Folder],
        mailboxEmail: String,
        onCancel: @escaping () -> Void,
        onSave: @escaping (InboxFilterRule) -> Void
    ) {
        _rule = State(initialValue: draft.rule)
        self.isNew = draft.isNew
        self.folders = folders
        self.mailboxEmail = mailboxEmail
        self.onCancel = onCancel
        self.onSave = onSave
    }

    private var folderSelection: Binding<String> {
        Binding(
            get: { rule.folderId ?? "" },
            set: { rule.folderId = $0.isEmpty ? nil : $0 }
        )
    }

    private var skipAutoDraft: Binding<Bool> {
        Binding(
            get: { rule.skipAutoDraft ?? false },
            set: { rule.skipAutoDraft = $0 }
        )
    }

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Section {
                        SettingsFormErrorBanner(message: errorMessage)
                    }
                }

                Section {
                    SettingsPlainTextFieldRow(
                        text: Binding(
                            get: { rule.name ?? "" },
                            set: { rule.name = $0 }
                        ),
                        placeholder: "Newsletters"
                    )
                } header: {
                    Text("Name")
                } footer: {
                    SettingsFormFooter(text: "Optional label so you can recognize this filter in the list.")
                }

                Section {
                    SettingsTextFieldRow(
                        title: "From",
                        text: Binding(
                            get: { rule.from ?? "" },
                            set: { rule.from = $0 }
                        ),
                        placeholder: "name@ or @domain.com",
                        keyboardType: .emailAddress,
                        textContentType: .emailAddress
                    )
                    SettingsTextFieldRow(
                        title: "List",
                        text: Binding(
                            get: { rule.list ?? "" },
                            set: { rule.list = $0 }
                        ),
                        placeholder: "* or list-id"
                    )
                    SettingsTextFieldRow(
                        title: "Subject",
                        text: Binding(
                            get: { rule.subject ?? "" },
                            set: { rule.subject = $0 }
                        ),
                        placeholder: "Contains…"
                    )
                } header: {
                    Text("Conditions")
                } footer: {
                    SettingsFormFooter(
                        text: "Match sender, mailing list, or subject text. At least one condition is required. Multiple conditions use AND."
                    )
                }

                Section {
                    SettingsMenuPickerRow(title: "Move to Folder", selection: folderSelection) {
                        Text("Keep classified").tag("")
                        ForEach(folders) { folder in
                            Text(folder.name).tag(folder.id)
                        }
                    }

                    SettingsToggleRow(title: "Skip Auto-Draft", isOn: skipAutoDraft)

                    SettingsTextFieldRow(
                        title: "Forward To",
                        text: Binding(
                            get: { rule.forwardTo ?? "" },
                            set: { rule.forwardTo = $0 }
                        ),
                        placeholder: "optional@example.com",
                        keyboardType: .emailAddress,
                        textContentType: .emailAddress
                    )
                } header: {
                    Text("Actions")
                } footer: {
                    SettingsFormFooter(
                        text: "Choose what happens when mail matches. At least one action is required."
                    )
                }
            }
            .settingsFormListStyle()
            .navigationTitle(isNew ? "New Filter" : "Edit Filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(isNew ? "Add" : "Done") {
                        commit()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    private func commit() {
        let cleaned = InboxFilterRule(
            id: rule.id,
            enabled: rule.enabled ?? true,
            name: rule.name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            from: rule.from?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            list: rule.list?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            subject: rule.subject?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            folderId: rule.folderId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            skipAutoDraft: (rule.skipAutoDraft == true) ? true : nil,
            forwardTo: rule.forwardTo?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        )

        let hasCondition = cleaned.from != nil || cleaned.list != nil || cleaned.subject != nil
        let hasAction = cleaned.folderId != nil || cleaned.skipAutoDraft == true || cleaned.forwardTo != nil
        if !hasCondition {
            errorMessage = "Add a from, list, or subject condition"
            return
        }
        if !hasAction {
            errorMessage = "Add a folder, skip auto-draft, or forward action"
            return
        }
        if let forwardTo = cleaned.forwardTo {
            if !forwardTo.contains("@") {
                errorMessage = "Enter a valid forward address"
                return
            }
            if forwardTo.lowercased() == mailboxEmail.lowercased() {
                errorMessage = "Forward address cannot be this mailbox"
                return
            }
        }

        onSave(cleaned)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

#Preview("Filters") {
    PreviewHost {
        NavigationStack {
            FiltersSettingsView()
        }
    }
}
