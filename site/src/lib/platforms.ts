// Platform labels, in one order everywhere. Data lists every platform a
// feature really runs on (Android and the web included); what's public is
// decided here, so flipping a flag in config.ts updates every line at once.
import { IOS_STATUS, flags } from "../config";
import type { Platform } from "../data/types";

export const PLATFORM_LABEL: Record<Platform, string> = { ios: "iPhone", android: "Android", web: "Web", chrome: "Chrome", mcp: "MCP clients" };
const ORDER: Platform[] = ["ios", "android", "web", "chrome", "mcp"];

/** Whether visitors can get this platform today. */
export const isPublic = (p: Platform) =>
	(p !== "android" || flags.androidPublic) &&
	(p !== "ios" || IOS_STATUS !== "hidden") &&
	(p !== "web" || flags.webAppPublic) &&
	(p !== "chrome" || flags.chromeExtensionPublic);

export const visiblePlatforms = (ps: Platform[]) => ORDER.filter((p) => ps.includes(p) && isPublic(p));

/** False when an entry names platforms but none of them is public, so data can drop it rather than show it with no platform. */
export const onSomePublicPlatform = (ps: Platform[]) => ps.length === 0 || visiblePlatforms(ps).length > 0;

/** ["ios", "android", "web"] → "iPhone · Web" while Android isn't public. Empty string when nothing is visible. */
export const platformLine = (ps: Platform[]) => visiblePlatforms(ps).map((p) => PLATFORM_LABEL[p]).join(" · ");
