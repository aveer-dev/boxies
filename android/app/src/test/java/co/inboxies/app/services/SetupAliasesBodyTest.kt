package co.inboxies.app.services

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** AVE-238: the Worker's setup-aliases handler reads `aliasLocal` + `targetMailboxId`. */
class SetupAliasesBodyTest {
    @Test
    fun usesTheKeysTheWorkerReads() {
        val body = AliasRequestBodies.setupAliases(
            listOf(
                SetupAlias(aliasLocal = "support", targetMailboxId = "alice@startup.dev"),
                SetupAlias(aliasLocal = "billing", targetMailboxId = "bob@startup.dev"),
            ),
        )
        assertEquals(setOf("aliases"), body.keys)
        val items = body.getValue("aliases").jsonArray.map { it.jsonObject }
        assertEquals(2, items.size)
        items.forEach { assertEquals(setOf("aliasLocal", "targetMailboxId"), it.keys) }
        assertEquals(JsonPrimitive("support"), items[0]["aliasLocal"])
        assertEquals(JsonPrimitive("alice@startup.dev"), items[0]["targetMailboxId"])
        assertEquals(JsonPrimitive("billing"), items[1]["aliasLocal"])
        assertEquals(JsonPrimitive("bob@startup.dev"), items[1]["targetMailboxId"])
    }
}
