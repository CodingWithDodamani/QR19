"use client";

import { Reveal } from "@/components/landing/reveal";
import {
  AmazonPayIcon,
  BhimIcon,
  CredIcon,
  GooglePayIcon,
  PhonePeIcon,
  PaytmIcon,
  UpiIcon,
  WhatsAppIcon,
  type UpiAppEntry,
} from "@/components/upi-pay/app-icons";

/**
 * Marquee of UPI apps, using verified brand glyphs (PhonePe/Google
 * Pay/Paytm/WhatsApp paths are byte-identical to simple-icons CC0) plus
 * purpose-built tiles where no fittable official vector exists (Amazon
 * Pay/BHIM wide lockups, CRED, UPI mark) — see app-icons.tsx.
 * Apps without a well-known public mark keep a neutral initial chip.
 * The track is duplicated purely for the loop — the duplicate is aria-hidden.
 */

const ICON_APPS: UpiAppEntry[] = [
  { id: "phonepe", name: "PhonePe", Icon: PhonePeIcon },
  { id: "gpay", name: "Google Pay", Icon: GooglePayIcon },
  { id: "paytm", name: "Paytm", Icon: PaytmIcon },
  { id: "bhim", name: "BHIM", Icon: BhimIcon },
  { id: "amazonpay", name: "Amazon Pay", Icon: AmazonPayIcon },
  { id: "whatsapp", name: "WhatsApp Pay", Icon: WhatsAppIcon },
  { id: "cred", name: "CRED", Icon: CredIcon },
  { id: "upi", name: "Any UPI app", Icon: UpiIcon },
];

const CHIP_APPS = [
  { name: "Mobikwik", initial: "M", color: "#64748b", text: "#ffffff" },
  { name: "Slice", initial: "S", color: "#7f1d1d", text: "#ffffff" },
  { name: "Navi", initial: "N", color: "#64748b", text: "#ffffff" },
];

const CHIP_CLASS =
  "inline-flex items-center gap-2.5 rounded-full border border-[#e3e8ef] dark:border-[#e2e8f0]/20 bg-white/80 dark:bg-[#1e293b]/90 py-2 pl-2 pr-4 text-[13px] font-medium text-[#58667a] dark:text-[#cbd5e1] shadow-[0_2px_10px_-4px_rgba(36,54,75,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#635bff]/30 dark:hover:border-[#87e64b]/40 hover:text-[#26364a] dark:hover:text-[#e2e8f0]";

function MarqueeRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div aria-hidden={ariaHidden || undefined} className="flex w-max shrink-0 items-center gap-3 pr-3">
      {ICON_APPS.map(({ id, name, Icon }) => (
        <span key={id} className={CHIP_CLASS}>
          <Icon className="size-7 shrink-0" aria-hidden="true" />
          {name}
        </span>
      ))}
      {CHIP_APPS.map((app) => (
        <span key={app.name} className={CHIP_CLASS}>
          <span
            className="grid size-7 place-items-center rounded-full text-[12px] font-bold"
            style={{ backgroundColor: app.color, color: app.text }}
            aria-hidden="true"
          >
            {app.initial}
          </span>
          {app.name}
        </span>
      ))}
    </div>
  );
}

export function AppsMarquee() {
  return (
    <section aria-label="Supported UPI apps" className="relative py-10">
      <Reveal>
        <p className="text-center text-[12px] font-semibold uppercase tracking-[0.16em] text-[#8b96a8] dark:text-[#94a3b8]">
          Scannable from every UPI app your customers already use
        </p>
      </Reveal>
      <div className="mask-fade-x mt-6 overflow-hidden">
        <div className="anim-marquee flex w-max [animation-duration:38s]">
          <MarqueeRow />
          <MarqueeRow ariaHidden />
        </div>
      </div>
      <p className="sr-only">
        Works with PhonePe, Google Pay, Paytm, BHIM, Amazon Pay, WhatsApp Pay, CRED, Mobikwik, Slice, Navi and any
        other UPI app.
      </p>
    </section>
  );
}
