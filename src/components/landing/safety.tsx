"use client";

import { EyeOff, FileLock2, Webhook } from "lucide-react";

import { Reveal } from "@/components/landing/reveal";

/** Safety band: the real Fraud Shield guarantees, plainly stated. */
const GUARANTEES = [
  {
    Icon: Webhook,
    title: "Provider-signed truth",
    copy: "Only Razorpay / PhonePe / Paytm confirmations — signed webhooks or their status APIs — can complete a QR.",
  },
  {
    Icon: EyeOff,
    title: "Proofs are never input",
    copy: "Screenshots, SMS and forwarded success screens cannot move a queue. The display trusts server state alone.",
  },
  {
    Icon: FileLock2,
    title: "Secrets stay secret",
    copy: "Merchant keys are AES-256-GCM encrypted, masked everywhere, and never appear in logs or responses.",
  },
] as const;

export function Safety() {
  return (
    <section aria-label="Security guarantees" className="relative overflow-hidden bg-[#121a26] py-20 lg:py-24">
      <div
        className="pointer-events-none absolute -left-20 top-0 size-72 rounded-full bg-[#87e64b]/10 blur-[100px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 size-72 rounded-full bg-[#006aff]/15 blur-[100px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
            <span className="size-1.5 rounded-full bg-[#87e64b]" aria-hidden="true" />
            Fraud Shield
          </span>
          <h2 className="mt-4 text-balance text-[28px] font-bold tracking-tight text-white sm:text-[36px]">
            Your money, fully protected
          </h2>
          <p className="mt-3 text-pretty text-[15px] leading-relaxed text-white/65">
            The scams Indian counters actually face — one screenshot shown five times, edited amounts, forged
            confirmations — are blocked structurally, not by vigilance.
          </p>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {GUARANTEES.map(({ Icon, title, copy }, i) => (
            <Reveal key={title} delay={i * 0.08}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
                <span className="grid size-11 place-items-center rounded-xl bg-[#87e64b]/15 text-[#87e64b]">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/60">{copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
