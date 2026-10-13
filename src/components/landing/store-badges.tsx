"use client";

import { Apple, Play } from "lucide-react";

import { APP_STORE_URL, PLAY_STORE_URL, SHOW_STORE_BADGES } from "@/lib/store-links";

/**
 * Store badges. Renders nothing until a store URL is configured and
 * SHOW_STORE_BADGES is flipped (see src/lib/store-links.ts) — the PWA
 * install path is the distribution channel until then, so no badge can
 * ever point at a listing that does not exist.
 */
export function StoreBadges({ dark = false }: { dark?: boolean }) {
  if (!SHOW_STORE_BADGES) return null;
  const badges: Array<{ href: string; Icon: typeof Play; label: string }> = [];
  if (PLAY_STORE_URL) badges.push({ href: PLAY_STORE_URL, Icon: Play, label: "Get it on Google Play" });
  if (APP_STORE_URL) badges.push({ href: APP_STORE_URL, Icon: Apple, label: "Download on the App Store" });
  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {badges.map(({ href, Icon, label }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            dark
              ? "inline-flex min-h-[52px] items-center gap-2.5 rounded-2xl bg-white px-5 text-[14px] font-semibold text-[#121a26] transition-all hover:-translate-y-0.5"
              : "inline-flex min-h-[52px] items-center gap-2.5 rounded-2xl bg-[#121a26] px-5 text-[14px] font-semibold text-white transition-all hover:-translate-y-0.5"
          }
        >
          <Icon size={19} aria-hidden="true" />
          {label}
        </a>
      ))}
    </div>
  );
}
