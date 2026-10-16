"use client";

import { motion } from "framer-motion";
import { BadgeCheck, Keyboard, ScanLine } from "lucide-react";

import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";
import { useSpotlight } from "@/components/landing/spotlight";

const STEPS = [
  {
    icon: Keyboard,
    step: "01",
    title: "Enter details & split",
    copy: "Type your UPI ID, the full amount you're owed and an optional note. QR19 splits it into ₹1,999-or-less codes — nothing is uploaded.",
    node: "from-[#635bff] to-[#8b5cf6]",
    badge: "bg-[#635bff]",
    label: "text-[#635bff]",
    glow: "hover:border-[#635bff]/35 hover:shadow-[0_22px_48px_-20px_rgba(99,91,255,0.45)]",
  },
  {
    icon: ScanLine,
    step: "02",
    title: "Show the QR, collect scans",
    copy: "Display one code at a time. Your customer scans each with any UPI app and pays the exact amount shown.",
    node: "from-[#00baf2] to-[#0092c0]",
    badge: "bg-[#0092c0]",
    label: "text-[#0092c0]",
    glow: "hover:border-[#00baf2]/40 hover:shadow-[0_22px_48px_-20px_rgba(0,186,242,0.45)]",
  },
  {
    icon: BadgeCheck,
    step: "03",
    title: "Verified advance, auto next",
    copy: "The next QR appears only after the provider confirms the previous payment — exact amount, one proof per code. Nothing advances on screenshots.",
    node: "from-[#0d7d4d] to-[#11a05f]",
    badge: "bg-[#0d7d4d]",
    label: "text-[#0d7d4d]",
    glow: "hover:border-[#0d7d4d]/40 hover:shadow-[0_22px_48px_-20px_rgba(13,125,77,0.45)]",
  },
] as const;

export function HowItWorks() {
  const spotlight = useSpotlight<HTMLDivElement>();
  return (
    <section
      id="how-it-works"
      className="relative scroll-mt-24 overflow-hidden bg-white py-20 lg:py-28"
      aria-labelledby="how-title"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-0 -z-0 size-[560px] -translate-x-1/2 rounded-full bg-[#635bff]/6 blur-[120px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="how-title"
          kicker="How it works"
          title={
            <>
              From amount to paid in <span className="text-gradient">three scans</span>
            </>
          }
          subtitle="No signup, no bank linking, no verification. The whole flow takes under a minute."
        />

        <ol className="relative mt-16 grid grid-cols-1 gap-14 md:grid-cols-3 md:gap-8">
          {/* Animated dashed connector (desktop) */}
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            whileInView={{ scaleX: 1, opacity: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
            className="absolute left-[17%] right-[17%] top-[31px] hidden h-[3px] origin-left overflow-hidden rounded-full md:block"
            aria-hidden="true"
          >
            <div className="hiw-dash h-full w-full" />
          </motion.div>

          {STEPS.map((step, index) => (
            <Reveal
              key={step.step}
              as="li"
              delay={0.12 * index}
              className="relative flex h-full flex-col items-center text-center"
            >
              <div className="relative z-10 -mb-8">
                <span
                  className={`step-node grid size-16 place-items-center rounded-2xl bg-gradient-to-br text-white ring-4 ring-white ${step.node}`}
                >
                  <step.icon size={26} aria-hidden="true" />
                </span>
                <span
                  className={`absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border-2 border-white text-[10px] font-bold text-white ${step.badge}`}
                >
                  {index + 1}
                </span>
              </div>

              <div
                ref={spotlight}
                className={`spotlight flex w-full flex-1 flex-col rounded-2xl border border-[#e3e8ef] dark:border-[#e2e8f0]/20 bg-white dark:bg-[#1e293b] px-6 pb-6 pt-12 transition-all duration-300 hover:-translate-y-[3px] ${step.glow}`}
              >
                <span aria-hidden="true" className="monks-num">
                  {step.step}
                </span>
                <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${step.label}`}>
                  Step {step.step}
                </span>
                <h3 className="mt-1.5 text-[18px] font-semibold tracking-tight text-[#26364a] dark:text-[#f8fafc]">{step.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[#65748b] dark:text-[#94a3b8]">{step.copy}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
