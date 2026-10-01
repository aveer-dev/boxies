package co.inboxies.app.ui.auth

import android.app.Activity
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import co.inboxies.app.BuildConfig
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.R
import co.inboxies.app.config.AppConfig
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.liquidGlass
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Redesigned onboarding welcome and sign-in flow for Android.
 * Design twin of iOS SignInView:
 * 1. Splash handoff transition with logo gliding up.
 * 2. 3-line headline ("Your \n Personal \n email app") + circular downward arrow button.
 * 3. Auth buttons reveal by moving the welcome view UP (not a modal).
 * 4. Side-by-side Apple and Google buttons displaying ONLY company logos in black (no text).
 * 5. Email login screen pushes entire view UP from below, with interactive drag-down return.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInView(
    isShowingSplash: Boolean = false,
    /** DEBUG preview: open the auth sheet and password form immediately. */
    expandPasswordForm: Boolean = false,
    showAuthOptionsInitial: Boolean = false,
) {
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val isBusy by auth.isBusy.collectAsState()
    val error by auth.errorMessage.collectAsState()
    val focusManager = LocalFocusManager.current

    var isHeroAnimated by remember { mutableStateOf(expandPasswordForm || showAuthOptionsInitial) }
    var isAuthRevealed by remember { mutableStateOf(expandPasswordForm || showAuthOptionsInitial) }
    var showEmailScreen by remember { mutableStateOf(expandPasswordForm) }
    var showTermsBrowser by remember { mutableStateOf(false) }

    var welcomeDragOffset by remember { mutableFloatStateOf(0f) }
    var emailDragOffset by remember { mutableFloatStateOf(0f) }

    var apiBase by remember { mutableStateOf(AppConfig.apiBaseURL) }
    val showDevLogin = BuildConfig.DEBUG && AppConfig.isLocalDevelopmentAPI
    var showDevConfig by remember {
        mutableStateOf(
            (context as? Activity)?.intent?.getBooleanExtra("showApiBase", false) == true
        )
    }
    var devTapCount by remember { mutableStateOf(0) }

    fun commitApiBase() {
        val parsed = AppConfig.parseAPIBaseURL(apiBase.trim())
        if (parsed != null) {
            apiBase = parsed
            AppConfig.apiBaseURL = parsed
        }
    }

    LaunchedEffect(isShowingSplash) {
        if (!isShowingSplash && !isHeroAnimated) {
            isHeroAnimated = true
        }
    }

    LaunchedEffect(expandPasswordForm) {
        if (expandPasswordForm) {
            isHeroAnimated = true
            isAuthRevealed = true
            showEmailScreen = true
        }
    }

    val heroProgress by animateFloatAsState(
        targetValue = if (isHeroAnimated) 1f else 0f,
        animationSpec = spring(
            dampingRatio = 0.86f,
            stiffness = Spring.StiffnessMediumLow,
        ),
        label = "heroProgress",
    )

    val authRevealHeightDp = 250.dp
    val density = LocalDensity.current
    val authRevealHeightPx = with(density) { authRevealHeightDp.toPx() }

    val welcomeOffsetYAnimated by animateFloatAsState(
        targetValue = if (isAuthRevealed) -authRevealHeightPx else 0f,
        animationSpec = spring(
            dampingRatio = 0.86f,
            stiffness = Spring.StiffnessMediumLow,
        ),
        label = "welcomeOffsetY",
    )

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background),
    ) {
        val screenHeightPx = constraints.maxHeight.toFloat()

        val emailPageOffsetYAnimated by animateFloatAsState(
            targetValue = if (showEmailScreen) 0f else screenHeightPx,
            animationSpec = spring(
                dampingRatio = 0.86f,
                stiffness = Spring.StiffnessMediumLow,
            ),
            label = "emailPageOffsetY",
        )

        val page1OffsetY = (emailPageOffsetYAnimated - screenHeightPx) + emailDragOffset
        val page2OffsetY = emailPageOffsetYAnimated + emailDragOffset

        // Page 1: Welcome Screen & Auth Buttons
        Box(
            modifier = Modifier
                .fillMaxSize()
                .offset {
                    IntOffset(
                        x = 0,
                        y = page1OffsetY.roundToInt(),
                    )
                },
        ) {
            // Layer 1: Auth Buttons Section (Fixed at bottom of canvas, revealed when welcome card moves up)
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 24.dp)
                    .navigationBarsPadding()
                    .padding(bottom = 16.dp),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    // Primary: Continue with Email (Fully rounded capsule)
                    Button(
                        onClick = {
                            focusManager.clearFocus()
                            showEmailScreen = true
                            emailDragOffset = 0f
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.ink,
                            contentColor = colors.surface,
                        ),
                        shape = CircleShape,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Email,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                "Continue with Email",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 16.sp,
                            )
                        }
                    }

                    // Secondary: Apple & Google side-by-side as liquid glass capsule buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        // Apple button (Black logo only, liquid glass capsule)
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(50.dp)
                                .liquidGlass(CircleShape)
                                .clip(CircleShape)
                                .clickable {
                                    if (showDevLogin) {
                                        scope.launch {
                                            commitApiBase()
                                            auth.signInDev()
                                        }
                                    }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.ic_apple_logo),
                                contentDescription = "Apple",
                                tint = colors.ink,
                                modifier = Modifier.size(22.dp),
                            )
                        }

                        // Google button (Black G logo only, liquid glass capsule)
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(50.dp)
                                .liquidGlass(CircleShape)
                                .clip(CircleShape)
                                .clickable {
                                    scope.launch {
                                        commitApiBase()
                                        try {
                                            val webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
                                            if (webClientId.isBlank()) {
                                                auth.clearError()
                                                return@launch
                                            }
                                            val googleIdOption = GetGoogleIdOption.Builder()
                                                .setFilterByAuthorizedAccounts(false)
                                                .setServerClientId(webClientId)
                                                .build()
                                            val request = GetCredentialRequest.Builder()
                                                .addCredentialOption(googleIdOption)
                                                .build()
                                            val activity = context as Activity
                                            val result = CredentialManager.create(context)
                                                .getCredential(activity, request)
                                            val credential = result.credential
                                            if (credential is CustomCredential &&
                                                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                                            ) {
                                                val google = GoogleIdTokenCredential.createFrom(credential.data)
                                                auth.signInWithGoogle(google.idToken)
                                            }
                                        } catch (_: Exception) {
                                            // Handled in AuthStore
                                        }
                                    }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.ic_google_logo),
                                contentDescription = "Google",
                                tint = colors.ink,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }

                    if (showDevLogin) {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    commitApiBase()
                                    auth.signInDev()
                                }
                            },
                        ) {
                            Text(
                                "Continue with Dev Login",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 14.sp,
                                color = colors.muted,
                            )
                        }
                    }

                    // Fine print: Terms of Use
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            "By continuing, you agree to Inboxies' ",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                        Text(
                            "Terms of Use",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 12.sp,
                            color = colors.accent,
                            textDecoration = TextDecoration.Underline,
                            modifier = Modifier.clickable { showTermsBrowser = true },
                        )
                    }
                }
            }

            // Layer 2: Welcome Container (Moves UP to reveal auth buttons below)
            Surface(
                modifier = Modifier
                    .fillMaxSize()
                    .offset {
                        IntOffset(
                            x = 0,
                            y = (welcomeOffsetYAnimated + welcomeDragOffset).roundToInt(),
                        )
                    }
                    .shadow(
                        elevation = if (isAuthRevealed) 12.dp else 0.dp,
                        shape = RoundedCornerShape(
                            bottomStart = if (isAuthRevealed) 36.dp else 0.dp,
                            bottomEnd = if (isAuthRevealed) 36.dp else 0.dp,
                        ),
                    )
                    .clip(
                        RoundedCornerShape(
                            bottomStart = if (isAuthRevealed) 36.dp else 0.dp,
                            bottomEnd = if (isAuthRevealed) 36.dp else 0.dp,
                        )
                    )
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) {
                        if (isAuthRevealed && !showEmailScreen) {
                            isAuthRevealed = false
                            welcomeDragOffset = 0f
                        }
                    }
                    .pointerInput(isAuthRevealed, showEmailScreen) {
                        if (isAuthRevealed && !showEmailScreen) {
                            detectVerticalDragGestures(
                                onDragEnd = {
                                    if (welcomeDragOffset > 80f) {
                                        isAuthRevealed = false
                                    }
                                    welcomeDragOffset = 0f
                                },
                                onDragCancel = {
                                    welcomeDragOffset = 0f
                                },
                                onVerticalDrag = { _, dragAmount ->
                                    if (dragAmount > 0 || welcomeDragOffset > 0) {
                                        welcomeDragOffset = maxOf(0f, welcomeDragOffset + dragAmount)
                                    }
                                },
                            )
                        }
                    },
                color = colors.surface,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .navigationBarsPadding(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Spacer(Modifier.weight(1f))

                    // App Logo
                    Icon(
                        painter = painterResource(id = R.drawable.ic_inboxies_logo),
                        contentDescription = "Inboxies Logo",
                        tint = colors.ink,
                        modifier = Modifier
                            .size(64.dp)
                            .offset(y = ((1f - heroProgress) * 160).dp)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) {
                                if (BuildConfig.DEBUG) {
                                    devTapCount += 1
                                    if (devTapCount >= 5) {
                                        showDevConfig = !showDevConfig
                                        devTapCount = 0
                                    }
                                }
                            },
                    )

                    // App Name & 3-line Headline
                    Column(
                        modifier = Modifier
                            .alpha(heroProgress)
                            .offset(y = ((1f - heroProgress) * 28).dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            "Inboxies",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            color = colors.ink,
                            modifier = Modifier.padding(top = 14.dp),
                        )

                        Spacer(Modifier.height(8.dp))

                        Text(
                            "Your",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 44.sp,
                            color = colors.ink,
                            lineHeight = 48.sp,
                        )
                        Text(
                            "Personal",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 44.sp,
                            color = colors.ink,
                            lineHeight = 48.sp,
                        )
                        Text(
                            "email app",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 44.sp,
                            lineHeight = 48.sp,
                            style = TextStyle(
                                brush = Brush.horizontalGradient(
                                    listOf(colors.accent, Color(0xFF598CFF))
                                )
                            ),
                        )
                    }

                    // Circular Downward Arrow Button
                    AnimatedVisibility(
                        visible = !isAuthRevealed,
                        enter = scaleIn() + fadeIn(),
                        exit = scaleOut() + fadeOut(),
                    ) {
                        Box(
                            modifier = Modifier
                                .padding(top = 36.dp)
                                .size(54.dp)
                                .shadow(10.dp, CircleShape, spotColor = colors.accent)
                                .clip(CircleShape)
                                .background(
                                    Brush.linearGradient(
                                        listOf(colors.accent, Color(0xFF477BFA))
                                    )
                                )
                                .clickable {
                                    isAuthRevealed = true
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Default.ArrowDownward,
                                contentDescription = "Show sign-in options",
                                tint = Color.White,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                    }

                    Spacer(Modifier.weight(1f))

                    // Drag handle at bottom of welcome card when revealed
                    if (isAuthRevealed) {
                        Box(
                            modifier = Modifier
                                .padding(bottom = 12.dp)
                                .size(width = 36.dp, height = 5.dp)
                                .clip(CircleShape)
                                .background(colors.line)
                        )
                    }
                }
            }
        }

        // Page 2: Email Onboarding Screen (Pushes welcome screen entirely up, follows in lockstep, draggable back down)
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .offset {
                    IntOffset(
                        x = 0,
                        y = page2OffsetY.roundToInt(),
                    )
                }
                .pointerInput(Unit) {
                    detectVerticalDragGestures(
                        onDragEnd = {
                            if (emailDragOffset > 120f) {
                                focusManager.clearFocus()
                                showEmailScreen = false
                            }
                            emailDragOffset = 0f
                        },
                        onDragCancel = {
                            emailDragOffset = 0f
                        },
                        onVerticalDrag = { _, dragAmount ->
                            focusManager.clearFocus()
                            if (dragAmount > 0f || emailDragOffset > 0f) {
                                emailDragOffset = maxOf(0f, emailDragOffset + dragAmount)
                            }
                        },
                    )
                },
            color = colors.surface,
        ) {
            EmailLoginScreen(
                isPresented = showEmailScreen,
                onDismiss = {
                    focusManager.clearFocus()
                    showEmailScreen = false
                    emailDragOffset = 0f
                },
                commitApiBase = ::commitApiBase,
            )
        }

        // Dev Config Dialog / Bar
        if (showDevConfig) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp)
                    .imePadding(),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = colors.surface,
                    shadowElevation = 12.dp,
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("API Base URL (Dev)", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
                            TextButton(onClick = { showDevConfig = false }) {
                                Text("Done", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, color = colors.ink)
                            }
                        }
                        OutlinedTextField(
                            value = apiBase,
                            onValueChange = { apiBase = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                        )
                    }
                }
            }
        }

        // Terms of Use In-App Browser Dialog
        if (showTermsBrowser) {
            InAppBrowserDialog(
                url = "https://inboxies.email/terms",
                title = "Terms of Use",
                onDismiss = { showTermsBrowser = false },
            )
        }
    }
}

/**
 * Two-step email login screen:
 * Step 1: User enters email address, taps Next.
 * Step 2: User enters password, taps Continue to authenticate.
 * Supports interactive drag-down return to the welcome screen.
 */
@Composable
private fun EmailLoginScreen(
    isPresented: Boolean = false,
    onDismiss: () -> Unit,
    commitApiBase: () -> Unit,
) {
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val isBusy by auth.isBusy.collectAsState()
    val error by auth.errorMessage.collectAsState()

    var step by remember { mutableStateOf(EmailStep.Email) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    val emailFocusRequester = remember { FocusRequester() }
    val passwordFocusRequester = remember { FocusRequester() }

    LaunchedEffect(isPresented, step) {
        if (isPresented) {
            kotlinx.coroutines.delay(300)
            if (step == EmailStep.Email) {
                emailFocusRequester.requestFocus()
            } else {
                passwordFocusRequester.requestFocus()
            }
        }
    }

    val isValidEmail = email.trim().contains("@") && email.trim().contains(".") && email.trim().length >= 5

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding(),
    ) {
        // Drag handle pill moved comfortably down below status bar / camera punch-hole
        Box(
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .padding(top = 20.dp)
                .size(width = 36.dp, height = 5.dp)
                .clip(CircleShape)
                .background(colors.line)
        )

        // Header Navigation Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 14.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            if (step == EmailStep.Password) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .liquidGlass(CircleShape)
                        .clip(CircleShape)
                        .clickable { step = EmailStep.Email },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "Back",
                        tint = colors.ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
            } else {
                Spacer(Modifier.size(42.dp))
            }

            // Bigger liquid glass close button
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .liquidGlass(CircleShape)
                    .clip(CircleShape)
                    .clickable(onClick = onDismiss),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Close,
                    contentDescription = "Close",
                    tint = colors.ink,
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Header icon - gray colored, just deeper than pillFill
            Box(
                modifier = Modifier
                    .padding(top = 24.dp)
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(colors.pillFill),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = if (step == EmailStep.Email) Icons.Outlined.Email else Icons.Outlined.Lock,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(24.dp),
                )
            }

            // Title & Subtitle
            Text(
                text = if (step == EmailStep.Email) "Continue with Email" else "Enter your password",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                color = colors.ink,
                modifier = Modifier.padding(top = 16.dp),
            )

            Text(
                text = if (step == EmailStep.Email) {
                    "Sign in or sign up with your email."
                } else {
                    "Sign in with your email ${email.trim()}"
                },
                fontFamily = InterFontFamily,
                fontSize = 14.sp,
                color = colors.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )

            Spacer(Modifier.height(28.dp))

            if (step == EmailStep.Email) {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = { Text("Email Address", fontFamily = InterFontFamily, color = colors.muted) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(emailFocusRequester),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    keyboardActions = KeyboardActions(
                        onNext = {
                            if (isValidEmail) {
                                step = EmailStep.Password
                            }
                        }
                    ),
                    shape = RoundedCornerShape(16.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.accent,
                        unfocusedBorderColor = colors.line,
                        focusedTextColor = colors.ink,
                        unfocusedTextColor = colors.ink,
                        cursorColor = colors.accent,
                    ),
                )

                Spacer(Modifier.height(20.dp))

                Button(
                    onClick = { step = EmailStep.Password },
                    enabled = isValidEmail,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.ink,
                        contentColor = colors.surface,
                        disabledContainerColor = colors.pillActive,
                        disabledContentColor = colors.muted,
                    ),
                    shape = CircleShape,
                ) {
                    Text(
                        "Next",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                    )
                }
            } else {
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = { Text("Password", fontFamily = InterFontFamily, color = colors.muted) },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(passwordFocusRequester),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(
                        onDone = {
                            if (password.isNotBlank() && !isBusy) {
                                scope.launch {
                                    commitApiBase()
                                    auth.signInWithPassword(email.trim(), password)
                                    if (auth.isAuthenticated) {
                                        onDismiss()
                                    }
                                }
                            }
                        }
                    ),
                    shape = RoundedCornerShape(16.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.accent,
                        unfocusedBorderColor = colors.line,
                        focusedTextColor = colors.ink,
                        unfocusedTextColor = colors.ink,
                        cursorColor = colors.accent,
                    ),
                )

                if (error != null) {
                    Text(
                        text = error.orEmpty(),
                        color = colors.unread,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }

                Spacer(Modifier.height(20.dp))

                Button(
                    onClick = {
                        scope.launch {
                            commitApiBase()
                            auth.signInWithPassword(email.trim(), password)
                            if (auth.isAuthenticated) {
                                onDismiss()
                            }
                        }
                    },
                    enabled = password.isNotBlank() && !isBusy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.ink,
                        contentColor = colors.surface,
                        disabledContainerColor = colors.pillActive,
                        disabledContentColor = colors.muted,
                    ),
                    shape = CircleShape,
                ) {
                    if (isBusy) {
                        CircularProgressIndicator(
                            color = colors.surface,
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(
                            "Sign In",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
                        )
                    }
                }
            }

            Spacer(Modifier.height(48.dp))
        }
    }
}

private enum class EmailStep {
    Email,
    Password,
}

/**
 * In-app WebView dialog to open terms link cleanly.
 */
@Composable
private fun InAppBrowserDialog(
    url: String,
    title: String,
    onDismiss: () -> Unit,
) {
    val colors = inboxiesColors()

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = colors.background,
        ) {
            Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = title,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )

                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(colors.pillFill),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Close,
                            contentDescription = "Close",
                            tint = colors.ink,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }

                // WebView
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            webViewClient = WebViewClient()
                            settings.javaScriptEnabled = true
                            loadUrl(url)
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}
