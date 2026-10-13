/**
 * App-store readiness switch.
 *
 * Today QR19 distributes as an installable PWA (scan the QR in the
 * download section, Add to Home Screen) — so both URLs are null and no
 * store badge renders anywhere. The day a listing goes live:
 *   1. paste the URL below,
 *   2. set SHOW_STORE_BADGES to true,
 * and the <StoreBadges /> component lights up across the site and app.
 * Nothing else needs to change, and no dead store link can ever ship.
 */

export const PLAY_STORE_URL: string | null = null;
// Example once published:
// export const PLAY_STORE_URL: string | null =
//   "https://play.google.com/store/apps/details?id=app.qr19";

export const APP_STORE_URL: string | null = null;

export const SHOW_STORE_BADGES = false;

export function hasStorePresence(): boolean {
  return SHOW_STORE_BADGES && (PLAY_STORE_URL !== null || APP_STORE_URL !== null);
}
