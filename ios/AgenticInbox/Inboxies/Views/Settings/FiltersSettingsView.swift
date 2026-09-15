import SwiftUI

/// Gmail-style inbound filters: from / list / subject → folder, skip auto-draft, forward.
struct FiltersSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var rules: [InboxFilterRule] = []
    @State private var editingId: String?
    @State private var isSaving = false
    @State private var saveMessage: String?

    private var mailboxEmail: String {
        app.selectedMailbox?.email ?? ""
    }

    private var editingBinding: Binding<InboxFilterRule>? {
        guard let editingId,
              let index = rules.firstIndex(where: { $0.id == editingId })
        else { return nil }
        return $rules[index]
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

                if let editingBinding {
                    editor(rule: editingBinding)
                }

                Button {
                    let rule = InboxFilterRule(
                        id: UUID().uuidString,
                        enabled: true,
                        name: "",
                        from: nil,
                        list: nil,
                        subject: nil,
                        folderId: nil,
                        skipAutoDraft: false,
                        forwardTo: nil
                    )
                    rules.append(rule)
                    editingId = rule.id
                } label: {
                    Text("Add filter")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                }
                .padding(.top, 4)
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("Filters")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.inter(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 32, height: 32)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") {
                    Task { await save() }
                }
                .disabled(isSaving || app.selectedMailbox == nil)
                .fontWeight(.semibold)
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
        .onAppear {
            rules = app.selectedMailbox?.settings?.filters ?? []
        }
        .applyThemeController()
    }

    @ViewBuilder
    private func filterRow(rule: Binding<InboxFilterRule>) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Toggle("", isOn: Binding(
                get: { rule.wrappedValue.enabled ?? true },
                set: { rule.wrappedValue.enabled = $0 }
            ))
            .labelsHidden()
            .tint(AppTheme.accent)

            Button {
                editingId = editingId == rule.wrappedValue.id ? nil : rule.wrappedValue.id
            } label: {
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
            .buttonStyle(.plain)

            Button {
                let id = rule.wrappedValue.id
                rules.removeAll { $0.id == id }
                if editingId == id { editingId = nil }
            } label: {
                Image(systemName: "trash")
                    .font(.inter(size: 14))
                    .foregroundStyle(AppTheme.muted)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func editor(rule: Binding<InboxFilterRule>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Edit filter")
                .font(.inter(size: 14, weight: .semibold))
                .foregroundStyle(AppTheme.ink)

            field("Name", text: Binding(
                get: { rule.wrappedValue.name ?? "" },
                set: { rule.wrappedValue.name = $0 }
            ), placeholder: "Newsletters")

            Text("Conditions")
                .font(.inter(size: 12, weight: .semibold))
                .foregroundStyle(AppTheme.muted)

            field("From", text: Binding(
                get: { rule.wrappedValue.from ?? "" },
                set: { rule.wrappedValue.from = $0 }
            ), placeholder: "boss@company.com or @company.com")

            field("List", text: Binding(
                get: { rule.wrappedValue.list ?? "" },
                set: { rule.wrappedValue.list = $0 }
            ), placeholder: "* or list-id fragment")

            field("Subject contains", text: Binding(
                get: { rule.wrappedValue.subject ?? "" },
                set: { rule.wrappedValue.subject = $0 }
            ), placeholder: "invoice")

            Text("Actions")
                .font(.inter(size: 12, weight: .semibold))
                .foregroundStyle(AppTheme.muted)

            VStack(alignment: .leading, spacing: 6) {
                Text("Move to folder")
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                Picker("Folder", selection: Binding(
                    get: { rule.wrappedValue.folderId ?? "" },
                    set: { rule.wrappedValue.folderId = $0.isEmpty ? nil : $0 }
                )) {
                    Text("Keep classified folder").tag("")
                    ForEach(app.folders) { folder in
                        Text(folder.name).tag(folder.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(AppTheme.ink)
            }

            Toggle("Skip auto-draft", isOn: Binding(
                get: { rule.wrappedValue.skipAutoDraft ?? false },
                set: { rule.wrappedValue.skipAutoDraft = $0 }
            ))
            .font(.inter(size: 16))
            .tint(AppTheme.accent)

            field("Forward to", text: Binding(
                get: { rule.wrappedValue.forwardTo ?? "" },
                set: { rule.wrappedValue.forwardTo = $0 }
            ), placeholder: "optional@example.com")
            .keyboardType(.emailAddress)
        }
        .padding(14)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 1)
        )
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.inter(size: 13, weight: .medium))
                .foregroundStyle(AppTheme.ink)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.inter(size: 16))
                .padding(12)
                .background(AppTheme.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(AppTheme.line, lineWidth: 1)
                )
        }
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
