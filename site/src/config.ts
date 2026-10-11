// src: BRIEF (fixed values), PS#6 (support address, X handle), PS#7 (repo), FC#8 (TestFlight, no store listing)
export const SITE_URL = "https://inboxies.co";
export const APP_URL = "https://inboxies.email";           // the web app's origin; never a link target on its own
// Sign-up and sign-in both start on /login. The root sits behind Cloudflare
// Access, so a signed-out visitor sent there hits a login wall (D1).
export const SIGN_UP_URL = `${APP_URL}/login`;
export const SIGN_IN_URL = SIGN_UP_URL;
export type IosStatus = "hidden" | "testflight" | "appstore";
export const IOS_STATUS: IosStatus = "testflight";
export const APP_STORE_URL: string | null = null;           // set with IOS_STATUS = "appstore"
export const TESTFLIGHT_URL: string | null = null;          // a public TestFlight link, if one ever exists
export const SUPPORT_EMAIL = "support@inboxies.email";
export const IOS_BETA_MAILTO =
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("iPhone beta invite")}` +
  `&body=${encodeURIComponent("Hi, I'd like to try the Inboxies iPhone beta. The email I use for TestFlight is: ")}`;
export const GITHUB_URL = "https://github.com/aveer-dev/boxies";
export const X_URL: string | null = "https://x.com/inboxies_app"; // [OWNER: handle live and owned] — null hides every X link

export const flags = {
  webAppPublic: true,          // false while signed-out visitors can't reach inboxies.email/login (Access): drops "Web" from platform and availability lines, and the CTAs become the iPhone beta
  privateEmailShipped: false,  // flip when PR #46 (dev) reaches main
  autoDraftsFromDayOne: false, // flip when PR #49 (merged to dev) reaches main
  domainPurchaseLive: true,    // false hides every $20 surface (Stripe + Registrar + webhook secrets live?)
  androidPublic: false,        // true adds Android to platform lines, sign-in copy, apps answer
} as const;

export const asOf = "2026-10-09"; // shown as "Updated 9 Oct 2026"; build warns when > 45 days old

export const NAV = [
  { id: "tour",    label: "Tour",    href: "/#tour",     hideBelow: 481 }, // hidden ≤480px
  { id: "pricing", label: "Pricing", href: "/pricing" },
  { id: "roadmap", label: "Roadmap", href: "/roadmap",   hideBelow: 401 }, // hidden ≤400px
  { id: "support", label: "Support", href: "/support" },
  // Nothing to sign in to while the web app isn't public.
  ...(flags.webAppPublic ? ([{ id: "signin", label: "Sign in", href: SIGN_IN_URL, external: true, hideBelow: 481 }] as const) : []),
] as const;

type Cta = { label: string; href: string; external: boolean };

/** The iPhone call to action, by status. null = render nothing. */
export function iosCta(): Cta | null {
  if (IOS_STATUS === "appstore" && APP_STORE_URL) return { label: "Download for iPhone", href: APP_STORE_URL, external: true };
  if (IOS_STATUS === "testflight" && TESTFLIGHT_URL) return { label: "Join the iPhone beta", href: TESTFLIGHT_URL, external: true };
  if (IOS_STATUS === "testflight") return { label: "Ask for the iPhone beta", href: IOS_BETA_MAILTO, external: false };
  return null;
}

/** The main call to action: sign up on the web, or the iPhone app while the web app isn't public. */
export function primaryCta(): Cta {
  if (flags.webAppPublic) return { label: "Get started — free", href: SIGN_UP_URL, external: true };
  return iosCta() ?? { label: "Write to us", href: `mailto:${SUPPORT_EMAIL}`, external: false };
}

/** The iPhone link shown beside the main CTA. null when the main CTA already is the iPhone one. */
export function secondaryIosCta(): Cta | null {
  return flags.webAppPublic ? iosCta() : null;
}

/** Short availability string for the footer preview and pricing apps row. */
export function availabilityShort(): string {
  const parts: string[] = [];
  if (flags.webAppPublic) parts.push("Web");
  if (IOS_STATUS === "testflight") parts.push("iPhone beta");
  if (IOS_STATUS === "appstore") parts.push("iPhone");
  if (flags.androidPublic) parts.push("Android");
  return parts.join(" · ");
}
