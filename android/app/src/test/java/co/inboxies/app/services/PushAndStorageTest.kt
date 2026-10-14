package co.inboxies.app.services

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.security.KeyStoreException
import javax.crypto.AEADBadTagException

class PushAndStorageTest {
    @Test
    fun pushFilterNeverWrittenAllowsEverything() {
        // First launch after an update, before any mailbox list was recorded.
        assertTrue(PushMailboxFilter.allows(null, "a@x.com"))
        assertTrue(PushMailboxFilter.allows(null, null))
    }

    @Test
    fun pushFilterSignedOutDropsEverything() {
        // Sign-out stores an empty set: a previous user's pushes must not show.
        assertFalse(PushMailboxFilter.allows(emptySet(), "a@x.com"))
        assertFalse(PushMailboxFilter.allows(emptySet(), null))
    }

    @Test
    fun pushFilterOnlyListedMailboxes() {
        val known = setOf("you@x.com", "Team@x.com")
        assertTrue(PushMailboxFilter.allows(known, "you@x.com"))
        assertTrue(PushMailboxFilter.allows(known, "team@X.com"))
        assertFalse(PushMailboxFilter.allows(known, "previous-user@x.com"))
        assertTrue(PushMailboxFilter.allows(known, null))
    }

    @Test
    fun onlyDecryptOrKeysetErrorsWipeTheSessionStore() {
        assertTrue(SecureSessionStorage.isUnrecoverableKeyset(AEADBadTagException("bad tag")))
        assertTrue(SecureSessionStorage.isUnrecoverableKeyset(RuntimeException(KeyStoreException("keyset"))))
        assertTrue(SecureSessionStorage.isUnrecoverableKeyset(IOException(InvalidProtocolBufferException())))
        assertFalse(SecureSessionStorage.isUnrecoverableKeyset(IllegalStateException("keystore busy")))
        assertFalse(SecureSessionStorage.isUnrecoverableKeyset(IOException("disk")))
    }

    /** Stand-in matched by name, like protobuf's (shaded inside Tink). */
    private class InvalidProtocolBufferException : IOException("truncated")
}
