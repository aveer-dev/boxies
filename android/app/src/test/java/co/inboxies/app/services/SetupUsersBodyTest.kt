package co.inboxies.app.services

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** AVE-243: the Worker's setup-users handler reads `fullName`, `contactEmail` and `username`. */
class SetupUsersBodyTest {
    @Test
    fun usesTheKeysTheWorkerReads() {
        val body = ApiClient.SetupUsersRequest.body(
            listOf(
                ApiClient.SetupUser(fullName = "Alice Doe", contactEmail = "alice@example.com", username = "alice"),
                ApiClient.SetupUser(fullName = "", contactEmail = "", username = "bob"),
            ),
        )
        assertEquals(setOf("users"), body.keys)
        val items = body.getValue("users").jsonArray.map { it.jsonObject }
        assertEquals(2, items.size)
        items.forEach { assertEquals(setOf("fullName", "contactEmail", "username"), it.keys) }
        assertEquals(JsonPrimitive("Alice Doe"), items[0]["fullName"])
        assertEquals(JsonPrimitive("alice@example.com"), items[0]["contactEmail"])
        assertEquals(JsonPrimitive("alice"), items[0]["username"])
        assertEquals(JsonPrimitive(""), items[1]["fullName"])
        assertEquals(JsonPrimitive(""), items[1]["contactEmail"])
        assertEquals(JsonPrimitive("bob"), items[1]["username"])
    }
}
