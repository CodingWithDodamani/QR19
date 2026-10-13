"use client";

import { Reveal } from "@/components/landing/reveal";

/** Real product limits only — no user counts, no ratings, nothing invented. */
const STATS = [
  { display: "₹1,999", label: "Maximum per QR code", sub: "UPI-friendly chunks" },
  { display: "100", label: "QR codes per split", sub: "One bill, fully covered" },
  { display: "₹1,99,900", label: "Largest collection", sub: "100 × ₹1,999 exactly" },
  { display: "₹0", label: "Platform fee", sub: "No signup, no cut" },
] as const;

export function StatsBand() {
  return (
    <section aria-label="QR19 limits" className="relative overflow-hidden bg-[#121a26] py-14 lg:py-16">
      <div
        className="pointer-events-none absolute -left-20 top-0 size-72 rounded-full bg-[#87e64b]/10 blur-[100px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 size-72 rounded-full bg-[#006aff]/15 blur-[100px]"
        aria-hidden="true"
      />
      <dl className="relative mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-8 px-4 sm:px-6 lg:grid-cols-4 lg:px-8">
        {STATS.map((stat, i) => (
          <Reveal key={stat.label} delay={i * 0.08} className="text-center">
            <dd className="text-[30px] font-bold tabular-nums tracking-tight text-white sm:text-[36px]">
              {stat.display}
            </dd>
            <dt className="mt-1 text-[13px] font-semibold text-white">{stat.label}</dt>
            <p className="mt-0.5 text-[12px] text-white/60">{stat.sub}</p>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}
