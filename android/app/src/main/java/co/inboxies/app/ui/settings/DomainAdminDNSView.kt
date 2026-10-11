package co.inboxies.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import android.view.HapticFeedbackConstants
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.AdminDomainConnectResponse
import co.inboxies.app.models.AdminDomainInfo
import co.inboxies.app.models.CloudflareDnsRecord
import co.inboxies.app.models.DecommissionPreflightResponse
import co.inboxies.app.models.DomainAvailabilityResponse
import co.inboxies.app.models.DomainHealthResponse
import co.inboxies.app.models.EmailHealthItem
import co.inboxies.app.models.ExportJob
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * Complete DNS Configuration Suite for Cloudflare Zones & Email Health.
 * Design twin of iOS `DomainAdminDNSView.swift`.
 */
@Composable
fun DomainAdminDNSView(
    onBack: (() -> Unit)? = null,
    initialDomain: String? = null,
    justPurchased: Boolean = false,
    previewDomains: List<AdminDomainInfo>? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val mailDomain by app.mailDomain.collectAsState()

    var domains by remember { mutableStateOf(previewDomains ?: emptyList()) }
    var selectedDomain by remember { mutableStateOf(initialDomain.orEmpty()) }
    var healthResponse by remember { mutableStateOf<DomainHealthResponse?>(null) }
    var dnsRecords by remember { mutableStateOf<List<CloudflareDnsRecord>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var isFixing by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var showAddRecord by remember { mutableStateOf(false) }
    var showAddDomainDialog by remember { mutableStateOf(false) }
    var showExportDialog by remember { mutableStateOf(false) }
    var showOffboardDialog by remember { mutableStateOf(false) }
    var recordToDelete by remember { mutableStateOf<CloudflareDnsRecord?>(null) }
    var domainMenuExpanded by remember { mutableStateOf(false) }

    suspend fun loadDomainData(domain: String) {
        if (domain.isBlank()) return
        errorMessage = null
        try {
            coroutineScope {
                val healthDef = async { ApiClient.shared.getDomainDnsHealth(domain) }
                val recordsDef = async { ApiClient.shared.listDomainDnsRecords(domain) }
                healthResponse = healthDef.await()
                dnsRecords = recordsDef.await()
            }
        } catch (e: Exception) {
            errorMessage = e.message ?: "Failed to load DNS data"
        }
    }

    fun reloadCurrent() {
        scope.launch {
            isLoading = true
            loadDomainData(selectedDomain)
            isLoading = false
        }
    }

    LaunchedEffect(Unit) {
        isLoading = true
        try {
            val fetchedDomains = previewDomains ?: ApiClient.shared.listAdminDomains()
            domains = fetchedDomains
            val target = when {
                !initialDomain.isNullOrBlank() -> initialDomain
                fetchedDomains.isNotEmpty() -> fetchedDomains.first().domain
                mailDomain.isNotBlank() -> mailDomain
                else -> ""
            }
            selectedDomain = target
            if (target.isNotBlank()) {
                loadDomainData(target)
            }
        } catch (e: Exception) {
            errorMessage = e.message ?: "Failed to load domains"
        } finally {
            isLoading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background),
    ) {
        // Top Toolbar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                HomeChromeToolbarButton(
                    icon = Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
            }
            Text(
                "DNS Configuration",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 8.dp),
            )
            HomeChromeToolbarButton(
                icon = Icons.Outlined.Refresh,
                contentDescription = "Refresh",
                onClick = { reloadCurrent() },
            )
        }

        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = colors.accent)
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Error & Status banners
                errorMessage?.let { msg ->
                    Text(
                        msg,
                        color = colors.deepDarkRed,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                    )
                }

                statusMessage?.let { msg ->
                    Text(
                        msg,
                        color = colors.accent,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                    )
                }

                // Domain selector dropdown if multiple domains
                if (domains.size > 1) {
                    SettingsFormSectionHeader("Domain")
                    SettingsFormGroup {
                        Box(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { domainMenuExpanded = true }
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    selectedDomain,
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 15.sp,
                                    color = colors.ink,
                                    modifier = Modifier.weight(1f),
                                )
                                Icon(
                                    Icons.Outlined.KeyboardArrowDown,
                                    contentDescription = "Select Domain",
                                    tint = colors.muted,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                            InboxiesDropdownMenu(
                                expanded = domainMenuExpanded,
                                onDismiss = { domainMenuExpanded = false },
                            ) {
                                domains.forEach { d ->
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                d.domain,
                                                fontFamily = InterFontFamily,
                                                fontSize = 14.sp,
                                                color = colors.ink,
                                            )
                                        },
                                        onClick = {
                                            domainMenuExpanded = false
                                            selectedDomain = d.domain
                                            reloadCurrent()
                                        },
                                    )
                                }
                            }
                        }
                    }
                }

                if (justPurchased) {
                    SettingsFormGroup {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Outlined.CheckCircle,
                                contentDescription = null,
                                tint = Color(0xFF16A34A),
                                modifier = Modifier.size(24.dp),
                            )
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(
                                    "Domain Active & Provisioned",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 15.sp,
                                    color = colors.ink,
                                )
                                Text(
                                    "Registered via Cloudflare Registrar. Anycast DNS, SSL, and Email Routing are configured.",
                                    fontFamily = InterFontFamily,
                                    fontSize = 12.sp,
                                    color = colors.muted,
                                )
                            }
                        }
                    }
                }

                // Cloudflare Edge Services Showcase
                SettingsFormSectionHeader("Cloudflare Edge Services")
                SettingsFormGroup {
                    EdgeServiceItem(
                        title = "Anycast DNS",
                        desc = "Sub-millisecond resolution across 300+ global Cloudflare cities",
                        icon = Icons.Outlined.Public,
                    )
                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))
                    EdgeServiceItem(
                        title = "Universal SSL / TLS",
                        desc = "Automated Edge certificates with modern TLS 1.3 encryption",
                        icon = Icons.Outlined.Lock,
                    )
                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))
                    EdgeServiceItem(
                        title = "Email Routing & DMARC",
                        desc = "High-deliverability SPF, DKIM, and anti-spoofing policies",
                        icon = Icons.Outlined.Mail,
                    )
                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))
                    EdgeServiceItem(
                        title = "DDoS & WAF Protection",
                        desc = "Enterprise-grade perimeter protection against malicious traffic",
                        icon = Icons.Outlined.Security,
                    )
                }

                // Domain Operations (Export & Offboard)
                SettingsFormSectionHeader("Domain Operations")
                SettingsFormGroup {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showAddDomainDialog = true }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Filled.Add,
                            contentDescription = null,
                            tint = colors.accent,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "Add / Register Custom Domain",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 14.sp,
                            color = colors.accent,
                            modifier = Modifier.weight(1f),
                        )
                    }

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showExportDialog = true }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.Download,
                            contentDescription = null,
                            tint = colors.accent,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "Export Domain Emails (.mbox)",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 14.sp,
                            color = colors.ink,
                            modifier = Modifier.weight(1f),
                        )
                    }

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showOffboardDialog = true }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.SwapHoriz,
                            contentDescription = null,
                            tint = colors.deepDarkRed,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "Move DNS / Offboard Domain",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 14.sp,
                            color = colors.deepDarkRed,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                // Cloudflare Zone & Nameservers Card
                SettingsFormSectionHeader("Cloudflare Zone & Nameservers")
                SettingsFormGroup {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Domain",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = colors.muted,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            selectedDomain,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 14.sp,
                            color = colors.ink,
                        )
                    }

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Zone Status",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = colors.muted,
                            modifier = Modifier.weight(1f),
                        )
                        val isActive = healthResponse?.zoneStatus == "active"
                        val pillColor = if (isActive) Color(0xFF16A34A) else Color(0xFFEA580C)
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .background(pillColor.copy(alpha = 0.12f))
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        ) {
                            Text(
                                if (isActive) "Active on Cloudflare" else "Pending Nameservers",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 12.sp,
                                color = pillColor,
                            )
                        }
                    }

                    val nsList = healthResponse?.nameservers ?: emptyList()
                    if (nsList.isNotEmpty()) {
                        HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "Assigned Nameservers",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 12.sp,
                                color = colors.muted,
                            )
                            nsList.forEach { ns ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        ns,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 13.sp,
                                        color = colors.ink,
                                        modifier = Modifier.weight(1f),
                                    )
                                    IconButton(
                                        onClick = {
                                            clipboard.setText(AnnotatedString(ns))
                                            statusMessage = "Copied $ns"
                                        },
                                        modifier = Modifier.size(28.dp),
                                    ) {
                                        Icon(
                                            Icons.Outlined.ContentCopy,
                                            contentDescription = "Copy Nameserver",
                                            tint = colors.accent,
                                            modifier = Modifier.size(16.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // Email Health Verification Card
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(top = 16.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "EMAIL HEALTH AUDIT",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 12.sp,
                        color = colors.muted,
                        letterSpacing = 0.4.sp,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = { reloadCurrent() },
                        modifier = Modifier.size(24.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Refresh,
                            contentDescription = "Reload Health Audit",
                            tint = colors.muted,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }

                SettingsFormGroup {
                    val auditItems = healthResponse?.audit?.items ?: emptyList()
                    if (auditItems.isEmpty()) {
                        Text(
                            "Audit pending or no records checked.",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                            modifier = Modifier.padding(16.dp),
                        )
                    } else {
                        auditItems.forEachIndexed { index, item ->
                            if (index > 0) {
                                HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))
                            }
                            EmailHealthItemRow(item = item)
                        }
                    }

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    // Fix & Auto-configure button
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !isFixing) {
                                scope.launch {
                                    isFixing = true
                                    errorMessage = null
                                    try {
                                        val res = ApiClient.shared.fixDomainEmailDns(selectedDomain)
                                        if (res.audit != null && healthResponse != null) {
                                            healthResponse = healthResponse!!.copy(audit = res.audit)
                                        }
                                        statusMessage = "Email DNS records repaired & updated"
                                        dnsRecords = ApiClient.shared.listDomainDnsRecords(selectedDomain)
                                    } catch (e: Exception) {
                                        errorMessage = e.message ?: "Failed to repair DNS"
                                    } finally {
                                        isFixing = false
                                    }
                                }
                            }
                            .padding(vertical = 14.dp, horizontal = 16.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isFixing) {
                            CircularProgressIndicator(
                                color = colors.accent,
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                Icon(
                                    Icons.Outlined.Build,
                                    contentDescription = null,
                                    tint = colors.accent,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "Fix & Auto-configure Email DNS",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 14.sp,
                                    color = colors.accent,
                                )
                            }
                        }
                    }
                }

                // DNS Records List Card
                SettingsFormSectionHeader("DNS Records (${dnsRecords.size})")
                SettingsFormGroup {
                    // Add record action
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showAddRecord = true }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = null,
                            tint = colors.accent,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Add DNS Record",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp,
                            color = colors.accent,
                        )
                    }

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    if (dnsRecords.isEmpty()) {
                        Text(
                            "No DNS records found.",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                            modifier = Modifier.padding(16.dp),
                        )
                    } else {
                        dnsRecords.forEachIndexed { index, rec ->
                            if (index > 0) {
                                HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))
                            }
                            DnsRecordRow(
                                record = rec,
                                onDelete = { recordToDelete = rec },
                            )
                        }
                    }
                }
            }
        }
    }

    // Delete Record Confirmation Alert
    recordToDelete?.let { rec ->
        AlertDialog(
            onDismissRequest = { recordToDelete = null },
            title = {
                Text(
                    "Delete DNS Record",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.ink,
                )
            },
            text = {
                Text(
                    "Are you sure you want to delete this ${rec.type} record for ${rec.name}?",
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val toDelete = rec
                        recordToDelete = null
                        scope.launch {
                            try {
                                ApiClient.shared.deleteDomainDnsRecord(selectedDomain, toDelete.id)
                                dnsRecords = dnsRecords.filterNot { it.id == toDelete.id }
                                statusMessage = "Record deleted"
                            } catch (e: Exception) {
                                errorMessage = e.message ?: "Failed to delete record"
                            }
                        }
                    },
                ) {
                    Text("Delete", color = colors.deepDarkRed, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium)
                }
            },
            dismissButton = {
                TextButton(onClick = { recordToDelete = null }) {
                    Text("Cancel", color = colors.muted, fontFamily = InterFontFamily)
                }
            },
            containerColor = colors.surface,
        )
    }

    // Add DNS Record Dialog
    if (showAddRecord) {
        AddDnsRecordDialog(
            domain = selectedDomain,
            onDismiss = { showAddRecord = false },
            onSaved = {
                showAddRecord = false
                reloadCurrent()
            },
        )
    }

    if (showAddDomainDialog) {
        AddDomainDialog(
            onDismiss = { showAddDomainDialog = false },
            onAdded = { newDomain ->
                showAddDomainDialog = false
                scope.launch {
                    val fetched = ApiClient.shared.listAdminDomains()
                    domains = fetched
                    if (newDomain.isNotBlank()) {
                        selectedDomain = newDomain
                        loadDomainData(newDomain)
                    }
                }
            },
        )
    }

    if (showExportDialog) {
        DomainExportDialog(
            domain = selectedDomain,
            onDismiss = { showExportDialog = false },
        )
    }

    if (showOffboardDialog) {
        DomainOffboardDialog(
            domain = selectedDomain,
            onDismiss = { showOffboardDialog = false },
            onDecommissioned = {
                showOffboardDialog = false
                reloadCurrent()
            },
            onOpenExport = {
                showOffboardDialog = false
                showExportDialog = true
            },
        )
    }
}

@Composable
private fun EmailHealthItemRow(item: EmailHealthItem) {
    val colors = inboxiesColors()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Type badge
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(colors.pillFill)
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    item.type,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    color = colors.ink,
                )
            }

            Spacer(Modifier.width(8.dp))

            Text(
                item.name,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )

            HealthStatusPill(status = item.status)
        }

        val displayValue = item.currentValue ?: "Expected: ${item.expectedValue}"
        Text(
            displayValue,
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            color = colors.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )

        Text(
            item.message,
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )
    }
}

@Composable
private fun HealthStatusPill(status: String) {
    val colors = inboxiesColors()
    val (label, tint, bg) = when (status) {
        "connected" -> Triple("Connected", Color(0xFF16A34A), Color(0xFF16A34A).copy(alpha = 0.12f))
        "conflict" -> Triple("Conflict", colors.deepDarkRed, colors.deepDarkRed.copy(alpha = 0.12f))
        "missing" -> Triple("Missing", Color(0xFFEA580C), Color(0xFFEA580C).copy(alpha = 0.12f))
        else -> Triple("Pending", colors.accent, colors.accent.copy(alpha = 0.12f))
    }

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(bg)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                when (status) {
                    "connected" -> Icons.Outlined.CheckCircle
                    "conflict", "missing" -> Icons.Outlined.Warning
                    else -> Icons.Outlined.Refresh
                },
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(12.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                label,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 11.sp,
                color = tint,
            )
        }
    }
}

@Composable
private fun DnsRecordRow(
    record: CloudflareDnsRecord,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Type badge
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(colors.pillFill)
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(
                    record.type,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    color = colors.ink,
                )
            }

            Spacer(Modifier.width(8.dp))

            Text(
                record.name,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )

            if (record.proxied) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0xFFEA580C).copy(alpha = 0.12f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(
                        "Proxied",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 10.sp,
                        color = Color(0xFFEA580C),
                    )
                }
            } else {
                Text(
                    "DNS Only",
                    fontFamily = InterFontFamily,
                    fontSize = 10.sp,
                    color = colors.muted,
                )
            }

            IconButton(
                onClick = onDelete,
                modifier = Modifier.size(28.dp).padding(start = 4.dp),
            ) {
                Icon(
                    Icons.Outlined.Delete,
                    contentDescription = "Delete Record",
                    tint = colors.deepDarkRed,
                    modifier = Modifier.size(16.dp),
                )
            }
        }

        val contentWithPriority = if (record.priority != null) {
            "${record.content} (Priority: ${record.priority})"
        } else {
            record.content
        }

        Text(
            contentWithPriority,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
            color = colors.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Dialog for adding or purchasing a custom domain in Domain Admin.
 * Design twin of iOS AddDomainSheet.
 */
@Composable
private fun AddDomainDialog(
    onDismiss: () -> Unit,
    onAdded: (String) -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val view = LocalView.current

    var domain by remember { mutableStateOf("") }
    var availability by remember { mutableStateOf<DomainAvailabilityResponse?>(null) }
    var isChecking by remember { mutableStateOf(false) }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(domain) {
        val trimmed = domain.trim().lowercase().removePrefix(".").removeSuffix(".")
        if (!trimmed.contains(".") || trimmed.endsWith(".")) {
            availability = null
            isChecking = false
            return@LaunchedEffect
        }
        isChecking = true
        delay(500)
        try {
            val res = ApiClient.shared.checkDomainAvailability(trimmed)
            availability = res
        } catch (_: Exception) {
            availability = null
        } finally {
            isChecking = false
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = colors.surface,
            border = BorderStroke(0.5.dp, colors.line),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Header with "x" close button
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Add Custom Domain",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            onDismiss()
                        },
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = "Close",
                            tint = colors.ink,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }

                Text(
                    "Connect your domain with Cloudflare Anycast DNS and Email Routing, or register an available domain wholesale.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )

                errorMessage?.let { msg ->
                    Text(
                        msg,
                        color = colors.deepDarkRed,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                    )
                }

                // Domain input
                OutlinedTextField(
                    value = domain,
                    onValueChange = { domain = it },
                    label = { Text("Domain Name", fontFamily = InterFontFamily) },
                    placeholder = { Text("e.g. acmemail.org", fontFamily = InterFontFamily) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    trailingIcon = {
                        if (isChecking) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = colors.accent,
                            )
                        }
                    },
                )

                val avail = availability
                if (avail != null) {
                    if (avail.available) {
                        // Registration Option Card
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(colors.background)
                                .border(BorderStroke(0.5.dp, colors.line.copy(alpha = 0.65f)), RoundedCornerShape(10.dp))
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = Color(0xFF16A34A),
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "Available for Registration",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp,
                                    color = colors.ink,
                                )
                            }
                            Text(
                                "Wholesale price: $${String.format(java.util.Locale.US, "%.2f", avail.retailPriceUsd)} / year via Cloudflare Registrar",
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.muted,
                            )
                        }

                        Button(
                            onClick = {
                                val trimmed = domain.trim().lowercase().removePrefix(".").removeSuffix(".")
                                if (trimmed.isBlank()) return@Button
                                isSubmitting = true
                                errorMessage = null
                                scope.launch {
                                    try {
                                        val returnUrl = "inboxies://onboarding/domain-ready?domain=$trimmed"
                                        val res = ApiClient.shared.createDomainCheckout(
                                            domain = trimmed,
                                            returnUrl = returnUrl,
                                            client = "android",
                                        )
                                        co.inboxies.app.config.AppConfig.rememberPendingCheckout(res.sessionId)
                                        val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(res.checkoutUrl))
                                        browserIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                                        context.startActivity(browserIntent)
                                        onDismiss()
                                    } catch (e: Exception) {
                                        errorMessage = e.message ?: "Failed to initiate domain checkout"
                                    } finally {
                                        isSubmitting = false
                                    }
                                }
                            },
                            enabled = !isSubmitting,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = colors.ink,
                                contentColor = colors.surface,
                            ),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(44.dp),
                        ) {
                            if (isSubmitting) {
                                CircularProgressIndicator(
                                    color = colors.surface,
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                )
                            } else {
                                val total = avail.pricing?.totalAnnualUsd ?: avail.retailPriceUsd
                                Text(
                                    "Subscribe & Register ($${String.format(java.util.Locale.US, "%.2f", total)}/yr)",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 15.sp,
                                )
                            }
                        }

                        TextButton(
                            onClick = {
                                val trimmed = domain.trim().lowercase().removePrefix(".").removeSuffix(".")
                                if (trimmed.isBlank()) return@TextButton
                                isSubmitting = true
                                errorMessage = null
                                scope.launch {
                                    try {
                                        val res = ApiClient.shared.connectAdminDomain(trimmed)
                                        onAdded(res.domain.domain)
                                    } catch (e: Exception) {
                                        errorMessage = e.message ?: "Failed to connect domain"
                                    } finally {
                                        isSubmitting = false
                                    }
                                }
                            },
                            enabled = !isSubmitting,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                "Connect DNS Only (No Purchase)",
                                fontFamily = InterFontFamily,
                                fontSize = 13.sp,
                                color = colors.muted,
                            )
                        }
                    } else {
                        // Registered elsewhere Card
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(colors.background)
                                .border(BorderStroke(0.5.dp, colors.line.copy(alpha = 0.65f)), RoundedCornerShape(10.dp))
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Outlined.Public,
                                    contentDescription = null,
                                    tint = colors.accent,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "Registered Elsewhere",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp,
                                    color = colors.ink,
                                )
                            }
                            Text(
                                "Automates Cloudflare Zone creation and Email Routing configuration.",
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.muted,
                            )
                        }

                        Button(
                            onClick = {
                                val trimmed = domain.trim().lowercase().removePrefix(".").removeSuffix(".")
                                if (trimmed.isBlank()) return@Button
                                isSubmitting = true
                                errorMessage = null
                                scope.launch {
                                    try {
                                        val res = ApiClient.shared.connectAdminDomain(trimmed)
                                        onAdded(res.domain.domain)
                                    } catch (e: Exception) {
                                        errorMessage = e.message ?: "Failed to connect domain"
                                    } finally {
                                        isSubmitting = false
                                    }
                                }
                            },
                            enabled = !isSubmitting,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = colors.ink,
                                contentColor = colors.surface,
                            ),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(44.dp),
                        ) {
                            if (isSubmitting) {
                                CircularProgressIndicator(
                                    color = colors.surface,
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                )
                            } else {
                                Text(
                                    "Connect Domain to Cloudflare",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 15.sp,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Dialog for adding a new DNS Record.
 * Dismiss control strictly uses "x" icon per rule.
 */
@Composable
private fun AddDnsRecordDialog(
    domain: String,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val view = LocalView.current

    var type by remember { mutableStateOf("A") }
    var name by remember { mutableStateOf("@") }
    var content by remember { mutableStateOf("") }
    var priority by remember { mutableIntStateOf(10) }
    var proxied by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var typeDropdownExpanded by remember { mutableStateOf(false) }

    val types = listOf("A", "AAAA", "CNAME", "TXT", "MX", "NS")

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = colors.surface,
            border = BorderStroke(0.5.dp, colors.line),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Header with "x" close button per guidelines
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Add DNS Record",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            onDismiss()
                        },
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = "Close",
                            tint = colors.ink,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }

                errorMessage?.let {
                    Text(it, color = colors.deepDarkRed, fontFamily = InterFontFamily, fontSize = 12.sp)
                }

                // Type selector
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Type", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
                    Box(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .border(1.dp, colors.line, RoundedCornerShape(8.dp))
                                .clickable { typeDropdownExpanded = true }
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                type,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp,
                                color = colors.ink,
                                modifier = Modifier.weight(1f),
                            )
                            Icon(
                                Icons.Outlined.KeyboardArrowDown,
                                contentDescription = null,
                                tint = colors.muted,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                        InboxiesDropdownMenu(
                            expanded = typeDropdownExpanded,
                            onDismiss = { typeDropdownExpanded = false },
                        ) {
                            types.forEach { t ->
                                DropdownMenuItem(
                                    text = { Text(t, fontFamily = FontFamily.Monospace, fontSize = 14.sp) },
                                    onClick = {
                                        type = t
                                        typeDropdownExpanded = false
                                    },
                                )
                            }
                        }
                    }
                }

                // Name field
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name (@ for root or subdomain)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.accent,
                        unfocusedBorderColor = colors.line,
                    ),
                )

                // Content / Target field
                OutlinedTextField(
                    value = content,
                    onValueChange = { content = it },
                    label = { Text("Content / Target") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.accent,
                        unfocusedBorderColor = colors.line,
                    ),
                )

                // MX Priority
                if (type == "MX") {
                    OutlinedTextField(
                        value = priority.toString(),
                        onValueChange = { priority = it.toIntOrNull() ?: priority },
                        label = { Text("Priority (e.g. 10)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = colors.accent,
                            unfocusedBorderColor = colors.line,
                        ),
                    )
                }

                // Proxied toggle for A / AAAA / CNAME
                if (type in listOf("A", "AAAA", "CNAME")) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "Proxy through Cloudflare",
                                fontFamily = InterFontFamily,
                                fontSize = 14.sp,
                                color = colors.ink,
                            )
                            Text(
                                "Accelerates and protects your traffic",
                                fontFamily = InterFontFamily,
                                fontSize = 11.sp,
                                color = colors.muted,
                            )
                        }
                        Switch(
                            checked = proxied,
                            onCheckedChange = { proxied = it },
                            colors = SwitchDefaults.colors(
                                checkedTrackColor = colors.accent,
                                checkedThumbColor = Color.White,
                            ),
                        )
                    }
                }

                // Submit button
                Button(
                    onClick = {
                        scope.launch {
                            isSaving = true
                            errorMessage = null
                            try {
                                ApiClient.shared.createDomainDnsRecord(
                                    domain = domain,
                                    type = type,
                                    name = name.trim(),
                                    content = content.trim(),
                                    ttl = 1,
                                    proxied = proxied,
                                    priority = if (type == "MX") priority else null,
                                )
                                onSaved()
                            } catch (e: Exception) {
                                errorMessage = e.message ?: "Failed to create DNS record"
                            } finally {
                                isSaving = false
                            }
                        }
                    },
                    enabled = !isSaving && name.isNotBlank() && content.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.ink,
                        contentColor = colors.surface,
                    ),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                ) {
                    if (isSaving) {
                        CircularProgressIndicator(
                            color = colors.surface,
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(
                            "Create Record",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EdgeServiceItem(
    title: String,
    desc: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = colors.accent,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = colors.ink,
            )
            Text(
                desc,
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                color = colors.muted,
            )
        }
    }
}

@Composable
private fun DomainExportDialog(
    domain: String,
    onDismiss: () -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val view = LocalView.current

    var currentJob by remember { mutableStateOf<ExportJob?>(null) }
    var isStarting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isDownloading by remember { mutableStateOf(false) }

    LaunchedEffect(currentJob?.resolvedId) {
        val jobId = currentJob?.resolvedId?.takeIf { it.isNotEmpty() } ?: return@LaunchedEffect
        while (true) {
            delay(1500)
            try {
                val updated = ApiClient.shared.getExportJob(jobId)
                currentJob = updated
                if (updated.status == "completed" || updated.status == "failed") {
                    break
                }
            } catch (_: Exception) {}
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = colors.surface,
            border = BorderStroke(0.5.dp, colors.line),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Header with "x" close button per guidelines
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Export Domain Emails",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            onDismiss()
                        },
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = "Close",
                            tint = colors.ink,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }

                errorMessage?.let {
                    Text(it, color = colors.deepDarkRed, fontFamily = InterFontFamily, fontSize = 12.sp)
                }

                // Description card
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(colors.pillFill.copy(alpha = 0.5f))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        "RFC 4155 .mbox Export",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        color = colors.ink,
                    )
                    Text(
                        "Export all emails across every mailbox on $domain into an industry-standard .mbox archive. Compatible with Apple Mail, Mozilla Thunderbird, and Google Takeout.",
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                }

                val job = currentJob
                if (job == null) {
                    Button(
                        onClick = {
                            scope.launch {
                                isStarting = true
                                errorMessage = null
                                try {
                                    val created = ApiClient.shared.exportDomain(domain)
                                    currentJob = created
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Failed to start export"
                                } finally {
                                    isStarting = false
                                }
                            }
                        },
                        enabled = !isStarting,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.ink,
                            contentColor = colors.surface,
                        ),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp),
                    ) {
                        if (isStarting) {
                            CircularProgressIndicator(
                                color = colors.surface,
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                "Start Domain Export",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 15.sp,
                            )
                        }
                    }
                } else {
                    // Export Progress / Status card
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(colors.background)
                            .border(0.5.dp, colors.line, RoundedCornerShape(8.dp))
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Status",
                                fontFamily = InterFontFamily,
                                fontSize = 13.sp,
                                color = colors.muted,
                                modifier = Modifier.weight(1f),
                            )
                            val statusColor = when (job.status) {
                                "completed" -> Color(0xFF16A34A)
                                "failed" -> colors.deepDarkRed
                                else -> colors.accent
                            }
                            Text(
                                job.status.replaceFirstChar { it.uppercase() },
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 12.sp,
                                color = statusColor,
                            )
                        }

                        if (job.status == "processing" && job.progress != null) {
                            LinearProgressIndicator(
                                progress = { job.progress.percent / 100f },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(6.dp)
                                    .clip(RoundedCornerShape(3.dp)),
                                color = colors.accent,
                                trackColor = colors.pillFill,
                            )
                            Text(
                                "${job.progress.processedCount} of ${job.progress.totalCount} emails processed (${job.progress.percent}%)",
                                fontFamily = InterFontFamily,
                                fontSize = 11.sp,
                                color = colors.muted,
                            )
                        }

                        if (job.status == "completed") {
                            job.totalEmails?.let { total ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("Total Emails", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
                                    Spacer(Modifier.weight(1f))
                                    Text("$total", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.ink)
                                }
                            }
                            job.fileSizeBytes?.let { bytes ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("Archive Size", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
                                    Spacer(Modifier.weight(1f))
                                    val mb = String.format(java.util.Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
                                    Text(mb, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.ink)
                                }
                            }

                            Button(
                                onClick = {
                                    if (isDownloading) return@Button
                                    isDownloading = true
                                    errorMessage = null
                                    scope.launch {
                                        try {
                                            // Authenticated download into cache/exports, then hand the
                                            // file to the share sheet (Files, Drive, email…).
                                            val exportId = job.resolvedId
                                            val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                                            dir.listFiles()?.forEach { it.delete() }
                                            val file = File(dir, "inboxies-export-$exportId.mbox")
                                            ApiClient.shared.downloadExport(exportId, file)
                                            val uri = FileProvider.getUriForFile(
                                                context,
                                                "${context.packageName}.fileprovider",
                                                file,
                                            )
                                            val send = Intent(Intent.ACTION_SEND).apply {
                                                type = "application/mbox"
                                                putExtra(Intent.EXTRA_STREAM, uri)
                                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                            }
                                            context.startActivity(
                                                Intent.createChooser(send, "Save export"),
                                            )
                                        } catch (e: Exception) {
                                            errorMessage = e.message ?: "Couldn't download export"
                                        } finally {
                                            isDownloading = false
                                        }
                                    }
                                },
                                enabled = !isDownloading,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = colors.accent,
                                    contentColor = Color.White,
                                ),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(40.dp),
                            ) {
                                if (isDownloading) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(16.dp),
                                        strokeWidth = 1.5.dp,
                                        color = Color.White,
                                    )
                                } else {
                                    Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                                }
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    if (isDownloading) "Downloading…" else "Download .mbox Archive",
                                    fontFamily = InterFontFamily,
                                    fontSize = 14.sp,
                                )
                            }

                            Text(
                                "Archives are retained securely in Cloudflare R2 for 7 days.",
                                fontFamily = InterFontFamily,
                                fontSize = 11.sp,
                                color = colors.muted,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DomainOffboardDialog(
    domain: String,
    onDismiss: () -> Unit,
    onDecommissioned: () -> Unit,
    onOpenExport: () -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val view = LocalView.current

    var preflight by remember { mutableStateOf<DecommissionPreflightResponse?>(null) }
    var isLoadingPreflight by remember { mutableStateOf(true) }
    var skipBackup by remember { mutableStateOf(false) }
    var confirmDomainInput by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var eppCode by remember { mutableStateOf<String?>(null) }
    var isLoadingEpp by remember { mutableStateOf(false) }
    var isTogglingLock by remember { mutableStateOf(false) }
    var isDecommissionSuccess by remember { mutableStateOf(false) }

    LaunchedEffect(domain) {
        isLoadingPreflight = true
        errorMessage = null
        try {
            preflight = ApiClient.shared.getDecommissionPreflight(domain)
        } catch (e: Exception) {
            errorMessage = e.message ?: "Failed to load preflight"
        } finally {
            isLoadingPreflight = false
        }
    }

    val canDecommission = preflight != null &&
        (preflight!!.hasRecentExport || skipBackup) &&
        confirmDomainInput.trim().lowercase() == domain.lowercase() &&
        !isSubmitting

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = colors.surface,
            border = BorderStroke(0.5.dp, colors.line),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Header with "x" close button per guidelines
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Move DNS / Offboard",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            onDismiss()
                        },
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = "Close",
                            tint = colors.ink,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }

                errorMessage?.let {
                    Text(it, color = colors.deepDarkRed, fontFamily = InterFontFamily, fontSize = 12.sp)
                }

                statusMessage?.let {
                    Text(it, color = colors.accent, fontFamily = InterFontFamily, fontSize = 12.sp)
                }

                if (isDecommissionSuccess) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Outlined.CheckCircle,
                            contentDescription = null,
                            tint = Color(0xFF16A34A),
                            modifier = Modifier.size(36.dp),
                        )
                        Text(
                            "Domain Decommissioned",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp,
                            color = colors.ink,
                        )
                        Text(
                            "DNS routing and Cloudflare zone configurations have been released.",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                        )
                        Button(
                            onClick = onDecommissioned,
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = colors.ink,
                                contentColor = colors.surface,
                            ),
                        ) {
                            Text("Done", fontFamily = InterFontFamily)
                        }
                    }
                } else if (isLoadingPreflight) {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = colors.accent, modifier = Modifier.size(24.dp))
                    }
                } else if (preflight != null) {
                    val p = preflight!!

                    // Caution Warning Box
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFFEA580C).copy(alpha = 0.08f))
                            .border(0.5.dp, Color(0xFFEA580C).copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Outlined.Warning,
                                contentDescription = null,
                                tint = Color(0xFFEA580C),
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                "Caution: Service Decommissioning",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                color = Color(0xFFEA580C),
                            )
                        }
                        Text(
                            "Moving DNS away from Cloudflare or decommissioning this domain will shut down email routing and active mailboxes. Emails sent here will bounce once nameservers change.",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.ink,
                        )
                    }

                    // Active Mailboxes summary
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Active Mailboxes",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "${p.activeMailboxCount} mailbox(es)",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                            color = colors.ink,
                        )
                    }

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    // Backup check
                    if (p.hasRecentExport) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Outlined.CheckCircle,
                                contentDescription = null,
                                tint = Color(0xFF16A34A),
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                "Recent backup found (${p.lastExport?.totalEmails ?: 0} emails)",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 12.sp,
                                color = Color(0xFF16A34A),
                            )
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                "No recent domain export found. We strongly recommend exporting your emails before decommissioning.",
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = Color(0xFFEA580C),
                            )
                            TextButton(
                                onClick = onOpenExport,
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                            ) {
                                Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Export (.mbox) Now", fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.accent)
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(
                                    checked = skipBackup,
                                    onCheckedChange = { skipBackup = it },
                                    colors = CheckboxDefaults.colors(checkedColor = colors.ink),
                                )
                                Text(
                                    "I have already backed up my emails or choose to proceed without an export",
                                    fontFamily = InterFontFamily,
                                    fontSize = 11.sp,
                                    color = colors.muted,
                                )
                            }
                        }
                    }

                    // Registrar section if domain is on Cloudflare Registrar
                    if (p.isRegistrarDomain) {
                        HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                "Cloudflare Registrar Transfer",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                color = colors.ink,
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "Transfer Lock",
                                    fontFamily = InterFontFamily,
                                    fontSize = 13.sp,
                                    color = colors.muted,
                                    modifier = Modifier.weight(1f),
                                )
                                Button(
                                    onClick = {
                                        scope.launch {
                                            isTogglingLock = true
                                            try {
                                                val res = ApiClient.shared.setDomainTransferLock(domain, !p.transferLocked)
                                                preflight = p.copy(transferLocked = res.locked)
                                                statusMessage = if (res.locked) "Transfer locked" else "Transfer unlocked"
                                            } catch (e: Exception) {
                                                errorMessage = e.message ?: "Failed to update transfer lock"
                                            } finally {
                                                isTogglingLock = false
                                            }
                                        }
                                    },
                                    enabled = !isTogglingLock,
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (p.transferLocked) colors.pillFill else Color(0xFF16A34A).copy(alpha = 0.15f),
                                        contentColor = if (p.transferLocked) colors.ink else Color(0xFF16A34A),
                                    ),
                                ) {
                                    Text(if (p.transferLocked) "Locked" else "Unlocked", fontFamily = InterFontFamily, fontSize = 12.sp)
                                }
                            }

                            if (eppCode != null) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(colors.background)
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        "EPP Code: ${eppCode!!}",
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 12.sp,
                                        color = colors.ink,
                                        modifier = Modifier.weight(1f),
                                    )
                                    IconButton(
                                        onClick = {
                                            clipboard.setText(AnnotatedString(eppCode!!))
                                            statusMessage = "EPP Code copied"
                                        },
                                        modifier = Modifier.size(24.dp),
                                    ) {
                                        Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy EPP", tint = colors.accent, modifier = Modifier.size(14.dp))
                                    }
                                }
                            } else {
                                TextButton(
                                    onClick = {
                                        scope.launch {
                                            isLoadingEpp = true
                                            try {
                                                val res = ApiClient.shared.getDomainEppCode(domain)
                                                eppCode = res.eppCode
                                            } catch (e: Exception) {
                                                errorMessage = e.message ?: "Failed to fetch EPP code"
                                            } finally {
                                                isLoadingEpp = false
                                            }
                                        }
                                    },
                                    enabled = !isLoadingEpp,
                                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                                ) {
                                    Text("Reveal EPP Transfer Code", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.accent)
                                }
                            }
                        }
                    }

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    // Confirmation challenge
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "Type $domain below to verify:",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                        OutlinedTextField(
                            value = confirmDomainInput,
                            onValueChange = { confirmDomainInput = it },
                            placeholder = { Text(domain) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = colors.accent,
                                unfocusedBorderColor = colors.line,
                            ),
                        )
                    }

                    Button(
                        onClick = {
                            scope.launch {
                                isSubmitting = true
                                errorMessage = null
                                try {
                                    ApiClient.shared.decommissionDomain(
                                        domain = domain,
                                        confirmDomain = confirmDomainInput.trim(),
                                        skipExportAcknowledged = skipBackup,
                                    )
                                    isDecommissionSuccess = true
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Failed to decommission domain"
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = canDecommission,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.deepDarkRed,
                            contentColor = Color.White,
                            disabledContainerColor = colors.pillFill,
                            disabledContentColor = colors.muted,
                        ),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp),
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(color = Color.White, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Text(
                                "Decommission & Release DNS",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 14.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}
