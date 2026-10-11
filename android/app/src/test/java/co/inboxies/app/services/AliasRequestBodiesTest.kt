package co.inboxies.app.services

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class AliasRequestBodiesTest {
    private val expiry = Instant.parse("2026-10-08T12:00:00.123456Z")

    @Test
    fun createUsesCamelCaseAndAbsoluteExpiry() {
        val body = AliasRequestBodies.create(label = "Shop", expiresAt = expiry, pausedAction = "reject")
        assertEquals(setOf("label", "expiresAt", "pausedAction"), body.keys)
        assertEquals(JsonPrimitive("Shop"), body["label"])
        assertEquals(JsonPrimitive("2026-10-08T12:00:00Z"), body["expiresAt"])
        assertEquals(JsonPrimitive("reject"), body["pausedAction"])
    }

    @Test
    fun createOmitsUnsetOptionalFields() {
        val body = AliasRequestBodies.create(label = null, expiresAt = null, pausedAction = "drop")
        assertEquals(setOf("pausedAction"), body.keys)
    }

    @Test
    fun updateOnlySendsChangedFields() {
        val body = AliasRequestBodies.update(
            label = null,
            isActive = false,
            pausedAction = null,
            expiresAt = null,
        )
        assertEquals(setOf("isActive"), body.keys)
        assertEquals(JsonPrimitive(false), body["isActive"])
    }

    @Test
    fun updateClearsWithJsonNull() {
        val body = AliasRequestBodies.update(
            label = FieldUpdate(null),
            isActive = null,
            pausedAction = "drop",
            expiresAt = FieldUpdate(null),
        )
        assertEquals(JsonNull, body["label"])
        assertEquals(JsonNull, body["expiresAt"])
        assertEquals(JsonPrimitive("drop"), body["pausedAction"])
        assertFalse(body.containsKey("isActive"))
    }

    @Test
    fun noSnakeCaseKeys() {
        val bodies = listOf(
            AliasRequestBodies.create("x", expiry, "drop"),
            AliasRequestBodies.update(FieldUpdate("x"), true, "reject", FieldUpdate(expiry)),
        )
        bodies.flatMap { it.keys }.forEach { key -> assertTrue(key, '_' !in key) }
    }
}
