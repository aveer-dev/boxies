package co.inboxies.app.services

import co.inboxies.app.models.Folder

/**
 * Custom folders, shown as "tags" (AVE-158). A message carries one tag: the folder it's in.
 *
 * Mirrors the Worker's folder routes (`workers/index.ts` POST / PUT / DELETE
 * `/api/v1/mailboxes/:id/folders`) and the web tag UI
 * (`app/components/columns/FoldersColumn.tsx`), so a name the Worker would refuse is caught
 * before the request with the same sentence. iOS twin: `CustomFolders.swift`.
 */
object CustomFolders {
    /** `SYSTEM_FOLDER_IDS` in `shared/folders.ts`. These can't be renamed or deleted. */
    val systemFolderIds: Set<String> = setOf(
        "inbox", "screener", "promotions", "updates", "sent",
        "draft", "archive", "spam", "screened_out", "trash",
    )

    // Copy (web + Worker)
    const val PAGE_TITLE = "Tags"
    const val INTRO_TEXT = "Tags are folders you create. File mail into one with Move to Folder on any email."
    const val EMPTY_TITLE = "No tags yet"
    /** Web: "No tags yet. Tags are folders you create." */
    const val EMPTY_MESSAGE = "Tags are folders you create."
    const val NAME_PLACEHOLDER = "e.g. Engineering-PRs"
    const val CREATE_FAILED = "Failed to create tag"
    const val RENAME_FAILED = "Failed to rename tag"
    const val DELETE_FAILED = "Failed to delete tag"
    const val RENAME_TITLE = "Rename tag"
    const val DELETE_CONFIRM_MESSAGE = "Its mail moves to your Inbox. This can't be undone."
    const val NO_MAILBOX = "Select a mailbox first"

    /** Worker error sentences (`workers/index.ts`), shown as-is like web does. */
    const val NAME_REQUIRED = "Folder name is required"
    const val NEEDS_ALPHANUMERIC = "Folder name must contain alphanumeric characters"
    const val DUPLICATE_NAME = "Folder with this name already exists"

    fun deleteConfirmTitle(folder: Folder): String = "Delete ${displayName(folder)}?"

    fun deletedToast(folder: Folder): String = "Deleted ${displayName(folder)}. Its mail is in your Inbox."

    fun renameMessage(folder: Folder): String = "Mail in ${displayName(folder)} stays in it."

    fun isCustom(folder: Folder): Boolean = folder.id !in systemFolderIds

    /** Custom folders only, by name. */
    fun custom(folders: List<Folder>): List<Folder> =
        folders.filter(::isCustom).sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

    /** "#Receipts" for a folder named "Receipts" (web strips one leading "#" and draws its own). */
    fun displayName(folder: Folder): String = "#${bareName(folder.name)}"

    fun bareName(name: String): String = name.removePrefix("#")

    /** What we send: trimmed, one leading "#" dropped (web `handleCreateTag`). */
    fun normalizedName(raw: String): String = bareName(raw.trim()).trim()

    /**
     * `slugify` in `workers/index.ts`: the id the Worker gives a new folder. JS `\w` is
     * ASCII-only, so the class is spelled out.
     */
    fun slug(name: String): String = name.lowercase()
        .replace(Regex("\\s+"), "-")
        .replace(Regex("[^A-Za-z0-9_-]+"), "")
        .replace(Regex("-{2,}"), "-")
        .replace(Regex("^-+"), "")
        .replace(Regex("-+$"), "")

    /** Error sentence for a new tag name, or null when the Worker would accept it. */
    fun validateCreate(raw: String, existing: List<Folder>): String? {
        val name = normalizedName(raw)
        if (name.isEmpty()) return NAME_REQUIRED
        val id = slug(name)
        if (id.isEmpty()) return NEEDS_ALPHANUMERIC
        val lowered = name.lowercase()
        if (id in systemFolderIds ||
            existing.any { it.id.lowercase() == id || it.name.lowercase() == lowered }
        ) {
            return DUPLICATE_NAME
        }
        return null
    }

    /**
     * Error sentence for renaming [folder], or null. Names may not match another folder's
     * name or id, case-insensitively (the Durable Object's `updateFolder`).
     */
    fun validateRename(raw: String, folder: Folder, existing: List<Folder>): String? {
        val name = normalizedName(raw)
        if (name.isEmpty()) return NAME_REQUIRED
        val lowered = name.lowercase()
        if (lowered in systemFolderIds ||
            existing.any { it.id != folder.id && (it.name.lowercase() == lowered || it.id.lowercase() == lowered) }
        ) {
            return DUPLICATE_NAME
        }
        return null
    }

    /** Thrown before a request when the name fails [validateCreate] / [validateRename]. */
    class ValidationException(message: String) : Exception(message)
}
