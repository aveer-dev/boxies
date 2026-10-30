package co.inboxies.app.services

import co.inboxies.app.models.Folder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlinx.serialization.json.Json

/** Tag (custom folder) rules match the Worker and the iOS twin (AVE-158). */
class CustomFoldersTest {
    @Test
    fun renameResponseDecodesWithoutUnreadCount() {
        // PUT /folders/:id answers `{ id, name }` only; POST adds `unreadCount: 0`.
        val json = Json { ignoreUnknownKeys = true }
        val renamed = json.decodeFromString<Folder>("""{"id":"receipts","name":"Bills"}""")
        assertEquals(Folder("receipts", "Bills", 0), renamed)
        val created = json.decodeFromString<Folder>("""{"id":"travel","name":"Travel","unreadCount":0}""")
        assertEquals("travel", created.id)
    }

    @Test
    fun slugMatchesWorker() {
        assertEquals("engineering-prs", CustomFolders.slug("Engineering PRs"))
        assertEquals("q3-plans", CustomFolders.slug("  Q3 -- Plans!  "))
        assertEquals("snake_case", CustomFolders.slug("snake_case"))
        // JS `\w` is ASCII: accented letters drop out, like the Worker.
        assertEquals("caf", CustomFolders.slug("Café"))
        assertEquals("", CustomFolders.slug("🎉🎉"))
    }

    @Test
    fun customExcludesSystemFolders() {
        val folders = listOf(
            Folder("inbox", "Inbox", 1),
            Folder("travel", "Travel", 0),
            Folder("screened_out", "Screened out", 0),
            Folder("receipts", "Receipts", 2),
        )
        assertEquals(listOf("receipts", "travel"), CustomFolders.custom(folders).map { it.id })
    }

    @Test
    fun createValidationUsesWorkerCopy() {
        val existing = listOf(Folder("inbox", "Inbox", 0), Folder("receipts", "Receipts", 0))
        assertEquals(CustomFolders.NAME_REQUIRED, CustomFolders.validateCreate("   ", existing))
        assertEquals(CustomFolders.NAME_REQUIRED, CustomFolders.validateCreate("#", existing))
        assertEquals("Folder name must contain alphanumeric characters", CustomFolders.validateCreate("!!!", existing))
        assertEquals("Folder with this name already exists", CustomFolders.validateCreate("receipts", existing))
        assertEquals(CustomFolders.DUPLICATE_NAME, CustomFolders.validateCreate("#Receipts", existing))
        // System ids are reserved even when the list doesn't carry them.
        assertEquals(CustomFolders.DUPLICATE_NAME, CustomFolders.validateCreate("Trash", existing))
        assertNull(CustomFolders.validateCreate("Travel", existing))
    }

    @Test
    fun renameValidationIgnoresTheFolderItself() {
        val receipts = Folder("receipts", "Receipts", 0)
        val existing = listOf(Folder("inbox", "Inbox", 0), receipts, Folder("travel", "Trips", 0))
        assertNull(CustomFolders.validateRename("RECEIPTS", receipts, existing))
        assertEquals("Folder name is required", CustomFolders.validateRename("", receipts, existing))
        assertEquals(CustomFolders.DUPLICATE_NAME, CustomFolders.validateRename("trips", receipts, existing))
        // Lookups resolve by id too, so another folder's id is taken.
        assertEquals(CustomFolders.DUPLICATE_NAME, CustomFolders.validateRename("Travel", receipts, existing))
        assertEquals(CustomFolders.DUPLICATE_NAME, CustomFolders.validateRename("inbox", receipts, existing))
        assertNull(CustomFolders.validateRename("Bills", receipts, existing))
    }

    @Test
    fun tagCopy() {
        val tag = Folder("receipts", "#Receipts", 0)
        assertEquals("#Receipts", CustomFolders.displayName(tag))
        assertEquals("Receipts", CustomFolders.normalizedName("  #Receipts "))
        assertEquals("Delete #Receipts?", CustomFolders.deleteConfirmTitle(tag))
    }
}
