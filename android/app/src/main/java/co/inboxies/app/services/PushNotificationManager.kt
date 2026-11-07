package co.inboxies.app.services

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import co.inboxies.app.BuildConfig
import co.inboxies.app.R
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * FCM registration coordinator. No-ops when Firebase / google-services.json
 * is not configured (`BuildConfig.HAS_GOOGLE_SERVICES == false`).
 *
 * Policy: the device token is registered for **every** mailbox the signed-in user has
 * while notifications are on (preference + OS permission), and unregistered from all of
 * them when the user turns notifications off or signs out. [registerMailboxes] is called
 * on each mailbox load, so it only POSTs mailboxes not yet registered in this process.
 * The mailbox list is also persisted so the FCM service (which can run without the UI)
 * only shows pushes for mailboxes the user still has.
 */
/**
 * Whether the FCM service may show a push for a mailbox, given the persisted list of the
 * signed-in user's mailboxes: never written (null, first launch after an update) allows
 * everything; present but empty (signed out) drops everything; otherwise the mailbox
 * must be listed. A push without a mailbox id is only shown while someone is signed in.
 */
internal object PushMailboxFilter {
    fun allows(storedMailboxIds: Set<String>?, mailboxId: String?): Boolean {
        if (storedMailboxIds == null) return true
        if (storedMailboxIds.isEmpty()) return false
        if (mailboxId.isNullOrBlank()) return true
        return storedMailboxIds.any { it.equals(mailboxId, ignoreCase = true) }
    }
}

data class PushDeepLink(
    val mailboxId: String,
    val emailId: String,
    val folderId: String = "inbox",
)

/**
 * A "Today's inbox" widget tap outside the cards (AVE-150): open this mailbox's Inbox.
 * [nonce] makes a second tap on the same mailbox a new request.
 */
data class PendingInboxLink(val mailboxId: String?, val nonce: Long = System.nanoTime())

class PushNotificationManager private constructor(private val appContext: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefs get() = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    /** Persisted so sign-out / account deletion can unregister after a cold start. */
    @Volatile
    private var deviceToken: String? = prefs.getString(KEY_DEVICE_TOKEN, null)
    /** Mailboxes [deviceToken] was registered for in this process. */
    private val registeredMailboxIds = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val _pendingDeepLink = MutableStateFlow<PushDeepLink?>(null)
    val pendingDeepLink: StateFlow<PushDeepLink?> = _pendingDeepLink.asStateFlow()
    /** Set by a widget tap outside the cards; consumed like [pendingDeepLink]. */
    private val _pendingInboxLink = MutableStateFlow<PendingInboxLink?>(null)
    val pendingInboxLink: StateFlow<PendingInboxLink?> = _pendingInboxLink.asStateFlow()

    /**
     * The signed-in user's mailboxes, persisted for the FCM service. Null = never written
     * (first launch after an update); empty = signed out (see [PushMailboxFilter]).
     */
    private val storedMailboxIds: Set<String>?
        get() = if (prefs.contains(KEY_KNOWN_MAILBOXES)) {
            prefs.getStringSet(KEY_KNOWN_MAILBOXES, emptySet()).orEmpty()
        } else {
            null
        }

    private val knownMailboxIds: Set<String>
        get() = storedMailboxIds.orEmpty()

    /**
     * Remember the user's mailboxes and, when notifications are on, register the device
     * token for any of them not registered yet in this process.
     */
    fun registerMailboxes(mailboxIds: Collection<String>) {
        val ids = mailboxIds.filter { it.isNotBlank() }.toSet()
        if (ids.isEmpty()) return
        if (ids != knownMailboxIds) prefs.edit { putStringSet(KEY_KNOWN_MAILBOXES, ids) }
        registerKnownMailboxes()
    }

    /** (Re)register the token for every known mailbox when notifications are on. */
    fun registerKnownMailboxes() {
        if (!BuildConfig.HAS_GOOGLE_SERVICES || !isEffectivelyEnabled()) return
        val token = deviceToken
        if (token != null) {
            knownMailboxIds.filterNot { it in registeredMailboxIds }.forEach { syncTokenWithServer(it, token) }
        }
        // Refresh the token too; a new one lands in handleTokenReceived.
        fetchToken()
    }

    fun isNotificationsEnabled(): Boolean = prefs.getBoolean(KEY_PUSH_ENABLED, true)

    /** What Settings should show: the user's preference *and* the OS permission. */
    fun isEffectivelyEnabled(): Boolean = isNotificationsEnabled() && hasNotificationPermission()

    fun setNotificationsEnabled(enabled: Boolean) {
        prefs.edit { putBoolean(KEY_PUSH_ENABLED, enabled) }
    }

    /** Settings toggle on: register for all of the user's mailboxes. */
    fun enableNotifications() {
        setNotificationsEnabled(true)
        registerKnownMailboxes()
    }

    /**
     * Settings toggle off: unregister this device from every mailbox (not just the
     * selected one), so no mailbox keeps pushing to it.
     */
    suspend fun disableNotifications(mailboxIds: Collection<String>) {
        setNotificationsEnabled(false)
        unregisterFrom(mailboxIds + knownMailboxIds)
    }

    /**
     * Ask once after sign-in (POST_NOTIFICATIONS is a runtime permission on API 33+).
     * After a denial, Settings → Notifications is the only re-entry point.
     */
    fun shouldPromptForPermission(): Boolean =
        BuildConfig.HAS_GOOGLE_SERVICES &&
            isNotificationsEnabled() &&
            !hasNotificationPermission() &&
            !prefs.getBoolean(KEY_PERMISSION_PROMPTED, false)

    fun markPermissionPrompted() {
        prefs.edit { putBoolean(KEY_PERMISSION_PROMPTED, true) }
    }

    fun onPermissionResult(granted: Boolean) {
        setNotificationsEnabled(granted)
        if (granted) registerKnownMailboxes()
    }

    fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** True when a push for [mailboxId] belongs to a mailbox the signed-in user still has. */
    fun isKnownMailbox(mailboxId: String?): Boolean = PushMailboxFilter.allows(storedMailboxIds, mailboxId)

    fun handleTokenReceived(token: String) {
        if (token != deviceToken) {
            // Registrations were for the old token; the server prunes it on its next 404.
            registeredMailboxIds.clear()
        }
        deviceToken = token
        prefs.edit { putString(KEY_DEVICE_TOKEN, token) }
        // FCM rotates tokens on its own; never re-register while the user has push off.
        if (!BuildConfig.HAS_GOOGLE_SERVICES || !isEffectivelyEnabled()) return
        knownMailboxIds.filterNot { it in registeredMailboxIds }.forEach { syncTokenWithServer(it, token) }
    }

    /**
     * Drop this device's token from every mailbox before the session token goes away
     * (sign-out / account deletion). Must run while the Bearer token is still valid.
     */
    suspend fun unregisterAll(mailboxIds: Collection<String>) {
        val targets = mailboxIds + knownMailboxIds + registeredMailboxIds
        // First: if the DELETEs fail (offline) or time out mid-loop, the server may keep
        // pushing to this device, and the FCM service must already drop all of it.
        forgetMailboxes()
        unregisterFrom(targets)
    }

    /**
     * Signed out: store an *empty* set (not remove the key, which reads as "never
     * written" and lets pushes through), so the FCM service drops every push until the
     * next user's mailboxes are recorded.
     */
    fun forgetMailboxes() {
        registeredMailboxIds.clear()
        prefs.edit(commit = true) { putStringSet(KEY_KNOWN_MAILBOXES, emptySet()) }
    }

    private suspend fun unregisterFrom(mailboxIds: Collection<String>) {
        val token = deviceToken
        val targets = (mailboxIds + registeredMailboxIds).toSet()
        registeredMailboxIds.clear()
        if (token == null) return
        for (id in targets) {
            runCatching { ApiClient.shared.unregisterDeviceToken(id, token) }
        }
    }

    private fun fetchToken() {
        // Only reached with google-services.json (FirebaseApp initialised); stay silent
        // if Firebase isn't usable on this device (e.g. no Play services).
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (token != null) handleTokenReceived(token)
            }
        } catch (_: Exception) {
        }
    }

    private fun syncTokenWithServer(mailboxId: String, token: String) {
        // Claim it up front so overlapping calls don't double-POST; release on failure.
        if (!registeredMailboxIds.add(mailboxId)) return
        scope.launch {
            runCatching { ApiClient.shared.registerDeviceToken(mailboxId, token) }
                .onFailure { registeredMailboxIds.remove(mailboxId) }
        }
    }

    fun setPendingDeepLink(mailboxId: String?, emailId: String?, folderId: String?) {
        val mb = mailboxId?.takeIf { it.isNotBlank() } ?: return
        val em = emailId?.takeIf { it.isNotBlank() } ?: return
        _pendingDeepLink.value = PushDeepLink(
            mailboxId = mb,
            emailId = em,
            folderId = folderId?.takeIf { it.isNotBlank() } ?: "inbox",
        )
    }

    fun clearPendingDeepLink() {
        _pendingDeepLink.value = null
    }

    fun setPendingInboxLink(mailboxId: String?) {
        _pendingInboxLink.value = PendingInboxLink(mailboxId?.takeIf { it.isNotBlank() })
    }

    fun clearPendingInboxLink() {
        _pendingInboxLink.value = null
    }

    companion object {
        const val CHANNEL_ID = "inboxies_mail"
        private const val PREFS_NAME = "inboxies_prefs"
        private const val KEY_PUSH_ENABLED = "push_notifications_enabled"
        private const val KEY_PERMISSION_PROMPTED = "push_permission_prompted"
        private const val KEY_DEVICE_TOKEN = "push_device_token"
        private const val KEY_KNOWN_MAILBOXES = "push_known_mailboxes"

        lateinit var shared: PushNotificationManager
            private set

        fun init(context: Context) {
            shared = PushNotificationManager(context.applicationContext)
            ensureChannel(context.applicationContext)
        }

        /**
         * Created at app start regardless of FCM config, so the channel the manifest names
         * as FCM's default always exists and users can tune it in system Settings.
         */
        fun ensureChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT,
            )
            manager.createNotificationChannel(channel)
        }
    }
}
