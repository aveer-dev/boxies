package co.inboxies.app.ui.auth

import android.app.Activity
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
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

enum class AuthSubscreen {
    None,
    Email,
    Onboarding,
}

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
    expandForgotPassword: Boolean = false,
    showAuthOptionsInitial: Boolean = false,
) {
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val view = LocalView.current
    val isSystemDark = isSystemInDarkTheme()
    val isDark = isSystemDark || colors.surface.luminance() < 0.5f
    val isBusy by auth.isBusy.collectAsState()
    val error by auth.errorMessage.collectAsState()
    val focusManager = LocalFocusManager.current

    var isHeroAnimated by remember { mutableStateOf(expandPasswordForm || expandForgotPassword || showAuthOptionsInitial) }
    var isAuthRevealed by remember { mutableStateOf(expandPasswordForm || expandForgotPassword || showAuthOptionsInitial) }
    var activeSubscreen by remember {
        mutableStateOf(if (expandPasswordForm || expandForgotPassword) AuthSubscreen.Email else AuthSubscreen.None)
    }
    var showTermsBrowser by remember { mutableStateOf(false) }

    LaunchedEffect(auth.isAuthenticated) {
        if (auth.isAuthenticated) {
            activeSubscreen = AuthSubscreen.None
        }
    }

    var welcomeDragOffset by remember { mutableFloatStateOf(0f) }
    var emailDragOffset by remember { mutableFloatStateOf(0f) }
    var onboardingDragOffset by remember { mutableFloatStateOf(0f) }
    var emailRefocusTrigger by remember { mutableIntStateOf(0) }
    var isEmailAtRoot by remember { mutableStateOf(true) }
    var isOnboardingAtRoot by remember { mutableStateOf(true) }
    var emailPastThreshold by remember { mutableStateOf(false) }
    var onboardingPastThreshold by remember { mutableStateOf(false) }

    var apiBase by remember {
        mutableStateOf(
            if (AppConfig.apiBaseURL.contains("localhost") || AppConfig.apiBaseURL.contains("127.0.0.1") || AppConfig.apiBaseURL.contains("10.0.2.2")) {
                BuildConfig.DEFAULT_API_BASE
            } else {
                AppConfig.apiBaseURL
            }
        )
    }
    val showDevLogin = BuildConfig.DEBUG && AppConfig.isLocalDevelopmentAPI
    var showDevConfig by remember {
        mutableStateOf(
            (context as? Activity)?.intent?.getBooleanExtra("showApiBase", false) == true
        )
    }
    var devTapCount by remember { mutableStateOf(0) }

    fun commitApiBase() {
        val trimmed = apiBase.trim()
        if (trimmed.isEmpty() || trimmed.contains("localhost") || trimmed.contains("127.0.0.1") || trimmed.contains("10.0.2.2")) {
            apiBase = BuildConfig.DEFAULT_API_BASE
            AppConfig.apiBaseURL = BuildConfig.DEFAULT_API_BASE
            return
        }
        val parsed = AppConfig.parseAPIBaseURL(trimmed)
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
            activeSubscreen = AuthSubscreen.Email
        }
    }

    LaunchedEffect(error) {
        if (error != null) {
            kotlinx.coroutines.delay(3500)
            auth.clearError()
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

    val authRevealHeightDp = 300.dp
    val density = LocalDensity.current
    val authRevealHeightPx = with(density) { authRevealHeightDp.toPx() }

    val welcomeOffsetYAnimated by animateFloatAsState(
        targetValue = if (isAuthRevealed) -authRevealHeightPx else 0f,
        animationSpec = if (isAuthRevealed) {
            spring(
                dampingRatio = 0.50f,
                stiffness = Spring.StiffnessMediumLow,
            )
        } else {
            spring(
                dampingRatio = 0.86f,
                stiffness = Spring.StiffnessMediumLow,
            )
        },
        label = "welcomeOffsetY",
    )

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background),
    ) {
        val screenHeightPx = constraints.maxHeight.toFloat()

        val emailPageOffsetYAnimated by animateFloatAsState(
            targetValue = if (activeSubscreen == AuthSubscreen.Email) 0f else screenHeightPx,
            animationSpec = tween(
                durationMillis = 320,
                easing = FastOutSlowInEasing,
            ),
            label = "emailPageOffsetY",
        )

        val onboardingPageOffsetYAnimated by animateFloatAsState(
            targetValue = if (activeSubscreen == AuthSubscreen.Onboarding) 0f else screenHeightPx,
            animationSpec = tween(
                durationMillis = 320,
                easing = FastOutSlowInEasing,
            ),
            label = "onboardingPageOffsetY",
        )

        val activeDragOffset = when (activeSubscreen) {
            AuthSubscreen.Email -> emailDragOffset
            AuthSubscreen.Onboarding -> onboardingDragOffset
            AuthSubscreen.None -> 0f
        }
        val targetPage1OffsetY = when (activeSubscreen) {
            AuthSubscreen.Email -> emailPageOffsetYAnimated - screenHeightPx
            AuthSubscreen.Onboarding -> onboardingPageOffsetYAnimated - screenHeightPx
            AuthSubscreen.None -> 0f
        }
        val page1OffsetY = targetPage1OffsetY + activeDragOffset
        val page2OffsetY = emailPageOffsetYAnimated + emailDragOffset
        val page3OffsetY = onboardingPageOffsetYAnimated + onboardingDragOffset

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
                    // Primary: Get started button (Capsule)
                    Button(
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            commitApiBase()
                            focusManager.clearFocus()
                            activeSubscreen = AuthSubscreen.Onboarding
                            onboardingDragOffset = 0f
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
                        Text(
                            "Get started",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
                        )
                    }

                    // Divider: or text
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        HorizontalDivider(
                            modifier = Modifier.weight(1f),
                            color = colors.line.copy(alpha = 0.65f),
                            thickness = 0.5.dp,
                        )
                        Text(
                            "or",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                            color = colors.muted,
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                        HorizontalDivider(
                            modifier = Modifier.weight(1f),
                            color = colors.line.copy(alpha = 0.65f),
                            thickness = 0.5.dp,
                        )
                    }
                    // Continue with Email (Liquid glass capsule)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                            .liquidGlass(CircleShape)
                            .clip(CircleShape)
                            .clickable {
                                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                                focusManager.clearFocus()
                                activeSubscreen = AuthSubscreen.Email
                                emailDragOffset = 0f
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Continue with Email",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp,
                            color = colors.ink,
                        )
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
                        elevation = if (isAuthRevealed) (if (isDark) 16.dp else 10.dp) else 0.dp,
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
                    .then(
                        if (isAuthRevealed) {
                            Modifier.border(
                                width = 0.5.dp,
                                color = if (isDark) Color.White.copy(alpha = 0.14f) else colors.line.copy(alpha = 0.6f),
                                shape = RoundedCornerShape(bottomStart = 36.dp, bottomEnd = 36.dp),
                            )
                        } else Modifier
                    )
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) {
                        if (isAuthRevealed && activeSubscreen == AuthSubscreen.None) {
                            isAuthRevealed = false
                            welcomeDragOffset = 0f
                        }
                    }
                    .pointerInput(isAuthRevealed, activeSubscreen) {
                        if (isAuthRevealed && activeSubscreen == AuthSubscreen.None) {
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
                color = if (isAuthRevealed && isDark) Color(0xFF222226) else colors.surface,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .navigationBarsPadding(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val topWeight = if (isAuthRevealed) 3.6f else 2.6f
                    Spacer(Modifier.weight(topWeight))

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
                        exit = scaleOut(
                            animationSpec = spring(
                                dampingRatio = 0.50f,
                                stiffness = Spring.StiffnessMediumLow,
                            )
                        ) + fadeOut(),
                    ) {
                        val arrowInteractionSource = remember { MutableInteractionSource() }
                        val isArrowPressed by arrowInteractionSource.collectIsPressedAsState()
                        val arrowScale by animateFloatAsState(
                            targetValue = if (isArrowPressed) 0.86f else 1.0f,
                            animationSpec = spring(dampingRatio = 0.48f, stiffness = 500f),
                            label = "arrowScale",
                        )

                        Box(
                            modifier = Modifier
                                .padding(top = 36.dp)
                                .size(54.dp)
                                .graphicsLayer {
                                    scaleX = arrowScale
                                    scaleY = arrowScale
                                }
                                .shadow(10.dp, CircleShape, spotColor = colors.accent)
                                .clip(CircleShape)
                                .background(
                                    Brush.linearGradient(
                                        listOf(colors.accent, Color(0xFF477BFA))
                                    )
                                )
                                .clickable(
                                    interactionSource = arrowInteractionSource,
                                    indication = null,
                                ) {
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

        val dismissThresholdPx = with(LocalDensity.current) { 85.dp.toPx() }
        val resistanceFactor = 0.85f

        fun updateEmailOffset(delta: Float) {
            val newOffset = maxOf(0f, emailDragOffset + delta)
            emailDragOffset = newOffset
            val isPast = newOffset >= dismissThresholdPx
            if (isPast != emailPastThreshold) {
                emailPastThreshold = isPast
                view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            }
        }

        fun finishEmailDrag(velocity: Float = 0f) {
            val flicked = velocity > 1200f
            if (emailDragOffset >= dismissThresholdPx || flicked) {
                focusManager.clearFocus()
                auth.clearError()
                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                activeSubscreen = AuthSubscreen.None
                emailDragOffset = 0f
                emailPastThreshold = false
            } else {
                if (emailDragOffset > 0f) {
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                }
                emailPastThreshold = false
                scope.launch {
                    Animatable(emailDragOffset).animateTo(
                        targetValue = 0f,
                        animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                    ) {
                        emailDragOffset = value
                    }
                }
                emailRefocusTrigger++
            }
        }

        val emailNestedScrollConnection = remember(isEmailAtRoot) {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (!isEmailAtRoot) return Offset.Zero
                    if (available.y < 0f && emailDragOffset > 0f) {
                        val dragDelta = available.y * resistanceFactor
                        val prev = emailDragOffset
                        updateEmailOffset(dragDelta)
                        val consumedY = (emailDragOffset - prev) / resistanceFactor
                        return Offset(0f, consumedY)
                    }
                    return Offset.Zero
                }

                override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                    if (!isEmailAtRoot) return Offset.Zero
                    if (available.y > 0f) {
                        if (emailDragOffset == 0f) {
                            focusManager.clearFocus()
                        }
                        updateEmailOffset(available.y * resistanceFactor)
                        return Offset(0f, available.y)
                    }
                    return Offset.Zero
                }

                override suspend fun onPreFling(available: Velocity): Velocity {
                    if (!isEmailAtRoot || emailDragOffset == 0f) return Velocity.Zero
                    finishEmailDrag(available.y)
                    return Velocity(0f, available.y)
                }

                override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                    if (!isEmailAtRoot || emailDragOffset == 0f) return Velocity.Zero
                    finishEmailDrag(available.y)
                    return Velocity(0f, available.y)
                }
            }
        }

        fun updateOnboardingOffset(delta: Float) {
            val newOffset = maxOf(0f, onboardingDragOffset + delta)
            onboardingDragOffset = newOffset
            val isPast = newOffset >= dismissThresholdPx
            if (isPast != onboardingPastThreshold) {
                onboardingPastThreshold = isPast
                view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            }
        }

        fun finishOnboardingDrag(velocity: Float = 0f) {
            val flicked = velocity > 1200f
            if (onboardingDragOffset >= dismissThresholdPx || flicked) {
                focusManager.clearFocus()
                auth.clearError()
                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                activeSubscreen = AuthSubscreen.None
                onboardingDragOffset = 0f
                onboardingPastThreshold = false
            } else {
                if (onboardingDragOffset > 0f) {
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                }
                onboardingPastThreshold = false
                scope.launch {
                    Animatable(onboardingDragOffset).animateTo(
                        targetValue = 0f,
                        animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                    ) {
                        onboardingDragOffset = value
                    }
                }
            }
        }

        val onboardingNestedScrollConnection = remember(isOnboardingAtRoot) {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (!isOnboardingAtRoot) return Offset.Zero
                    if (available.y < 0f && onboardingDragOffset > 0f) {
                        val dragDelta = available.y * resistanceFactor
                        val prev = onboardingDragOffset
                        updateOnboardingOffset(dragDelta)
                        val consumedY = (onboardingDragOffset - prev) / resistanceFactor
                        return Offset(0f, consumedY)
                    }
                    return Offset.Zero
                }

                override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                    if (!isOnboardingAtRoot) return Offset.Zero
                    if (available.y > 0f) {
                        if (onboardingDragOffset == 0f) {
                            focusManager.clearFocus()
                        }
                        updateOnboardingOffset(available.y * resistanceFactor)
                        return Offset(0f, available.y)
                    }
                    return Offset.Zero
                }

                override suspend fun onPreFling(available: Velocity): Velocity {
                    if (!isOnboardingAtRoot || onboardingDragOffset == 0f) return Velocity.Zero
                    finishOnboardingDrag(available.y)
                    return Velocity(0f, available.y)
                }

                override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
                    if (!isOnboardingAtRoot || onboardingDragOffset == 0f) return Velocity.Zero
                    finishOnboardingDrag(available.y)
                    return Velocity(0f, available.y)
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
                .nestedScroll(emailNestedScrollConnection)
                .pointerInput(isEmailAtRoot) {
                    if (isEmailAtRoot) {
                        detectVerticalDragGestures(
                            onDragStart = {
                                if (emailDragOffset == 0f) {
                                    focusManager.clearFocus()
                                }
                            },
                            onDragEnd = {
                                finishEmailDrag()
                            },
                            onDragCancel = {
                                finishEmailDrag()
                            },
                            onVerticalDrag = { _, dragAmount ->
                                if (dragAmount > 0f || emailDragOffset > 0f) {
                                    updateEmailOffset(dragAmount * resistanceFactor)
                                }
                            },
                        )
                    }
                },
            color = colors.surface,
        ) {
            EmailLoginScreen(
                isPresented = activeSubscreen == AuthSubscreen.Email,
                refocusTrigger = emailRefocusTrigger,
                onRootChanged = { isEmailAtRoot = it },
                onDismiss = {
                    focusManager.clearFocus()
                    auth.clearError()
                    activeSubscreen = AuthSubscreen.None
                    emailDragOffset = 0f
                },
                commitApiBase = ::commitApiBase,
            )
        }

        // Page 3: Get Started Onboarding Screen (Pushes welcome screen entirely up, follows in lockstep, draggable back down only from root)
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .offset {
                    IntOffset(
                        x = 0,
                        y = page3OffsetY.roundToInt(),
                    )
                }
                .nestedScroll(onboardingNestedScrollConnection)
                .pointerInput(isOnboardingAtRoot) {
                    if (isOnboardingAtRoot) {
                        detectVerticalDragGestures(
                            onDragStart = {
                                if (onboardingDragOffset == 0f) {
                                    focusManager.clearFocus()
                                }
                            },
                            onDragEnd = {
                                finishOnboardingDrag()
                            },
                            onDragCancel = {
                                finishOnboardingDrag()
                            },
                            onVerticalDrag = { _, dragAmount ->
                                if (dragAmount > 0f || onboardingDragOffset > 0f) {
                                    updateOnboardingOffset(dragAmount * resistanceFactor)
                                }
                            },
                        )
                    }
                },
            color = colors.surface,
        ) {
            MailboxOnboardingView(
                initialTrack = OnboardingTrack.Select,
                onDismiss = {
                    focusManager.clearFocus()
                    auth.clearError()
                    activeSubscreen = AuthSubscreen.None
                    onboardingDragOffset = 0f
                },
                showsDragHandle = true,
                onRootChanged = { isOnboardingAtRoot = it },
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

        // Error Toast
        AnimatedVisibility(
            visible = error != null,
            enter = slideInVertically(
                animationSpec = spring(
                    dampingRatio = 0.86f,
                    stiffness = Spring.StiffnessMediumLow,
                )
            ) { it } + fadeIn(),
            exit = slideOutVertically(
                animationSpec = spring(
                    dampingRatio = 0.86f,
                    stiffness = Spring.StiffnessMediumLow,
                )
            ) { it } + fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .imePadding()
                .padding(bottom = 24.dp)
                .padding(horizontal = 24.dp),
        ) {
            error?.let { msg ->
                AuthToastBanner(
                    message = msg,
                    onDismiss = { auth.clearError() },
                )
            }
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
    refocusTrigger: Int = 0,
    onRootChanged: (Boolean) -> Unit = {},
    onDismiss: () -> Unit,
    commitApiBase: () -> Unit,
) {
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val isBusy by auth.isBusy.collectAsState()
    val context = LocalContext.current
    val view = LocalView.current

    val initialStep = remember {
        if (BuildConfig.DEBUG && (context as? Activity)?.intent?.extras?.containsKey("previewPasswordSignIn") == true) {
            EmailStep.Password
        } else if (BuildConfig.DEBUG && (context as? Activity)?.intent?.extras?.containsKey("previewForgotPassword") == true) {
            EmailStep.ForgotPassword
        } else {
            EmailStep.Email
        }
    }
    val backStack = remember(initialStep) {
        mutableStateListOf<EmailStep>().apply {
            add(EmailStep.Email)
            if (initialStep != EmailStep.Email) {
                add(initialStep)
            }
        }
    }
    val currentStep = backStack.lastOrNull() ?: EmailStep.Email
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var resetCode by remember { mutableStateOf("") }
    var isPasswordVisible by remember { mutableStateOf(false) }
    var isResetPasswordVisible by remember { mutableStateOf(false) }
    var isSendingReset by remember { mutableStateOf(false) }
    var isResetting by remember { mutableStateOf(false) }

    fun navigateTo(newStep: EmailStep) {
        auth.clearError()
        backStack.add(newStep)
    }

    fun navigateBack() {
        view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
        auth.clearError()
        if (backStack.size > 1) {
            backStack.removeAt(backStack.lastIndex)
        } else {
            onDismiss()
        }
    }

    LaunchedEffect(backStack.size) {
        onRootChanged(backStack.size == 1)
    }

    val emailFocusRequester = remember { FocusRequester() }
    val passwordFocusRequester = remember { FocusRequester() }
    val forgotEmailFocusRequester = remember { FocusRequester() }
    val resetCodeFocusRequester = remember { FocusRequester() }

    LaunchedEffect(isPresented, currentStep, refocusTrigger) {
        if (isPresented) {
            val delayMs = if (refocusTrigger > 0) 120L else 420L
            kotlinx.coroutines.delay(delayMs)
            when (currentStep) {
                EmailStep.Email -> emailFocusRequester.requestFocus()
                EmailStep.Password -> passwordFocusRequester.requestFocus()
                EmailStep.ForgotPassword -> forgotEmailFocusRequester.requestFocus()
                EmailStep.ResetPassword -> resetCodeFocusRequester.requestFocus()
            }
        }
    }

    BackHandler(enabled = isPresented && backStack.size > 1) {
        navigateBack()
    }
    BackHandler(enabled = isPresented && backStack.size <= 1) {
        onDismiss()
    }

    val isValidEmail = email.trim().contains("@") && email.trim().contains(".") && email.trim().length >= 5

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding(),
    ) {
        AnimatedContent(
            targetState = currentStep,
            modifier = Modifier.fillMaxSize(),
            transitionSpec = {
                val forward = targetState.ordinal >= initialState.ordinal
                val navSpring = spring<IntOffset>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
                val fadeSpring = spring<Float>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
                (
                    slideInHorizontally(animationSpec = navSpring) { full ->
                        if (forward) full / 3 else -full / 3
                    } + fadeIn(animationSpec = fadeSpring)
                ) togetherWith (
                    slideOutHorizontally(animationSpec = navSpring) { full ->
                        if (forward) -full / 4 else full / 4
                    } + fadeOut(animationSpec = fadeSpring)
                )
            },
            label = "emailStepNav",
        ) { step ->
            Column(
                modifier = Modifier.fillMaxSize(),
            ) {
                if (step == EmailStep.Email) {
                    // Drag handle pill moved comfortably down below status bar / camera punch-hole (initial screen only)
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp)
                            .height(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(width = 36.dp, height = 5.dp)
                                .clip(CircleShape)
                                .background(colors.line),
                        )
                    }

                    // Header Navigation Bar for initial screen: right side close button only (goes back to welcome screen)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                            .padding(top = 14.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Spacer(Modifier.size(42.dp))

                        // Bigger liquid glass close button
                        Box(
                            modifier = Modifier
                                .size(42.dp)
                                .liquidGlass(CircleShape)
                                .clip(CircleShape)
                                .clickable {
                                    view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                                    onDismiss()
                                },
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
                } else {
                    // Subsequent step toolbar: left side back button only
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                            .padding(top = 14.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(42.dp)
                                .liquidGlass(CircleShape)
                                .clip(CircleShape)
                                .clickable {
                                    navigateBack()
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                                contentDescription = "Back",
                                tint = colors.ink,
                                modifier = Modifier.size(18.dp),
                            )
                        }

                        Spacer(Modifier.size(42.dp))
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
                            .padding(top = if (step == EmailStep.Email) 12.dp else 16.dp)
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(colors.pillFill),
                        contentAlignment = Alignment.Center,
                    ) {
                Icon(
                    imageVector = when (step) {
                        EmailStep.Email, EmailStep.ForgotPassword -> Icons.Outlined.Email
                        EmailStep.Password, EmailStep.ResetPassword -> Icons.Outlined.Lock
                    },
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(24.dp),
                )
            }

            // Title & Subtitle
            Text(
                text = when (step) {
                    EmailStep.Email -> "Continue with Email"
                    EmailStep.Password -> "Enter your password"
                    EmailStep.ForgotPassword -> "Forgot password?"
                    EmailStep.ResetPassword -> "Reset your password"
                },
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                color = colors.ink,
                modifier = Modifier.padding(top = 16.dp),
            )

            Text(
                text = when (step) {
                    EmailStep.Email -> "Sign in or sign up with your email."
                    EmailStep.Password -> "Sign in with your email ${email.trim()}"
                    EmailStep.ForgotPassword -> "Enter your email to receive a 6-digit reset code."
                    EmailStep.ResetPassword -> "Enter the code sent to ${email.trim()}"
                },
                fontFamily = InterFontFamily,
                fontSize = 14.sp,
                color = colors.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )

            Spacer(Modifier.height(28.dp))

            when (step) {
                EmailStep.Email -> {
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
                                    navigateTo(EmailStep.Password)
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

                    // Button for forgot password should be below the email input, then some extra space below it before the next button
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        Text(
                            text = "Forgot password?",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                            color = colors.accent,
                            modifier = Modifier
                                .clickable {
                                    navigateTo(EmailStep.ForgotPassword)
                                }
                                .padding(vertical = 4.dp, horizontal = 2.dp),
                        )
                    }

                    Spacer(Modifier.height(16.dp))

                    Button(
                        onClick = { navigateTo(EmailStep.Password) },
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
                }

                EmailStep.Password -> {
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = { Text("Password", fontFamily = InterFontFamily, color = colors.muted) },
                        visualTransformation = if (isPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { isPasswordVisible = !isPasswordVisible }) {
                                Icon(
                                    imageVector = if (isPasswordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                    contentDescription = if (isPasswordVisible) "Hide password" else "Show password",
                                    tint = colors.muted,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        },
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

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 10.dp),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        Text(
                            text = "Forgot password?",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                            color = colors.accent,
                            modifier = Modifier
                                .clickable {
                                    navigateTo(EmailStep.ForgotPassword)
                                }
                                .padding(vertical = 4.dp, horizontal = 2.dp),
                        )
                    }

                    Spacer(Modifier.height(16.dp))

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

                EmailStep.ForgotPassword -> {
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        placeholder = { Text("Email Address", fontFamily = InterFontFamily, color = colors.muted) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(forgotEmailFocusRequester),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                if (isValidEmail && !isSendingReset) {
                                    scope.launch {
                                        commitApiBase()
                                        isSendingReset = true
                                        try {
                                            val res = auth.forgotPassword(email.trim())
                                            if (BuildConfig.DEBUG && res.devResetCode != null) {
                                                resetCode = res.devResetCode
                                            }
                                            navigateTo(EmailStep.ResetPassword)
                                        } catch (_: Exception) {
                                        } finally {
                                            isSendingReset = false
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

                    Spacer(Modifier.height(20.dp))

                    Button(
                        onClick = {
                            scope.launch {
                                commitApiBase()
                                isSendingReset = true
                                try {
                                    val res = auth.forgotPassword(email.trim())
                                    if (BuildConfig.DEBUG && res.devResetCode != null) {
                                        resetCode = res.devResetCode
                                    }
                                    navigateTo(EmailStep.ResetPassword)
                                } catch (_: Exception) {
                                } finally {
                                    isSendingReset = false
                                }
                            }
                        },
                        enabled = isValidEmail && !isSendingReset,
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
                        if (isSendingReset) {
                            CircularProgressIndicator(
                                color = colors.surface,
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                "Send Reset Code",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 16.sp,
                            )
                        }
                    }
                }

                EmailStep.ResetPassword -> {
                    OutlinedTextField(
                        value = resetCode,
                        onValueChange = { if (it.length <= 6) resetCode = it },
                        placeholder = { Text("6-digit code", fontFamily = InterFontFamily, color = colors.muted) },
                        textStyle = TextStyle(
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            textAlign = TextAlign.Center,
                            color = colors.ink,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(resetCodeFocusRequester),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Next,
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

                    Spacer(Modifier.height(14.dp))

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = { Text("New password (min 10 chars)", fontFamily = InterFontFamily, color = colors.muted) },
                        visualTransformation = if (isResetPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { isResetPasswordVisible = !isResetPasswordVisible }) {
                                Icon(
                                    imageVector = if (isResetPasswordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                    contentDescription = if (isResetPasswordVisible) "Hide password" else "Show password",
                                    tint = colors.muted,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                if (resetCode.length >= 6 && password.length >= 10 && !isResetting) {
                                    scope.launch {
                                        commitApiBase()
                                        isResetting = true
                                        try {
                                            auth.resetPassword(code = resetCode.trim(), newPassword = password)
                                            if (auth.isAuthenticated) {
                                                onDismiss()
                                            }
                                        } catch (_: Exception) {
                                        } finally {
                                            isResetting = false
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

                    if (password.isNotEmpty() && password.length < 10) {
                        Text(
                            text = "${10 - password.length} more characters needed",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 4.dp, start = 8.dp),
                        )
                    }

                    Spacer(Modifier.height(20.dp))

                    Button(
                        onClick = {
                            scope.launch {
                                commitApiBase()
                                isResetting = true
                                try {
                                    auth.resetPassword(code = resetCode.trim(), newPassword = password)
                                    if (auth.isAuthenticated) {
                                        onDismiss()
                                    }
                                } catch (_: Exception) {
                                } finally {
                                    isResetting = false
                                }
                            }
                        },
                        enabled = resetCode.length >= 6 && password.length >= 10 && !isResetting,
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
                        if (isResetting) {
                            CircularProgressIndicator(
                                color = colors.surface,
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                "Reset and Sign In",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 16.sp,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(48.dp))
        }
    }
}
}
}

private enum class EmailStep {
    Email,
    Password,
    ForgotPassword,
    ResetPassword,
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
    val view = LocalView.current

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
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            onDismiss()
                        },
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

@Composable
private fun AuthToastBanner(
    message: String,
    onDismiss: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    Row(
        modifier = modifier
            .shadow(12.dp, RoundedCornerShape(50))
            .clip(RoundedCornerShape(50))
            .background(colors.surface)
            .border(0.5.dp, colors.line.copy(alpha = 0.6f), RoundedCornerShape(50))
            .clickable(onClick = onDismiss)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Outlined.Error,
            contentDescription = null,
            tint = colors.deepDarkRed,
            modifier = Modifier.size(16.dp),
        )
        Text(
            text = message,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = colors.ink,
            maxLines = 2,
        )
    }
}

