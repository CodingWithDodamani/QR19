"use client";

import { Check } from "lucide-react";

import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

/**
 * Pricing: exactly ONE tier exists — free. Monks shows three paid tiers;
 * inventing paid plans for QR19 would be fiction, so this section states
 * the single real plan and names what is deliberately absent.
 */
const INCLUDED = [
  "Unlimited splits — up to 100 QRs per bill, ₹1,99,900 per collection",
  "Provider-verified sequential collection (demo + live PSP modes)",
  "Fraud Shield: exact-amount and one-proof-one-QR guards",
  "Offline queueing with automatic sync",
  "Mobile PWA with installable home-screen app",
] as const;

export function PricingStrip() {
  return (
    <section id="pricing" className="scroll-mt-24 bg-white dark:bg-[#0f172a] py-20 lg:py-28" aria-labelledby="pricing-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="pricing-title"
          kicker="Pricing"
          title={
            <>
              Simple transparent pricing, <span className="text-gradient">no hidden fees</span>
            </>
          }
          subtitle="There is one plan. It is free, and there is nothing to upgrade to."
        />
        <Reveal delay={0.1} className="mx-auto mt-14 max-w-xl">
          <div className="relative overflow-hidden rounded-3xl border border-[#121a26]/10 dark:border-[#e2e8f0]/15 bg-[#121a26] dark:bg-[#1e293b] p-8 text-center text-white shadow-[0_30px_70px_-24px_rgba(18,26,38,0.5)] sm:p-10">
            <span aria-hidden="true" className="monks-num monks-num-light">
              ₹0
            </span>
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#87e64b]">One simple plan</p>
            <p className="mt-3 text-[44px] font-bold tabular-nums tracking-tight sm:text-[52px]">
              ₹0<span className="text-[16px] font-semibold text-white/60"> /month</span>
            </p>
            <ul className="mx-auto mt-6 max-w-md space-y-2.5 text-left">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-white/80">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#87e64b]/15">
                    <Check size={12} strokeWidth={3} className="text-[#87e64b]" aria-hidden="true" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <a
                href="/app"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-[#87e64b] px-8 text-[15px] font-semibold text-[#121a26] transition-all hover:-translate-y-0.5"
              >
                Open the app — free
              </a>
              <a
                href="#how-it-works"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-8 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/30 transition-all hover:bg-white/10"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 text-[12px] text-white/50">No paid tiers. No trials that expire. No cards required.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
