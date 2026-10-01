package co.inboxies.app.ui.auth

import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.BuildConfig
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.models.DomainAvailabilityResponse
import co.inboxies.app.models.DomainCheckoutResponse
import co.inboxies.app.models.InvitePublic
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.settings.DomainAdminSettingsView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun InviteAcceptView(
    token: String,
    onDone: () -> Unit,
) {
    val auth = LocalAuthStore.current
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var invite by remember { mutableStateOf<InvitePublic?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }

    androidx.compose.runtime.LaunchedEffect(token) {
        runCatching { ApiClient.shared.getInvite(token) }
            .onSuccess { invite = it }
            .onFailure { loadError = it.message }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        TextButton(onClick = onDone) {
            Text("Cancel", color = colors.muted, fontFamily = InterFontFamily)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Accept invite",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            color = colors.ink,
        )
        when {
            loadError != null -> Text(loadError!!, color = colors.deepDarkRed, modifier = Modifier.padding(top = 12.dp))
            invite == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            else -> {
                Text(
                    "Set a password for ${invite!!.mailboxId}",
                    color = colors.muted,
                    fontFamily = InterFontFamily,
                    modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
                )
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text("Display name (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = { Text("Confirm password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                formError?.let {
                    Text(it, color = colors.deepDarkRed, modifier = Modifier.padding(top = 8.dp))
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        scope.launch {
                            formError = null
                            if (password != confirm) {
                                formError = "Passwords do not match"
                                return@launch
                            }
                            if (password.length < 10) {
                                formError = "Password must be at least 10 characters"
                                return@launch
                            }
                            submitting = true
                            try {
                                val result = ApiClient.shared.acceptInvite(
                                    token,
                                    password,
                                    displayName.ifBlank { null },
                                )
                                auth.applySession(result.token, result.mailboxId)
                                app.bootstrap(result.token)
                                onDone()
                            } catch (e: Exception) {
                                formError = e.message
                            } finally {
                                submitting = false
                            }
                        }
                    },
                    enabled = !submitting && password.length >= 10,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (submitting) CircularProgressIndicator()
                    else Text("Create account", fontFamily = InterFontFamily)
                }
            }
        }
    }
}

sealed interface OnboardingTrack {
    data object Select : OnboardingTrack
    data object Personal : OnboardingTrack
    data object Domain : OnboardingTrack
    data class DnsWizard(val domain: String, val nameservers: List<String>) : OnboardingTrack
}

@Composable
fun MailboxOnboardingView(
    initialTrack: OnboardingTrack = OnboardingTrack.Personal,
) {
    val app = LocalAppModel.current
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val isAdmin by app.isAdmin.collectAsState()
    val mailDomain by app.mailDomain.collectAsState()

    var track by remember { mutableStateOf<OnboardingTrack>(initialTrack) }
    var devTapCount by remember { mutableStateOf(0) }

    // Personal form state
    var personalName by remember { mutableStateOf("") }
    var personalUsername by remember { mutableStateOf("") }

    // Custom domain form state
    var customDomain by remember { mutableStateOf("") }
    var customUsername by remember { mutableStateOf("") }
    var customPassword by remember { mutableStateOf("") }
    var customName by remember { mutableStateOf("") }
    var availability by remember { mutableStateOf<DomainAvailabilityResponse?>(null) }
    var isCheckingDomain by remember { mutableStateOf(false) }
    var domainAction by remember { mutableStateOf("purchase") }

    LaunchedEffect(customDomain) {
        val trimmed = customDomain.trim().lowercase().removePrefix(".").removeSuffix(".")
        if (!trimmed.contains(".") || trimmed.endsWith(".")) {
            availability = null
            isCheckingDomain = false
            return@LaunchedEffect
        }
        isCheckingDomain = true
        delay(500)
        try {
            val res = ApiClient.shared.checkDomainAvailability(trimmed)
            availability = res
            domainAction = if (res.available) "purchase" else "connect"
        } catch (e: Exception) {
            availability = null
        } finally {
            isCheckingDomain = false
        }
    }

    var isSubmitting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    if (isAdmin && track == OnboardingTrack.Select) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
        ) {
            TextButton(
                onClick = { auth.signOut() },
                modifier = Modifier.padding(horizontal = 8.dp),
            ) {
                Text("Sign out", color = colors.deepDarkRed, fontFamily = InterFontFamily)
            }
            DomainAdminSettingsView()
        }
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        // Sign Out button
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Start,
        ) {
            TextButton(onClick = { auth.signOut() }) {
                Text("Sign out", color = colors.deepDarkRed, fontFamily = InterFontFamily)
            }
        }

        Spacer(Modifier.height(16.dp))

        errorMessage?.let { msg ->
            Text(
                msg,
                color = colors.deepDarkRed,
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }

        statusMessage?.let { msg ->
            Text(
                msg,
                color = colors.accent,
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }

        when (val currentTrack = track) {
            OnboardingTrack.Select -> {
                Text(
                    "Welcome to Inboxies",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    color = colors.ink,
                )
                Text(
                    "Choose how you would like to set up your email.",
                    fontFamily = InterFontFamily,
                    fontSize = 15.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
                )

                // Track Choice: Personal Address
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surface)
                        .border(BorderStroke(0.5.dp, colors.line.copy(alpha = 0.65f)), RoundedCornerShape(12.dp))
                        .clickable {
                            errorMessage = null
                            track = OnboardingTrack.Personal
                        }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF16A34A).copy(alpha = 0.12f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Outlined.Mail,
                            contentDescription = null,
                            tint = Color(0xFF16A34A),
                            modifier = Modifier.size(20.dp),
                        )
                    }

                    Spacer(Modifier.width(14.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Personal Address",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
                            color = colors.ink,
                        )
                        Text(
                            "Instant @$mailDomain email. No setup required.",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                        )
                    }

                    Icon(
                        Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                        contentDescription = null,
                        tint = colors.muted.copy(alpha = 0.55f),
                        modifier = Modifier.size(16.dp),
                    )
                }

                Spacer(Modifier.height(12.dp))

                // Track Choice: Custom Domain
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surface)
                        .border(BorderStroke(0.5.dp, colors.line.copy(alpha = 0.65f)), RoundedCornerShape(12.dp))
                        .clickable {
                            errorMessage = null
                            track = OnboardingTrack.Domain
                        }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(colors.accent.copy(alpha = 0.12f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Outlined.Public,
                            contentDescription = null,
                            tint = colors.accent,
                            modifier = Modifier.size(20.dp),
                        )
                    }

                    Spacer(Modifier.width(14.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Custom Domain",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
                            color = colors.ink,
                        )
                        Text(
                            "Automate Cloudflare setup with your own domain.",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                        )
                    }

                    Icon(
                        Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                        contentDescription = null,
                        tint = colors.muted.copy(alpha = 0.55f),
                        modifier = Modifier.size(16.dp),
                    )
                }
            }

            OnboardingTrack.Personal -> {
                Text(
                    "Welcome to Inboxies",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    color = colors.ink,
                    modifier = Modifier.clickable {
                        if (BuildConfig.DEBUG) {
                            devTapCount += 1
                            if (devTapCount >= 5) {
                                track = OnboardingTrack.Domain
                                devTapCount = 0
                            }
                        }
                    },
                )
                Text(
                    "Choose your address on @$mailDomain.",
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(top = 4.dp, bottom = 20.dp),
                )

                OutlinedTextField(
                    value = personalName,
                    onValueChange = { personalName = it },
                    label = { Text("Full Name (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )

                Spacer(Modifier.height(12.dp))

                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = personalUsername,
                        onValueChange = { personalUsername = it.substringBefore('@') },
                        label = { Text("Username") },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                    )
                    Text(
                        "@$mailDomain",
                        fontFamily = InterFontFamily,
                        color = colors.muted,
                        modifier = Modifier.padding(start = 8.dp, top = 8.dp),
                    )
                }

                Spacer(Modifier.height(24.dp))

                Button(
                    onClick = {
                        scope.launch {
                            isSubmitting = true
                            errorMessage = null
                            try {
                                val fullEmail = "$personalUsername@$mailDomain"
                                app.createMailbox(
                                    personalName.ifBlank { personalUsername },
                                    fullEmail,
                                )
                            } catch (e: Exception) {
                                errorMessage = e.message ?: "Failed to create personal address"
                            } finally {
                                isSubmitting = false
                            }
                        }
                    },
                    enabled = personalUsername.isNotBlank() && !isSubmitting,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.ink,
                        contentColor = colors.surface,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                ) {
                    if (isSubmitting) {
                        CircularProgressIndicator(
                            color = colors.surface,
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(
                            "Create Address",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 16.sp,
                        )
                    }
                }

                if (BuildConfig.DEBUG) {
                    Spacer(Modifier.height(8.dp))

                    TextButton(
                        onClick = { track = OnboardingTrack.Domain },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            "🧪 Test Domain Onboarding (Dev only)",
                            color = colors.muted.copy(alpha = 0.7f),
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                        )
                    }
                }
            }

            OnboardingTrack.Domain -> {
                Text(
                    "Connect Custom Domain",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = colors.ink,
                )
                Text(
                    "We will automatically provision the Cloudflare zone and email routing.",
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(top = 4.dp, bottom = 20.dp),
                )

                OutlinedTextField(
                    value = customDomain,
                    onValueChange = { customDomain = it.trim() },
                    label = { Text("Domain (e.g. acme.corp)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )

                // Availability feedback
                if (isCheckingDomain) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(top = 6.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            color = colors.accent,
                            strokeWidth = 1.5.dp
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Checking domain availability...",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted
                        )
                    }
                } else if (availability != null) {
                    val avail = availability!!
                    if (avail.alreadyInInboxies == true) {
                        Text(
                            "This domain is already registered with Inboxies. Please sign in or use another domain.",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.deepDarkRed,
                            modifier = Modifier.padding(top = 6.dp)
                        )
                    } else if (avail.available) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = Color(0xFF16A34A),
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    "Available for $${String.format(java.util.Locale.US, "%.2f", avail.retailPriceUsd)}/yr",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp,
                                    color = Color(0xFF16A34A)
                                )
                            }

                            // 2-track choice segmented control
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(colors.pillFill)
                                    .padding(3.dp),
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(if (domainAction == "purchase") colors.surface else Color.Transparent)
                                        .clickable { domainAction = "purchase" }
                                        .padding(vertical = 8.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        "Register ($${String.format(java.util.Locale.US, "%.0f", avail.retailPriceUsd)}/yr)",
                                        fontFamily = InterFontFamily,
                                        fontWeight = if (domainAction == "purchase") FontWeight.SemiBold else FontWeight.Normal,
                                        fontSize = 12.sp,
                                        color = if (domainAction == "purchase") colors.ink else colors.muted
                                    )
                                }
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(if (domainAction == "connect") colors.surface else Color.Transparent)
                                        .clickable { domainAction = "connect" }
                                        .padding(vertical = 8.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        "I already own it",
                                        fontFamily = InterFontFamily,
                                        fontWeight = if (domainAction == "connect") FontWeight.SemiBold else FontWeight.Normal,
                                        fontSize = 12.sp,
                                        color = if (domainAction == "connect") colors.ink else colors.muted
                                    )
                                }
                            }
                        }
                    } else {
                        Text(
                            "Registered elsewhere",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                            modifier = Modifier.padding(top = 6.dp)
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))

                // Powered by Cloudflare Brand Card
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(colors.surface)
                        .border(BorderStroke(0.5.dp, colors.line.copy(alpha = 0.65f)), RoundedCornerShape(10.dp))
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Outlined.Security,
                        contentDescription = null,
                        tint = Color(0xFFF97316),
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(
                            "Powered by Cloudflare",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                            color = colors.ink
                        )
                        Text(
                            "Anycast DNS • Universal SSL • DMARC Email Routing • DDoS Protection",
                            fontFamily = InterFontFamily,
                            fontSize = 11.sp,
                            color = colors.muted
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))

                Text(
                    "Admin Credentials",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = colors.ink,
                    modifier = Modifier.padding(bottom = 8.dp),
                )

                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = customUsername,
                        onValueChange = { customUsername = it.substringBefore('@') },
                        label = { Text("Username") },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                    )
                    Text(
                        "@${if (customDomain.isNotBlank()) customDomain else "yourdomain.com"}",
                        fontFamily = InterFontFamily,
                        color = colors.muted,
                        modifier = Modifier.padding(start = 8.dp, top = 8.dp),
                    )
                }

                Spacer(Modifier.height(8.dp))

                OutlinedTextField(
                    value = customName,
                    onValueChange = { customName = it },
                    label = { Text("Full Name (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )

                Spacer(Modifier.height(8.dp))

                OutlinedTextField(
                    value = customPassword,
                    onValueChange = { customPassword = it },
                    label = { Text("Password (min 10 chars)") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )

                Spacer(Modifier.height(24.dp))

                if (domainAction == "purchase" && (availability?.available == true)) {
                    Button(
                        onClick = {
                            scope.launch {
                                isSubmitting = true
                                errorMessage = null
                                try {
                                    val domain = customDomain.trim().lowercase()
                                    val username = customUsername.trim().lowercase()
                                    val returnUrl = "inboxies://onboarding/domain-ready"
                                    val res = ApiClient.shared.createDomainCheckout(
                                        domain = domain,
                                        username = username,
                                        password = customPassword,
                                        displayName = customName.ifBlank { null },
                                        returnUrl = returnUrl
                                    )
                                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(res.checkoutUrl))
                                    context.startActivity(intent)
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Failed to initiate domain checkout"
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = customDomain.isNotBlank() && customUsername.isNotBlank() && customPassword.length >= 10 && !isSubmitting && availability?.alreadyInInboxies != true,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.ink,
                            contentColor = colors.surface,
                        ),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(
                                color = colors.surface,
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                "Continue to Checkout ($${String.format(java.util.Locale.US, "%.2f", availability?.retailPriceUsd ?: 14.0)}/yr)",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 16.sp,
                            )
                        }
                    }
                } else {
                    Button(
                        onClick = {
                            scope.launch {
                                isSubmitting = true
                                errorMessage = null
                                try {
                                    val res = ApiClient.shared.signupDomain(
                                        domain = customDomain.trim(),
                                        username = customUsername.trim(),
                                        password = customPassword,
                                        displayName = customName.ifBlank { null },
                                    )
                                    auth.applySession(res.token, res.mailbox.email)
                                    app.bootstrap(res.token)
                                    track = OnboardingTrack.DnsWizard(
                                        domain = res.domain.domain,
                                        nameservers = res.domain.nameservers,
                                    )
                                } catch (e: Exception) {
                                    errorMessage = e.message ?: "Failed to provision custom domain"
                                } finally {
                                    isSubmitting = false
                                }
                            }
                        },
                        enabled = customDomain.isNotBlank() && customUsername.isNotBlank() && customPassword.length >= 10 && !isSubmitting && availability?.alreadyInInboxies != true,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.ink,
                            contentColor = colors.surface,
                        ),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(
                                color = colors.surface,
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                "Connect & Provision Domain",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 16.sp,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))

                TextButton(
                    onClick = { track = OnboardingTrack.Personal },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("← Back to Personal Address", color = colors.muted, fontFamily = InterFontFamily)
                }
            }

            is OnboardingTrack.DnsWizard -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.CheckCircle,
                        contentDescription = null,
                        tint = Color(0xFF16A34A),
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Domain Registered!",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp,
                        color = Color(0xFF16A34A),
                    )
                }

                Text(
                    "Cloudflare Email Routing is ready for ${currentTrack.domain}.",
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(top = 4.dp, bottom = 20.dp),
                )

                // Nameservers Card
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surface)
                        .border(BorderStroke(0.5.dp, colors.line.copy(alpha = 0.65f)), RoundedCornerShape(12.dp))
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        "Update Registrar Nameservers",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                        color = colors.ink,
                    )
                    Text(
                        "Point your nameservers to Cloudflare at your registrar (GoDaddy, Namecheap, etc.):",
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                    )

                    HorizontalDivider(thickness = 0.5.dp, color = colors.line.copy(alpha = 0.65f))

                    currentTrack.nameservers.forEach { ns ->
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

                Spacer(Modifier.height(24.dp))

                Button(
                    onClick = {
                        scope.launch {
                            app.refreshMailboxes(showLoading = true)
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.accent,
                        contentColor = Color.White,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                ) {
                    Text(
                        "Go to Inbox",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                    )
                }
            }
        }
    }
}
