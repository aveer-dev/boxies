package co.inboxies.app.util

object ReplyRecipients {
    fun splitAddressList(value: String?): List<String> =
        (value ?: "").split(",").map { it.trim() }.filter { it.isNotEmpty() }

    fun normalizeAddress(address: String): String {
        val trimmed = address.trim()
        if (trimmed.isEmpty()) return ""
        val angle = Regex("<([^>]+)>").find(trimmed)
        return (angle?.groupValues?.getOrNull(1) ?: trimmed).trim().lowercase()
    }

    fun isSameAddress(a: String, b: String?): Boolean {
        if (b == null) return false
        val left = normalizeAddress(a)
        val right = normalizeAddress(b)
        return left.isNotEmpty() && left == right
    }

    fun uniqueAddresses(addresses: List<String>, exclude: String? = null): List<String> {
        val result = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        val excluded = exclude?.let(::normalizeAddress).orEmpty()
        for (address in addresses) {
            val trimmed = address.trim()
            if (trimmed.isEmpty()) continue
            val normalized = normalizeAddress(trimmed)
            if (normalized.isEmpty() || (excluded.isNotEmpty() && normalized == excluded) || normalized in seen) {
                continue
            }
            seen += normalized
            result += trimmed
        }
        return result
    }

    data class ReplyOriginal(
        val sender: String,
        val recipient: String? = null,
        val cc: String? = null,
    )

    fun replyToAddresses(original: ReplyOriginal, selfAddress: String?): List<String> {
        if (selfAddress != null && isSameAddress(original.sender, selfAddress)) {
            val recipients = uniqueAddresses(splitAddressList(original.recipient), selfAddress)
            return if (recipients.isNotEmpty()) recipients else uniqueAddresses(listOf(original.sender))
        }
        return uniqueAddresses(listOf(original.sender))
    }

    fun replyAllAddresses(original: ReplyOriginal, selfAddress: String?): Pair<List<String>, List<String>> {
        val to = uniqueAddresses(
            listOf(original.sender) + splitAddressList(original.recipient),
            selfAddress,
        )
        val toSeen = to.map(::normalizeAddress).toSet()
        val cc = uniqueAddresses(splitAddressList(original.cc), selfAddress)
            .filter { normalizeAddress(it) !in toSeen }
        return to to cc
    }

    fun rewriteSelfReplyTo(
        to: List<String>,
        original: ReplyOriginal,
        selfAddress: String,
    ): List<String> {
        val onlySelf = to.isNotEmpty() && to.all { isSameAddress(it, selfAddress) }
        if (!onlySelf || !isSameAddress(original.sender, selfAddress)) return to
        val corrected = uniqueAddresses(splitAddressList(original.recipient), selfAddress)
        return if (corrected.isEmpty()) to else corrected
    }
}
