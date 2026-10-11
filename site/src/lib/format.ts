// Dates in data are plain "YYYY-MM-DD" strings, read as calendar days.
// Parsed by hand rather than through Date or Intl, so a build in any time
// zone prints the same day ("4 Oct", never "3 Oct").

// Spelled out rather than Intl, so every runtime agrees ("Sep", not "Sept").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** "2026-10-04" → { y: 2026, m: 10, d: 4 }. Throws on anything else, so a typo fails the build. */
export function parseDay(iso: string): { y: number; m: number; d: number } {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) throw new Error(`format: "${iso}" is not a YYYY-MM-DD date`);
	const y = Number(match[1]);
	const m = Number(match[2]);
	const d = Number(match[3]);
	const check = new Date(Date.UTC(y, m - 1, d));
	if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
		throw new Error(`format: "${iso}" is not a real date`);
	}
	return { y, m, d };
}

/** "2026-10-04" → "4 Oct" (changelog rows) */
export function day(iso: string): string {
	const { m, d } = parseDay(iso);
	return `${d} ${MONTHS[m - 1]}`;
}

/** "2026-10-08" → "8 Oct 2026" ("Updated 8 Oct 2026") */
export function date(iso: string): string {
	const { y, m, d } = parseDay(iso);
	return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-10-04" → "OCTOBER" (changelog month rows) */
export function month(iso: string): string {
	const { m } = parseDay(iso);
	return MONTHS_LONG[m - 1].toUpperCase();
}

/** Whole days from one "YYYY-MM-DD" to the next (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
	const a = parseDay(from);
	const b = parseDay(to);
	return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}
