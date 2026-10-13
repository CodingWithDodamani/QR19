"use client";

import { Fingerprint, IndianRupee, Scale, WifiOff } from "lucide-react";

import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

/** Why QR19: only claims the pipeline actually enforces. */
const BENEFITS = [
  {
    Icon: Scale,
    tint: "bg-[#e9f0ff] text-[#006aff]",
    title: "Exact amounts, enforced",
    copy: "Even ₹1 short never completes a QR. The server checks the captured amount to the paise before anything advances.",
  },
  {
    Icon: Fingerprint,
    tint: "bg-[#e6f7ec] text-[#16a34a]",
    title: "One proof, one QR",
    copy: "A provider transaction reference can verify exactly one code, ever. Reused screenshots are blocked and alarmed.",
  },
  {
    Icon: WifiOff,
    tint: "bg-[#fef3d6] text-[#9a6206]",
    title: "Offline-first collection",
    copy: "Generate QRs and queue collections with no connection. Everything syncs itself the moment you're back.",
  },
  {
    Icon: IndianRupee,
    tint: "bg-[#eeedf9] text-[#5140b5]",
    title: "₹0, no signup, no tracking",
    copy: "No accounts, no fees, no analytics. Merchant secrets stay AES-256-GCM encrypted on your own server.",
  },
] as const;

export function Benefits() {
  return (
    <section id="benefits" className="scroll-mt-24 bg-white py-20 lg:py-28" aria-labelledby="benefits-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="benefits-title"
          kicker="Why QR19"
          title={
            <>
              Built for counters, <span className="text-gradient">not demos</span>
            </>
          }
          subtitle="Every claim below is enforced server-side — try to break one in demo mode and watch the shield hold."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {BENEFITS.map(({ Icon, tint, title, copy }, i) => (
            <Reveal key={title} delay={(i % 2) * 0.08}>
              <div className="spotlight flex h-full items-start gap-4 rounded-2xl border border-[#e3e8ef] bg-white p-6">
                <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${tint}`}>
                  <Icon size={22} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-[16px] font-semibold text-[#121a26]">{title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#65748b]">{copy}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
