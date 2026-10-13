"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { motion } from "framer-motion";
import { QrCode, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/landing/reveal";
import { StoreBadges } from "@/components/landing/store-badges";

/**
 * Download CTA: a LIVE QR code to /app generated on-device (works offline
 * once loaded), plus honest PWA install steps. No App Store / Google Play
 * badges — QR19 is an installable PWA, not a listed store app.
 */
export function DownloadCta() {
  const [appUrl, setAppUrl] = useState("");
  const [appQr, setAppQr] = useState<string | null>(null);

  useEffect(() => {
    // Post-hydration only: window.location differs between server and client.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync; cannot be computed during render without breaking hydration.
    setAppUrl(`${window.location.origin}/app`);
  }, []);

  useEffect(() => {
    if (!appUrl) return;
    let alive = true;
    QRCode.toDataURL(appUrl, {
      width: 560,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#182621", light: "#ffffff" },
    })
      .then((image) => {
        if (alive) setAppQr(image);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [appUrl]);

  return (
    <section aria-labelledby="download-title" className="relative overflow-hidden bg-[#121a26] py-20 lg:py-24">
      <div
        className="pointer-events-none absolute -left-20 top-0 size-72 rounded-full bg-[#87e64b]/10 blur-[100px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 size-72 rounded-full bg-[#006aff]/15 blur-[100px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-8">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
            <Smartphone size={13} aria-hidden="true" />
            PWA · iOS &amp; Android
          </span>
          <h2
            id="download-title"
            className="mt-4 text-balance text-[30px] font-bold leading-[1.1] tracking-tight text-white sm:text-[40px]"
          >
            Get QR19 on your phone today, free
          </h2>
          <p className="mt-4 max-w-md text-pretty text-[15px] leading-relaxed text-white/65">
            Skip the app store. Scan the code, open the app, and add it to your home
            screen — iPhone via Share, Android via Install. Fully
            offline after the first open.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="cta-shimmer group h-12 rounded-full bg-[#87e64b] px-7 text-[15px] font-semibold text-[#121a26] shadow-[0_14px_34px_-10px_rgba(135,230,75,0.5)] transition-all hover:-translate-y-0.5 hover:bg-[#7bd63f] hover:text-[#121a26]"
            >
              <a href="/app">
                <Smartphone size={17} aria-hidden="true" />
                Open the mobile app
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="btn-shine h-12 rounded-full px-7 text-[15px] text-white/90 ring-1 ring-inset ring-white/30 transition-all hover:bg-white/10 hover:text-white"
            >
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
          <div className="mt-5">
            <StoreBadges dark />
          </div>
          <ol className="mt-8 space-y-2.5 text-[13px] text-white/60">
            <li>
              <strong className="font-semibold text-white">1. Scan</strong> — point your phone camera at the code.
            </li>
            <li>
              <strong className="font-semibold text-white">2. Install</strong> — iPhone: Share → Add to Home Screen ·
              Android: menu → Install app.
            </li>
            <li>
              <strong className="font-semibold text-white">3. Collect</strong> — works offline from the first open.
            </li>
          </ol>
          <p className="mt-5 text-[12.5px] text-white/50">
            A Google Play listing is planned for later — this installable app is the full product today.
          </p>
        </Reveal>
        <Reveal delay={0.12} className="flex justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="w-64 rounded-3xl bg-white p-5 text-center shadow-[0_30px_70px_-24px_rgba(0,0,0,0.5)] sm:w-72"
          >
            {appQr ? (
              <img src={appQr} alt="QR code linking to the QR19 mobile app" width={280} height={280} className="w-full rounded-2xl" />
            ) : (
              <span className="block aspect-square w-full animate-pulse rounded-2xl bg-[#eef1f6]" aria-hidden="true" />
            )}
            <p className="mt-4 flex items-center justify-center gap-2 text-[13px] font-semibold text-[#121a26]">
              <QrCode size={15} aria-hidden="true" />
              Scan to open the app
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-[#65748b]">{appUrl || "…"}</p>
          </motion.div>
        </Reveal>
      </div>
    </section>
  );
}
