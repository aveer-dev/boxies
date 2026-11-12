package co.inboxies.app.services

import co.inboxies.app.models.PileIds
import co.inboxies.app.models.WorkflowPile
import java.text.Normalizer

/**
 * Piles people make (AVE-194) beside the built-in Reply Later and Set Aside. The API and
 * its rules are `shared/piles.ts`; these helpers mirror it so names are checked the same
 * on every client. A mail (and its thread) is in one pile at a time; replying clears Reply
 * Later only. iOS twin: `MailPiles.swift`.
 */
object MailPiles {
    /** Longest pile name, in code points, after trimming (`PILE_NAME_MAX`). */
    const val NAME_MAX = 40
    /** Piles one mailbox can make (`MAX_CUSTOM_PILES`; built-ins don't count). */
    const val MAX_CUSTOM = 20

    // Worker copy (`normalizePileName` / the pile routes), shown as-is.
    const val NAME_REQUIRED = "Pile name is required"
    const val INVALID_CHARACTERS = "Pile name contains invalid characters"
    const val NAME_TOO_LONG = "Pile name must be at most $NAME_MAX characters"
    const val DUPLICATE_NAME = "A pile with this name already exists"
    const val TOO_MANY = "A mailbox can have at most $MAX_CUSTOM piles of its own"

    // Client copy (iOS and Android share it).
    const val TITLE = "Piles"
    const val LIST_EMPTY = "No piles of your own yet. Make one for mail that needs follow-through, like “Waiting on” or “To pay”."
    const val CREATE_LABEL = "New pile"
    const val CREATE_TITLE = "New pile"
    const val CREATE_MENU = "New pile…"
    const val PICKER_TITLE = "Move to pile"
    const val PICKER_MENU = "Move to pile…"
    const val NAME_LABEL = "Pile name"
    const val RENAME_TITLE = "Rename pile"
    const val RENAME_MENU = "Rename pile…"
    const val DELETE_BUTTON = "Delete pile"
    const val DELETE_MESSAGE = "Mail in this pile comes out of it and stays where it is. No email is deleted."
    const val VIEW_EMPTY_MESSAGE = "Put mail here from its ⋯ menu. It stays until you take it out."
    const val UPDATE_FAILED = "Couldn’t update the pile"
    const val CREATE_FAILED = "Couldn’t make the pile"
    const val RENAME_FAILED = "Couldn’t rename the pile"
    const val DELETE_FAILED = "Couldn’t delete the pile"

    fun deleteTitle(name: String): String = "Delete “$name”?"
    fun viewEmptyTitle(name: String): String = "Nothing in $name"
    fun movedToast(name: String): String = "Moved to $name"
    fun removedToast(name: String): String = "Removed from $name"
    fun removeAction(name: String): String = "Remove from $name"
    fun subtitle(count: Int): String = when {
        count <= 0 -> "Empty"
        count == 1 -> "1 in this pile"
        else -> "$count in this pile"
    }

    sealed class NameResult {
        data class Ok(val name: String, val key: String) : NameResult()
        data class Invalid(val error: String) : NameResult()
    }

    private val forbidden = Regex("[\\p{Cc}‎‏‪-‮⁦-⁩]")
    private val whitespace = Regex("[\\s   -     　﻿]+")
    private val builtinKeys = setOf("reply later", "set aside")

    /** `normalizePileName`: NFC, whitespace folded, trimmed, checked; `key` is unique per mailbox. */
    fun normalizeName(raw: String?): NameResult {
        if (raw == null) return NameResult.Invalid(NAME_REQUIRED)
        val name = Normalizer.normalize(raw, Normalizer.Form.NFC).replace(whitespace, " ").trim()
        if (name.isEmpty()) return NameResult.Invalid(NAME_REQUIRED)
        if (forbidden.containsMatchIn(name)) return NameResult.Invalid(INVALID_CHARACTERS)
        if (name.codePointCount(0, name.length) > NAME_MAX) return NameResult.Invalid(NAME_TOO_LONG)
        return NameResult.Ok(name, name.lowercase())
    }

    /**
     * Error sentence for a new (or renamed) pile name, or null when it can go to the Worker.
     * [existing] are the custom piles; the built-in names are always taken.
     */
    fun validate(raw: String?, existing: List<WorkflowPile>, renaming: WorkflowPile? = null): String? =
        when (val result = normalizeName(raw)) {
            is NameResult.Invalid -> result.error
            is NameResult.Ok -> when {
                result.key in builtinKeys -> DUPLICATE_NAME
                existing.any { it.id != renaming?.id && it.name?.lowercase() == result.key } -> DUPLICATE_NAME
                renaming == null && existing.size >= MAX_CUSTOM -> TOO_MANY
                else -> null
            }
        }

    /** The piles people made (`builtin: false`), in the Worker's order. */
    fun custom(piles: List<WorkflowPile>): List<WorkflowPile> =
        piles.filter { !it.builtin && !PileIds.isBuiltin(it.id) }

    fun displayName(pile: WorkflowPile): String = pile.name ?: "Pile"
}
