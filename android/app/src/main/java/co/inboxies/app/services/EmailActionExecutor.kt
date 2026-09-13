package co.inboxies.app.services

import co.inboxies.app.models.Email

/**
 * Swipe / bulk action helpers. Core undoable delete/archive/move live on [AppModel];
 * this object keeps the iOS `EmailActionExecutor` naming surface for call sites.
 */
object EmailActionExecutor {
    suspend fun performDelete(model: AppModel, email: Email) = model.deleteEmail(email)
    suspend fun performArchive(model: AppModel, email: Email) = model.archiveEmail(email)
    suspend fun performMove(model: AppModel, email: Email, folderId: String) =
        model.moveEmailToFolder(email, folderId)
}
