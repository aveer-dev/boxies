// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import SwiftUI
import UIKit

/// Complete DNS Configuration Suite for Cloudflare Zones & Email Health.
struct DomainAdminDNSView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var initialDomain: String? = nil
    var justPurchased: Bool = false

    @State private var domains: [AdminDomainInfo] = []
    @State private var selectedDomain: String = ""
    @State private var healthResponse: DomainHealthResponse?
    @State private var dnsRecords: [CloudflareDnsRecord] = []
    @State private var isLoading = true
    @State private var isFixing = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var showAddRecord = false
    @State private var showAddDomain = false
    @State private var showExportSheet = false
    @State private var showOffboardSheet = false

    var body: some View {
        List {
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.deepDarkRed)
                }
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.accent)
                }
            }

            if justPurchased {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(Color.green)
                            Text("Domain Active & Provisioned")
                                .font(.inter(size: 15, weight: .bold))
                                .foregroundStyle(AppTheme.ink)
                        }
                        Text("Registered via Cloudflare Registrar. Anycast DNS, SSL, and Email Routing are configured.")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.vertical, 4)
                }
            }

            // Domain Selector
            if domains.count > 1 {
                Section("Domain") {
                    Picker("Domain", selection: $selectedDomain) {
                        ForEach(domains) { d in
                            Text(d.domain).tag(d.domain)
                        }
                    }
                    .pickerStyle(.menu)
                    .onChange(of: selectedDomain) { _, newDomain in
                        Task { await loadDomainData(domain: newDomain) }
                    }
                }
            }

            // Cloudflare Edge Services Showcase
            Section("Cloudflare Edge Services") {
                VStack(alignment: .leading, spacing: 10) {
                    edgeServiceRow(
                        title: "Anycast DNS",
                        desc: "Sub-millisecond resolution across 300+ global Cloudflare cities",
                        systemImage: "network"
                    )
                    Divider()
                    edgeServiceRow(
                        title: "Universal SSL / TLS",
                        desc: "Automated Edge certificates with modern TLS 1.3 encryption",
                        systemImage: "lock.shield"
                    )
                    Divider()
                    edgeServiceRow(
                        title: "Email Routing & DMARC",
                        desc: "High-deliverability SPF, DKIM, and anti-spoofing policies",
                        systemImage: "envelope.badge.shield.half.filled"
                    )
                    Divider()
                    edgeServiceRow(
                        title: "DDoS & WAF Protection",
                        desc: "Enterprise-grade perimeter protection against malicious traffic",
                        systemImage: "shield.checkered"
                    )
                }
                .padding(.vertical, 4)
            }

            // Domain Operations (Export & Offboard)
            Section("Domain Operations") {
                Button {
                    showAddDomain = true
                } label: {
                    Label("Add / Register Custom Domain", systemImage: "plus.circle")
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                }

                Button {
                    showExportSheet = true
                } label: {
                    Label("Export Domain Emails (.mbox)", systemImage: "arrow.down.doc")
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                }

                Button {
                    showOffboardSheet = true
                } label: {
                    Label("Move DNS / Offboard Domain", systemImage: "arrow.triangle.swap")
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.deepDarkRed)
                }
            }

            // Cloudflare Zone & Nameservers
            Section("Cloudflare Zone & Nameservers") {
                HStack {
                    Text("Domain")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                    Spacer()
                    Text(selectedDomain)
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                }

                HStack {
                    Text("Zone Status")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                    Spacer()
                    let isActive = healthResponse?.zoneStatus == "active"
                    Text(isActive ? "Active on Cloudflare" : "Pending Nameservers")
                        .font(.inter(size: 12, weight: .medium))
                        .foregroundStyle(isActive ? Color.green : Color.orange)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            (isActive ? Color.green : Color.orange)
                                .opacity(0.12)
                        )
                        .clipShape(Capsule())
                }

                if let nsList = healthResponse?.nameservers, !nsList.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Assigned Nameservers")
                            .font(.inter(size: 12, weight: .medium))
                            .foregroundStyle(AppTheme.muted)

                        ForEach(nsList, id: \.self) { ns in
                            HStack {
                                Text(ns)
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(AppTheme.ink)
                                Spacer()
                                Button {
                                    UIPasteboard.general.string = ns
                                    statusMessage = "Copied \(ns)"
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                        .font(.system(size: 12))
                                        .foregroundStyle(AppTheme.accent)
                                }
                                .buttonStyle(.borderless)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            // Email Health Verification
            Section {
                if let audit = healthResponse?.audit {
                    ForEach(audit.items) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(item.type)
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(AppTheme.pillFill)
                                    .clipShape(RoundedRectangle(cornerRadius: 4))

                                Text(item.name)
                                    .font(.inter(size: 14, weight: .medium))
                                    .foregroundStyle(AppTheme.ink)

                                Spacer()

                                healthPill(status: item.status)
                            }

                            if let current = item.currentValue {
                                Text("Current: \(current)")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(AppTheme.muted)
                            } else {
                                Text("Expected: \(item.expectedValue)")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(AppTheme.muted)
                            }

                            Text(item.message)
                                .font(.inter(size: 12))
                                .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Button {
                    Task { await fixEmailDns() }
                } label: {
                    HStack {
                        Spacer()
                        if isFixing {
                            ProgressView()
                        } else {
                            Label("Fix & Auto-configure Email DNS", systemImage: "wrench.and.screwdriver")
                                .font(.inter(size: 14, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                        }
                        Spacer()
                    }
                }
                .disabled(isFixing)
            } header: {
                HStack {
                    Text("Email Health Audit")
                    Spacer()
                    Button {
                        Task { await loadDomainData(domain: selectedDomain) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 12))
                    }
                }
            }

            // DNS Records List
            Section {
                Button {
                    showAddRecord = true
                } label: {
                    Label("Add DNS Record", systemImage: "plus")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                }

                if dnsRecords.isEmpty {
                    Text("No DNS records found.")
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.muted)
                } else {
                    ForEach(dnsRecords) { rec in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(rec.type)
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(AppTheme.pillFill)
                                    .clipShape(RoundedRectangle(cornerRadius: 4))

                                Text(rec.name)
                                    .font(.inter(size: 14, weight: .medium))
                                    .foregroundStyle(AppTheme.ink)

                                Spacer()

                                if rec.proxied {
                                    Text("Proxied")
                                        .font(.inter(size: 10, weight: .medium))
                                        .foregroundStyle(Color.orange)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 2)
                                        .background(Color.orange.opacity(0.12))
                                        .clipShape(RoundedRectangle(cornerRadius: 4))
                                } else {
                                    Text("DNS Only")
                                        .font(.inter(size: 10))
                                        .foregroundStyle(AppTheme.muted)
                                }
                            }

                            Text(rec.content + (rec.priority != nil ? " (Priority: \(rec.priority!))" : ""))
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(AppTheme.muted)
                                .lineLimit(2)
                        }
                        .padding(.vertical, 4)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task { await deleteRecord(rec.id) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            } header: {
                Text("DNS Records (\(dnsRecords.count))")
            }
        }
        .navigationTitle("DNS Configuration")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showAddRecord) {
            AddDnsRecordSheet(domain: selectedDomain) {
                Task { await loadDomainData(domain: selectedDomain) }
            }
        }
        .sheet(isPresented: $showExportSheet) {
            DomainExportSheet(domain: selectedDomain)
        }
        .sheet(isPresented: $showOffboardSheet) {
            DomainOffboardSheet(domain: selectedDomain) {
                Task { await bootstrap() }
            }
        }
        .sheet(isPresented: $showAddDomain) {
            AddDomainSheet { newDomain in
                Task {
                    await bootstrap()
                    if !newDomain.isEmpty {
                        selectedDomain = newDomain
                        await loadDomainData(domain: newDomain)
                    }
                }
            }
        }
        .task {
            await bootstrap()
        }
    }

    @ViewBuilder
    private func edgeServiceRow(title: String, desc: String, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 15))
                .foregroundStyle(AppTheme.accent)
                .frame(width: 24, height: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                Text(desc)
                    .font(.inter(size: 11))
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer()
        }
    }

    @ViewBuilder
    private func healthPill(status: String) -> some View {
        switch status {
        case "connected":
            Label("Connected", systemImage: "checkmark.circle.fill")
                .font(.inter(size: 11, weight: .medium))
                .foregroundStyle(Color.green)
        case "conflict":
            Label("Conflict", systemImage: "exclamationmark.triangle.fill")
                .font(.inter(size: 11, weight: .medium))
                .foregroundStyle(Color.red)
        case "missing":
            Label("Missing", systemImage: "exclamationmark.circle.fill")
                .font(.inter(size: 11, weight: .medium))
                .foregroundStyle(Color.orange)
        default:
            Label("Pending", systemImage: "arrow.clockwise")
                .font(.inter(size: 11, weight: .medium))
                .foregroundStyle(AppTheme.accent)
        }
    }

    private func bootstrap() async {
        isLoading = true
        defer { isLoading = false }
        do {
            domains = try await APIClient.shared.listAdminDomains()
            if let initialDomain, !initialDomain.isEmpty {
                selectedDomain = initialDomain
            } else if let first = domains.first {
                selectedDomain = first.domain
            } else if !app.mailDomain.isEmpty {
                selectedDomain = app.mailDomain
            }
            if !selectedDomain.isEmpty {
                await loadDomainData(domain: selectedDomain)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadDomainData(domain: String) async {
        errorMessage = nil
        do {
            async let healthReq = APIClient.shared.getDomainDnsHealth(domain: domain)
            async let recordsReq = APIClient.shared.listDomainDnsRecords(domain: domain)
            let (health, records) = try await (healthReq, recordsReq)
            healthResponse = health
            dnsRecords = records
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func fixEmailDns() async {
        isFixing = true
        errorMessage = nil
        defer { isFixing = false }
        do {
            let res = try await APIClient.shared.fixDomainEmailDns(domain: selectedDomain)
            if let audit = res.audit {
                healthResponse?.audit = audit
            }
            statusMessage = "Email DNS records repaired & updated"
            dnsRecords = try await APIClient.shared.listDomainDnsRecords(domain: selectedDomain)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteRecord(_ recordId: String) async {
        do {
            try await APIClient.shared.deleteDomainDnsRecord(domain: selectedDomain, recordId: recordId)
            dnsRecords.removeAll { $0.id == recordId }
            statusMessage = "Record deleted"
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Sheet for adding a new DNS Record in Cloudflare.
struct AddDnsRecordSheet: View {
    let domain: String
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var type = "A"
    @State private var name = "@"
    @State private var content = ""
    @State private var ttl = 1
    @State private var proxied = false
    @State private var priority = 10
    @State private var isSaving = false
    @State private var errorMessage: String?

    let types = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"]

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    }
                }

                Section("Record Details") {
                    Picker("Type", selection: $type) {
                        ForEach(types, id: \.self) { t in
                            Text(t).tag(t)
                        }
                    }

                    TextField("Name (@ for root or subdomain)", text: $name)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()

                    TextField("Content / Target", text: $content)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()

                    if type == "MX" {
                        Stepper("Priority: \(priority)", value: $priority, in: 0...65535)
                    }

                    if ["A", "AAAA", "CNAME"].contains(type) {
                        Toggle("Proxy through Cloudflare", isOn: $proxied)
                    }
                }

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Spacer()
                            if isSaving {
                                ProgressView()
                            } else {
                                Text("Create Record")
                                    .font(.inter(size: 16, weight: .medium))
                            }
                            Spacer()
                        }
                    }
                    .disabled(isSaving || content.isEmpty || name.isEmpty)
                }
            }
            .navigationTitle("Add DNS Record")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            _ = try await APIClient.shared.createDomainDnsRecord(
                domain: domain,
                type: type,
                name: name,
                content: content,
                ttl: ttl,
                proxied: proxied,
                priority: type == "MX" ? priority : nil
            )
            onSaved()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Sheet for adding or purchasing a custom domain in Domain Admin.
struct AddDomainSheet: View {
    @Environment(\.dismiss) private var dismiss
    var onAdded: (String) -> Void

    @State private var domain = ""
    @State private var availability: DomainAvailabilityResponse?
    @State private var isChecking = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var checkTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    }
                }

                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Add Custom Domain")
                            .font(.inter(size: 18, weight: .bold))
                            .foregroundStyle(AppTheme.ink)
                        Text("Connect your domain with Cloudflare Anycast DNS and Email Routing, or register an available domain wholesale.")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

                Section {
                    HStack {
                        TextField("e.g. acmemail.org", text: $domain)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .onChange(of: domain) { _, newDomain in
                                handleDomainChange(newDomain)
                            }
                        if isChecking {
                            ProgressView()
                        }
                    }
                } header: {
                    Text("Domain Name")
                }

                if let availability {
                    if availability.available {
                        Section {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 6) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.green)
                                    Text("Available for Registration")
                                        .font(.inter(size: 14, weight: .semibold))
                                        .foregroundStyle(AppTheme.ink)
                                }
                                Text("Wholesale price: $\(String(format: "%.2f", availability.retailPriceUsd)) / year via Cloudflare Registrar")
                                    .font(.inter(size: 12))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            .padding(.vertical, 4)

                            Button {
                                Task { await purchaseDomain() }
                            } label: {
                                HStack {
                                    Spacer()
                                    if isSubmitting {
                                        ProgressView()
                                    } else {
                                        Text("Register for $\(String(format: "%.2f", availability.retailPriceUsd))/yr")
                                            .font(.inter(size: 15, weight: .medium))
                                    }
                                    Spacer()
                                }
                            }
                            .disabled(isSubmitting)

                            Button {
                                Task { await connectDomain() }
                            } label: {
                                HStack {
                                    Spacer()
                                    Text("Connect DNS Only (No Purchase)")
                                        .font(.inter(size: 14))
                                        .foregroundStyle(AppTheme.muted)
                                    Spacer()
                                }
                            }
                            .disabled(isSubmitting)
                        } header: {
                            Text("Registration Option")
                        }
                    } else {
                        Section {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 6) {
                                    Image(systemName: "globe")
                                        .foregroundStyle(AppTheme.accent)
                                    Text("Registered Elsewhere")
                                        .font(.inter(size: 14, weight: .semibold))
                                        .foregroundStyle(AppTheme.ink)
                                }
                                Text("Automates Cloudflare Zone creation and Email Routing configuration.")
                                    .font(.inter(size: 12))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            .padding(.vertical, 4)

                            Button {
                                Task { await connectDomain() }
                            } label: {
                                HStack {
                                    Spacer()
                                    if isSubmitting {
                                        ProgressView()
                                    } else {
                                        Text("Connect Domain to Cloudflare")
                                            .font(.inter(size: 15, weight: .medium))
                                    }
                                    Spacer()
                                }
                            }
                            .disabled(isSubmitting)
                        } header: {
                            Text("Connection")
                        }
                    }
                }
            }
            .navigationTitle("Add Domain")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
    }

    private func handleDomainChange(_ newDomain: String) {
        checkTask?.cancel()
        let trimmed = newDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmed.contains("."), !trimmed.hasPrefix("."), !trimmed.hasSuffix(".") else {
            availability = nil
            isChecking = false
            return
        }

        isChecking = true
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            do {
                let res = try await APIClient.shared.checkDomainAvailability(domain: trimmed)
                guard !Task.isCancelled else { return }
                availability = res
            } catch {
                guard !Task.isCancelled else { return }
                availability = nil
            }
            isChecking = false
        }
    }

    private func connectDomain() async {
        let trimmed = domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let res = try await APIClient.shared.connectAdminDomain(domain: trimmed)
            onAdded(res.domain.domain)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func purchaseDomain() async {
        let trimmed = domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let returnUrl = "inboxies://onboarding/domain-ready?domain=\(trimmed)"
            let res = try await APIClient.shared.createDomainCheckout(domain: trimmed, returnUrl: returnUrl)
            if let url = URL(string: res.checkoutUrl) {
                await MainActor.run {
                    UIApplication.shared.open(url)
                    dismiss()
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Sheet for exporting all emails on a domain into RFC 4155 .mbox format.
struct DomainExportSheet: View {
    let domain: String
    @Environment(\.dismiss) private var dismiss

    @State private var currentJob: ExportJob?
    @State private var isStarting = false
    @State private var errorMessage: String?
    @State private var pollingTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    }
                }

                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("RFC 4155 .mbox Export", systemImage: "archivebox")
                            .font(.inter(size: 16, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                        Text("Export all emails across every mailbox on \(domain) into an industry-standard .mbox archive. Compatible with Apple Mail, Mozilla Thunderbird, and Google Takeout.")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.vertical, 4)
                }

                if let job = currentJob {
                    Section("Export Status") {
                        HStack {
                            Text("Status")
                                .font(.inter(size: 14))
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            statusBadge(for: job.status)
                        }

                        if job.status == "processing", let progress = job.progress {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text("Progress")
                                        .font(.inter(size: 13))
                                        .foregroundStyle(AppTheme.muted)
                                    Spacer()
                                    Text("\(progress.percent)%")
                                        .font(.inter(size: 13, weight: .semibold))
                                        .foregroundStyle(AppTheme.ink)
                                }
                                ProgressView(value: Double(progress.percent), total: 100)
                                    .tint(AppTheme.accent)
                                Text("\(progress.processedCount) of \(progress.totalCount) emails processed")
                                    .font(.inter(size: 11))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            .padding(.vertical, 4)
                        }

                        if job.status == "completed" {
                            if let total = job.totalEmails {
                                HStack {
                                    Text("Total Emails")
                                        .font(.inter(size: 14))
                                        .foregroundStyle(AppTheme.muted)
                                    Spacer()
                                    Text("\(total)")
                                        .font(.inter(size: 14, weight: .medium))
                                        .foregroundStyle(AppTheme.ink)
                                }
                            }
                            if let bytes = job.fileSizeBytes {
                                HStack {
                                    Text("Archive Size")
                                        .font(.inter(size: 14))
                                        .foregroundStyle(AppTheme.muted)
                                    Spacer()
                                    Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file))
                                        .font(.inter(size: 14, weight: .medium))
                                        .foregroundStyle(AppTheme.ink)
                                }
                            }
                            if let downloadUrl = APIClient.shared.exportDownloadURL(jobId: job.id), let url = URL(string: downloadUrl) {
                                Link(destination: url) {
                                    HStack {
                                        Spacer()
                                        Label("Download .mbox Archive", systemImage: "arrow.down.circle.fill")
                                            .font(.inter(size: 15, weight: .semibold))
                                            .foregroundStyle(AppTheme.accent)
                                        Spacer()
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                            Text("Archives are retained securely in Cloudflare R2 for 7 days.")
                                .font(.inter(size: 11))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                } else {
                    Section {
                        Button {
                            Task { await startExport() }
                        } label: {
                            HStack {
                                Spacer()
                                if isStarting {
                                    ProgressView()
                                } else {
                                    Label("Start Domain Export", systemImage: "arrow.down.doc")
                                        .font(.inter(size: 15, weight: .semibold))
                                        .foregroundStyle(AppTheme.accent)
                                }
                                Spacer()
                            }
                        }
                        .disabled(isStarting)
                    }
                }
            }
            .navigationTitle("Export Domain Emails")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        pollingTask?.cancel()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
            .onDisappear {
                pollingTask?.cancel()
            }
        }
    }

    @ViewBuilder
    private func statusBadge(for status: String) -> some View {
        switch status {
        case "completed":
            Label("Completed", systemImage: "checkmark.circle.fill")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(Color.green)
        case "processing":
            Label("Processing", systemImage: "arrow.triangle.2.circlepath")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.accent)
        case "failed":
            Label("Failed", systemImage: "exclamationmark.circle.fill")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.deepDarkRed)
        default:
            Label("Queued", systemImage: "clock")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.muted)
        }
    }

    private func startExport() async {
        isStarting = true
        errorMessage = nil
        do {
            let job = try await APIClient.shared.exportDomain(domain: domain)
            currentJob = job
            startPolling(jobId: job.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isStarting = false
    }

    private func startPolling(jobId: String) {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard !Task.isCancelled else { break }
                do {
                    let updated = try await APIClient.shared.getExportJob(exportId: jobId)
                    currentJob = updated
                    if updated.status == "completed" || updated.status == "failed" {
                        break
                    }
                } catch {
                    // continue polling
                }
            }
        }
    }
}

/// Sheet for moving DNS away from Cloudflare, backing up data, and decommissioning domain.
struct DomainOffboardSheet: View {
    let domain: String
    var onDecommissioned: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var preflight: DecommissionPreflightResponse?
    @State private var isLoadingPreflight = true
    @State private var skipBackup = false
    @State private var confirmDomainInput = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var eppCode: String?
    @State private var isLoadingEpp = false
    @State private var isTogglingLock = false
    @State private var showExportSheet = false
    @State private var isDecommissionSuccess = false

    var canDecommission: Bool {
        guard let preflight else { return false }
        let backupSatisfied = preflight.hasRecentExport || skipBackup
        let domainMatches = confirmDomainInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == domain.lowercased()
        return backupSatisfied && domainMatches && !isSubmitting
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    }
                }
                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.accent)
                    }
                }

                if isDecommissionSuccess {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 36))
                                .foregroundStyle(Color.green)
                            Text("Domain Decommissioned")
                                .font(.inter(size: 18, weight: .bold))
                                .foregroundStyle(AppTheme.ink)
                            Text("DNS routing and Cloudflare zone configurations have been released.")
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.muted)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                } else if isLoadingPreflight {
                    Section {
                        HStack {
                            Spacer()
                            ProgressView("Checking domain status...")
                            Spacer()
                        }
                        .padding(.vertical, 16)
                    }
                } else if let preflight {
                    // Warning Banner
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(Color.orange)
                                Text("Caution: Service Decommissioning")
                                    .font(.inter(size: 14, weight: .semibold))
                                    .foregroundStyle(AppTheme.ink)
                            }
                            Text("Moving DNS away from Cloudflare or decommissioning this domain will shut down email routing and active mailboxes. Emails sent here will bounce once nameservers change.")
                                .font(.inter(size: 12))
                                .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.vertical, 2)
                    }

                    // Active Mailboxes summary
                    Section("Active Mailboxes") {
                        HStack {
                            Text("Mailboxes on \(domain)")
                                .font(.inter(size: 14))
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            Text("\(preflight.activeMailboxCount)")
                                .font(.inter(size: 14, weight: .semibold))
                                .foregroundStyle(AppTheme.ink)
                        }
                    }

                    // Email Data Backup Safeguard
                    Section("Email Data Backup") {
                        if preflight.hasRecentExport {
                            HStack {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Color.green)
                                Text("Recent backup found (\(preflight.lastExport?.totalEmails ?? 0) emails)")
                                    .font(.inter(size: 13, weight: .medium))
                                    .foregroundStyle(Color.green)
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("No recent domain export found. We strongly recommend exporting your emails before decommissioning.")
                                    .font(.inter(size: 12))
                                    .foregroundStyle(Color.orange)

                                Button {
                                    showExportSheet = true
                                } label: {
                                    Label("Export (.mbox) Now", systemImage: "arrow.down.doc")
                                        .font(.inter(size: 13, weight: .semibold))
                                        .foregroundStyle(AppTheme.accent)
                                }

                                Toggle(isOn: $skipBackup) {
                                    Text("I have already backed up my emails or choose to proceed without an export")
                                        .font(.inter(size: 12))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .padding(.top, 4)
                            }
                            .padding(.vertical, 4)
                        }
                    }

                    // Registrar Domain Transfer (if registered on Cloudflare Registrar)
                    if preflight.isRegistrarDomain {
                        Section("Cloudflare Registrar Transfer") {
                            Text("This domain is registered via Cloudflare Registrar. To transfer it to another registrar:")
                                .font(.inter(size: 12))
                                .foregroundStyle(AppTheme.muted)

                            HStack {
                                Text("Transfer Lock")
                                    .font(.inter(size: 14))
                                    .foregroundStyle(AppTheme.muted)
                                Spacer()
                                Button(preflight.transferLocked ? "Locked" : "Unlocked") {
                                    Task { await toggleTransferLock() }
                                }
                                .buttonStyle(.bordered)
                                .tint(preflight.transferLocked ? AppTheme.accent : Color.green)
                                .disabled(isTogglingLock)
                            }

                            if let code = eppCode {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("EPP Auth Code")
                                            .font(.inter(size: 11))
                                            .foregroundStyle(AppTheme.muted)
                                        Text(code)
                                            .font(.system(size: 13, design: .monospaced))
                                            .foregroundStyle(AppTheme.ink)
                                    }
                                    Spacer()
                                    Button {
                                        UIPasteboard.general.string = code
                                        statusMessage = "EPP Code copied to clipboard"
                                    } label: {
                                        Image(systemName: "doc.on.doc")
                                            .foregroundStyle(AppTheme.accent)
                                    }
                                }
                            } else {
                                Button {
                                    Task { await revealEppCode() }
                                } label: {
                                    HStack {
                                        if isLoadingEpp { ProgressView() }
                                        else { Text("Reveal EPP Transfer Code") }
                                    }
                                }
                                .disabled(isLoadingEpp)
                            }
                        }
                    }

                    // Confirmation Challenge Section
                    Section("Confirm Decommission") {
                        Text("Type \(domain) below to verify:")
                            .font(.inter(size: 12))
                            .foregroundStyle(AppTheme.muted)

                        TextField(domain, text: $confirmDomainInput)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()

                        Button(role: .destructive) {
                            Task { await decommission() }
                        } label: {
                            HStack {
                                Spacer()
                                if isSubmitting { ProgressView() }
                                else {
                                    Text("Decommission & Release DNS")
                                        .font(.inter(size: 15, weight: .semibold))
                                        .foregroundStyle(canDecommission ? AppTheme.deepDarkRed : AppTheme.muted)
                                }
                                Spacer()
                            }
                        }
                        .disabled(!canDecommission)
                    }
                }
            }
            .navigationTitle("Move DNS / Offboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
            .sheet(isPresented: $showExportSheet) {
                DomainExportSheet(domain: domain)
            }
            .task {
                await loadPreflight()
            }
        }
    }

    private func loadPreflight() async {
        isLoadingPreflight = true
        errorMessage = nil
        do {
            preflight = try await APIClient.shared.getDecommissionPreflight(domain: domain)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingPreflight = false
    }

    private func toggleTransferLock() async {
        guard let p = preflight else { return }
        isTogglingLock = true
        errorMessage = nil
        do {
            let res = try await APIClient.shared.setDomainTransferLock(domain: domain, locked: !p.transferLocked)
            preflight?.transferLocked = res.locked
            statusMessage = res.locked ? "Transfer lock enabled" : "Domain transfer unlocked"
        } catch {
            errorMessage = error.localizedDescription
        }
        isTogglingLock = false
    }

    private func revealEppCode() async {
        isLoadingEpp = true
        errorMessage = nil
        do {
            let res = try await APIClient.shared.getDomainEppCode(domain: domain)
            eppCode = res.eppCode
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingEpp = false
    }

    private func decommission() async {
        isSubmitting = true
        errorMessage = nil
        do {
            _ = try await APIClient.shared.decommissionDomain(
                domain: domain,
                confirmDomain: confirmDomainInput.trimmingCharacters(in: .whitespacesAndNewlines),
                skipExportAcknowledged: skipBackup
            )
            isDecommissionSuccess = true
            onDecommissioned()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}
