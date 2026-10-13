"use client";

import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || null;

/**
 * Google Analytics (gtag.js). Renders nothing unless
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is set (see .env.example) — so tracking is
 * strictly opt-in and the app's no-tracking default is preserved until the
 * operator configures an ID. When enabling it, update the privacy copy
 * (mobile Profile → Privacy & trust, landing Benefits) to disclose it.
 */
export function GoogleAnalytics() {
  if (!GA_ID) return null;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${GA_ID}');`}
      </Script>
    </>
  );
}
