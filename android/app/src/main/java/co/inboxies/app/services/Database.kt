package co.inboxies.app.services

/**
 * Room schema placeholder. Runtime caching uses [DatabaseService] (in-memory) for v1.
 * Entities are kept as plain data classes so the module compiles without KSP generation races.
 */
data class MailboxEntity(
    val id: String,
    val email: String,
    val name: String,
    val settingsJson: String? = null,
)

data class FolderEntity(
    val key: String,
    val id: String,
    val mailboxId: String,
    val name: String,
    val unreadCount: Int = 0,
)

data class EmailEntity(
    val id: String,
    val mailboxId: String,
    val threadId: String? = null,
    val folderId: String,
    val subject: String,
    val sender: String,
    val recipient: String,
    val date: String,
    val read: Boolean = false,
    val starred: Boolean = false,
    val body: String? = null,
)

data class OutboxEntity(
    val id: Long = 0,
    val mailboxId: String,
    val emailId: String,
    val action: String,
    val payloadJson: String,
    val createdAt: Long = System.currentTimeMillis(),
)
