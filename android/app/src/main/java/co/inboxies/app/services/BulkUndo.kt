package co.inboxies.app.services

/**
 * One undoable action for a multi-select delete/archive (AVE-163). Scheduling one action
 * per row committed every row but the last before Undo could be tapped, so Undo brought
 * back a single email. Here [perform] runs once per id, only when the action commits;
 * Undo calls [rollback] and nothing reaches the server.
 *
 * A failing id does not stop the rest. Failed ids and the first error go to [onFailures]
 * once, after the whole batch.
 */
fun bulkUndoableAction(
    ids: List<String>,
    message: String,
    perform: suspend (id: String) -> Unit,
    onFailures: suspend (failedIds: List<String>, firstError: Exception) -> Unit,
    rollback: () -> Unit,
): UndoableAction = UndoableAction(
    message = message,
    execute = {
        val failed = mutableListOf<String>()
        var firstError: Exception? = null
        for (id in ids.distinct()) {
            try {
                perform(id)
            } catch (e: Exception) {
                failed += id
                if (firstError == null) firstError = e
            }
        }
        firstError?.let { onFailures(failed, it) }
    },
    rollback = rollback,
)
