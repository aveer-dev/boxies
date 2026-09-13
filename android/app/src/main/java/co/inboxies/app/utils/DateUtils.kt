package co.inboxies.app.utils

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

object DateUtils {
    fun formatEmailDate(iso: String): String {
        if (iso.isBlank()) return ""
        return try {
            val instant = parseIso(iso) ?: return iso.take(10)
            val zone = ZoneId.systemDefault()
            val zonedDateTime = instant.atZone(zone)
            val date = zonedDateTime.toLocalDate()
            val now = LocalDate.now(zone)

            when {
                date == now -> {
                    val formatter = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
                    zonedDateTime.format(formatter)
                }
                date == now.minusDays(1) -> {
                    "Yesterday"
                }
                ChronoUnit.DAYS.between(date, now) < 7 && ChronoUnit.DAYS.between(date, now) > 0 -> {
                    val formatter = DateTimeFormatter.ofPattern("EEE", Locale.getDefault())
                    zonedDateTime.format(formatter)
                }
                date.year == now.year -> {
                    val formatter = DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())
                    zonedDateTime.format(formatter)
                }
                else -> {
                    val formatter = DateTimeFormatter.ofPattern("MM/dd/yy", Locale.getDefault())
                    zonedDateTime.format(formatter)
                }
            }
        } catch (_: Exception) {
            iso.take(10)
        }
    }

    /** Mail-list dates: today → time, this year → MMM d, otherwise MMM d, yyyy. */
    fun formatListDate(iso: String): String {
        if (iso.isBlank()) return ""
        return try {
            val instant = parseIso(iso) ?: return ""
            val zone = ZoneId.systemDefault()
            val zonedDateTime = instant.atZone(zone)
            val date = zonedDateTime.toLocalDate()
            val now = LocalDate.now(zone)
            when {
                date == now -> DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
                    .withLocale(Locale.getDefault())
                    .format(zonedDateTime)
                date.year == now.year -> DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())
                    .format(zonedDateTime)
                else -> DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault())
                    .format(zonedDateTime)
            }
        } catch (_: Exception) {
            ""
        }
    }

    fun formatFullDate(iso: String): String {
        if (iso.isBlank()) return ""
        return try {
            val instant = parseIso(iso) ?: return iso
            val zone = ZoneId.systemDefault()
            val zonedDateTime = instant.atZone(zone)
            val formatter = DateTimeFormatter.ofPattern("MMM d, yyyy 'at' h:mm a", Locale.getDefault())
            zonedDateTime.format(formatter)
        } catch (_: Exception) {
            iso
        }
    }

    /**
     * Matches web/iOS `formatDetailDate`: "Tue, Apr 15, 3:42 PM".
     * Includes the year when the message is from a different calendar year.
     */
    fun formatDetailDate(iso: String): String {
        if (iso.isBlank()) return ""
        return try {
            val instant = parseIso(iso) ?: return iso
            val zone = ZoneId.systemDefault()
            val zonedDateTime = instant.atZone(zone)
            val now = LocalDate.now(zone)
            val pattern = if (zonedDateTime.year == now.year) {
                "EEE, MMM d, h:mm a"
            } else {
                "EEE, MMM d, yyyy, h:mm a"
            }
            DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).format(zonedDateTime)
        } catch (_: Exception) {
            iso
        }
    }

    /** iOS `DateFormatter` medium date + short time, used in quoted/forward headers. */
    fun formatMediumDateTime(iso: String): String {
        if (iso.isBlank()) return iso
        return try {
            val instant = parseIso(iso) ?: return iso
            val zonedDateTime = instant.atZone(ZoneId.systemDefault())
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(Locale.getDefault())
                .format(zonedDateTime)
        } catch (_: Exception) {
            iso
        }
    }

    /** Chat list relative date — mirrors iOS `formatRelativeDate`. */
    fun formatChatRelativeDate(iso: String): String {
        if (iso.isBlank()) return ""
        return try {
            val instant = parseIso(iso) ?: return iso.take(10)
            val zone = ZoneId.systemDefault()
            val date = instant.atZone(zone).toLocalDate()
            val now = LocalDate.now(zone)
            when {
                date == now -> {
                    val minutes = ChronoUnit.MINUTES.between(instant, Instant.now()).coerceAtLeast(0)
                    when {
                        minutes < 1 -> "now"
                        minutes < 60 -> "${minutes}m ago"
                        else -> {
                            val hours = ChronoUnit.HOURS.between(instant, Instant.now()).coerceAtLeast(1)
                            "${hours}h ago"
                        }
                    }
                }
                date == now.minusDays(1) -> "Yesterday"
                else -> {
                    val days = ChronoUnit.DAYS.between(date, now)
                    if (days in 2..7) "${days}d ago"
                    else DateTimeFormatter.ofPattern("MMM d", Locale.getDefault()).format(date)
                }
            }
        } catch (_: Exception) {
            iso.take(10)
        }
    }

    private fun parseIso(value: String): Instant? {
        if (value.isEmpty()) return null
        return try {
            Instant.parse(value)
        } catch (_: Exception) {
            try {
                val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.of("UTC"))
                Instant.from(fmt.parse(value))
            } catch (_: Exception) {
                null
            }
        }
    }
}
