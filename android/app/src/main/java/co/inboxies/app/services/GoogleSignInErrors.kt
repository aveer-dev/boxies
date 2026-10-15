package co.inboxies.app.services

import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException

/**
 * What to show when Credential Manager's Google sign-in fails before the
 * server sees a token. Null when the user just dismissed the sheet.
 */
fun googleCredentialErrorMessage(e: GetCredentialException): String? = when (e) {
    is GetCredentialCancellationException -> null
    // Also what a missing SHA-1 / package mismatch in the Google project looks like.
    is NoCredentialException ->
        "No Google account is available for Inboxies. Add one in Android Settings, then try again."
    else -> e.message ?: "Google Sign-In failed"
}
