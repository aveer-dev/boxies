package co.inboxies.app.services

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BulkUndoTest {
    private val ids = listOf("a", "b", "c", "d", "e")

    @Test
    fun commitAppliesTheActionToEverySelectedIdOnce() = runBlocking {
        val committed = mutableListOf<String>()
        var failureCalls = 0
        val action = bulkUndoableAction(
            ids = ids + "c",
            message = "Archived",
            perform = { committed += it },
            onFailures = { _, _ -> failureCalls++ },
            rollback = {},
        )
        action.execute()
        assertEquals(ids, committed)
        assertEquals(0, failureCalls)
        assertEquals("Archived", action.message)
    }

    @Test
    fun undoCommitsNothingAndRollsBackOnce() {
        val committed = mutableListOf<String>()
        var rollbacks = 0
        val action = bulkUndoableAction(
            ids = ids,
            message = "Moved to Trash",
            perform = { committed += it },
            onFailures = { _, _ -> },
            rollback = { rollbacks++ },
        )
        action.rollback()
        assertTrue(committed.isEmpty())
        assertEquals(1, rollbacks)
    }

    @Test
    fun oneFailureDoesNotStopTheRestAndIsReportedOnce() = runBlocking {
        val committed = mutableListOf<String>()
        val reports = mutableListOf<Pair<List<String>, String?>>()
        val action = bulkUndoableAction(
            ids = ids,
            message = "Archived",
            perform = { id ->
                if (id == "b" || id == "d") error("boom $id")
                committed += id
            },
            onFailures = { failed, first -> reports += failed to first.message },
            rollback = {},
        )
        action.execute()
        assertEquals(listOf("a", "c", "e"), committed)
        assertEquals(listOf(listOf("b", "d") to "boom b"), reports)
    }
}
