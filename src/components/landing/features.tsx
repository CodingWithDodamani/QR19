"use client";

import { motion } from "framer-motion";
import {
  Check,
  Copy,
  Download,
  Link2,
  Lock,
  Printer,
  ScanLine,
  Smartphone,
  Split,
  Wallet,
} from "lucide-react";

import { BhimIcon, GooglePayIcon, PaytmIcon, PhonePeIcon } from "@/components/upi-pay/app-icons";
import { QrGlyph } from "@/components/landing/qr-illustration";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";
import { useSpotlight } from "@/components/landing/spotlight";

const CHECKS = ["No setup fee", "No transaction fee", "No subscription", "No surprises"];

const TRUST_ICONS = [
  { id: "phonepe", name: "PhonePe", Icon: PhonePeIcon },
  { id: "gpay", name: "Google Pay", Icon: GooglePayIcon },
  { id: "paytm", name: "Paytm", Icon: PaytmIcon },
  { id: "bhim", name: "BHIM", Icon: BhimIcon },
] as const;

export function Features() {
  const spotlight = useSpotlight<HTMLDivElement>();
  return (
    <section id="features" className="scroll-mt-24 py-20 lg:py-28" aria-labelledby="features-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="features-title"
          kicker="Features"
          title={
            <>
              Everything you need to collect,{" "}
              <span className="text-gradient">nothing you don&rsquo;t</span>
            </>
          }
          subtitle="A tiny tool with a single obsession: making sure every rupee you're owed actually reaches you."
        />

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-6">
          {/* Smart splitting — large bento cell */}
          <Reveal className="md:col-span-4" delay={0}>
            <div ref={spotlight} className="spotlight bento-card bento-violet flex h-full flex-col gap-6 p-6 sm:p-7 lg:flex-row lg:items-center">
              <div
                className="pointer-events-none absolute -left-14 -top-14 size-48 rounded-full bg-[#635bff]/8 blur-2xl"
                aria-hidden="true"
              />
              <div className="relative max-w-sm shrink-0">
                <span className="grid size-12 place-items-center rounded-xl bg-[#eeedf9] text-[#5140b5]">
                  <Split size={22} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold text-[#26364a]">Smart splitting, zero math</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#65748b]">
                  Type any amount — QR19 chops it into ₹1,999 chunks and puts the exact remainder on the final code.
                  Every rupee is accounted for.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#635bff]/20 bg-[#635bff]/6 px-3 py-1 text-[11.5px] font-semibold text-[#5140b5]">
                    Up to 100 QR codes
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f5a623]/30 bg-[#f5a623]/10 px-3 py-1 text-[11.5px] font-semibold text-[#9a6206]">
                    ₹1,99,900 in one go
                  </span>
                </div>
              </div>
              <div className="relative min-w-0 flex-1 space-y-3.5" aria-hidden="true">
                {[
                  { label: "₹5,000 you're owed", width: "100%", tone: "bg-[#c9c4ff]", animate: false },
                  { label: "₹1,999", width: "40%", tone: "bg-[#635bff]", animate: true },
                  { label: "₹1,999", width: "40%", tone: "bg-[#635bff]", animate: true },
                  { label: "₹1,002 remainder", width: "20%", tone: "bg-[#f5a623]", animate: true },
                ].map((bar, i) => (
                  <div key={`${bar.label}-${i}`}>
                    <div className="h-6 overflow-hidden rounded-md bg-[#f3f5f9]">
                      {bar.animate ? (
                        <motion.div
                          initial={{ width: "0%" }}
                          whileInView={{ width: bar.width }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.3 + i * 0.18, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                          className={`h-full rounded-md ${bar.tone}`}
                        />
                      ) : (
                        <div className={`h-full rounded-md ${bar.tone}`} style={{ width: bar.width }} />
                      )}
                    </div>
                    <div className="mt-1 text-[10.5px] font-medium text-[#8b96a8]">{bar.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Zero fees — medium bento cell */}
          <Reveal className="md:col-span-2" delay={0.08}>
            <div ref={spotlight} className="spotlight bento-card bento-saffron flex h-full flex-col p-6 sm:p-7">
              <div
                className="pointer-events-none absolute -right-10 -top-10 size-44 rounded-full bg-[#f5a623]/10 blur-2xl"
                aria-hidden="true"
              />
              <div className="feature-visual relative flex items-center justify-between">
                <div className="relative">
                  <span className="text-[52px] font-bold leading-none tracking-tight text-[#26364a] sm:text-[58px]">
                    ₹<span className="text-[#f5a623]">0</span>
                  </span>
                  <motion.span
                    initial={{ scale: 0, rotate: -30 }}
                    whileInView={{ scale: 1, rotate: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5, type: "spring", stiffness: 260, damping: 16 }}
                    className="absolute -right-9 -top-1 grid size-7 place-items-center rounded-full bg-[#e5f5ed] text-[#16754b] shadow-sm"
                    aria-hidden="true"
                  >
                    <Check size={14} strokeWidth={3} />
                  </motion.span>
                </div>
                <span className="grid size-12 place-items-center rounded-xl bg-[#fdf3e0] text-[#c07a08]">
                  <Wallet size={22} aria-hidden="true" />
                </span>
              </div>
              <h3 className="relative mt-5 text-[17px] font-semibold text-[#26364a]">Zero fees. Really.</h3>
              <p className="relative mt-1.5 text-[13.5px] leading-relaxed text-[#65748b]">
                QR19 doesn&rsquo;t take a cut, rent, or subscription. The amount on the QR is the amount that reaches you.
              </p>
              <ul className="relative mt-4 grid grid-cols-2 gap-x-3 gap-y-2">
                {CHECKS.map((check) => (
                  <li key={check} className="flex items-center gap-2 text-[12.5px] font-medium text-[#58667a]">
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-[#e5f5ed]">
                      <Check size={9} strokeWidth={3.5} className="text-[#16754b]" aria-hidden="true" />
                    </span>
                    {check}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* Private by physics — small bento cell */}
          <Reveal className="md:col-span-2" delay={0}>
            <div ref={spotlight} className="spotlight bento-card bento-purple flex h-full flex-col p-6 sm:p-7">
              <div
                className="pointer-events-none absolute -bottom-12 -left-10 size-40 rounded-full bg-[#5f259f]/10 blur-2xl"
                aria-hidden="true"
              />
              <div className="feature-visual flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-xl bg-[#30245c] text-[#b9aaff] shadow-[0_10px_26px_-8px_rgba(48,36,92,0.6)]">
                  <Lock size={20} aria-hidden="true" />
                </span>
                <div className="h-8 w-px bg-[#e3e8ef]" aria-hidden="true" />
                <div className="flex items-center gap-1.5 rounded-lg border border-[#e3e8ef] bg-[#f7f9fc] px-3 py-2">
                  <span className="size-2 rounded-full bg-[#2fbf75]" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-[#58667a]">100% on-device</span>
                </div>
              </div>
              <h3 className="relative mt-5 text-[16px] font-semibold text-[#26364a]">Private by physics</h3>
              <p className="relative mt-1.5 text-[13px] leading-relaxed text-[#65748b]">
                UPI IDs, names, amounts — everything is generated inside your browser. There is no server to send it to,
                so it never leaves your device.
              </p>
            </div>
          </Reveal>

          {/* Every UPI app — small bento cell */}
          <Reveal className="md:col-span-2" delay={0.08}>
            <div ref={spotlight} className="spotlight bento-card bento-green flex h-full flex-col p-6 sm:p-7">
              <div
                className="pointer-events-none absolute -bottom-12 -right-10 size-40 rounded-full bg-[#0d7d4d]/10 blur-2xl"
                aria-hidden="true"
              />
              <div className="feature-visual flex -space-x-2.5">
                {TRUST_ICONS.map(({ id, name, Icon }, i) => (
                  <motion.span
                    key={id}
                    title={name}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + i * 0.07, type: "spring", stiffness: 300, damping: 18 }}
                    className="grid size-10 place-items-center rounded-full border-2 border-white bg-white shadow-sm"
                  >
                    <Icon className="size-6" aria-label={name} />
                  </motion.span>
                ))}
                <motion.span
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.6, type: "spring", stiffness: 300, damping: 14 }}
                  className="grid size-10 place-items-center rounded-full border-2 border-white bg-[#0d7d4d] text-[11px] font-bold text-white shadow-md"
                  aria-hidden="true"
                >
                  +4
                </motion.span>
              </div>
              <h3 className="relative mt-5 text-[16px] font-semibold text-[#26364a]">Every UPI app scans it</h3>
              <p className="relative mt-1.5 text-[13px] leading-relaxed text-[#65748b]">
                Standard UPI deep links — if an app can pay, it can pay your QR.
              </p>
            </div>
          </Reveal>

          {/* Share anywhere — small bento cell */}
          <Reveal className="md:col-span-2" delay={0.16}>
            <div ref={spotlight} className="spotlight bento-card bento-cyan flex h-full flex-col p-6 sm:p-7">
              <div
                className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[#00baf2]/12 blur-2xl"
                aria-hidden="true"
              />
              <div className="feature-visual flex flex-wrap items-center gap-2">
                {[
                  { icon: Download, label: "PNG" },
                  { icon: Printer, label: "Print" },
                  { icon: Link2, label: "Link" },
                  { icon: Copy, label: "Copy" },
                ].map(({ icon: Icon, label }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#e3e8ef] bg-white px-2.5 py-2 text-[11px] font-medium text-[#58667a] shadow-[0_1px_2px_rgba(36,54,75,0.05)]"
                  >
                    <Icon size={13} className="text-[#0092c0]" aria-hidden="true" />
                    {label}
                  </span>
                ))}
              </div>
              <h3 className="relative mt-5 text-[16px] font-semibold text-[#26364a]">Share anywhere</h3>
              <p className="relative mt-1.5 text-[13px] leading-relaxed text-[#65748b]">
                Download PNGs, print sheets for your shop, or keep them in your gallery.
              </p>
            </div>
          </Reveal>
        </div>

        {/* Bottom assurance strip */}
        <Reveal delay={0.15}>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#c9cede] bg-white/60 px-6 py-5 text-center sm:flex-row sm:gap-8">
            <span className="flex items-center gap-2 text-[13px] font-medium text-[#58667a]">
              <ScanLine size={16} className="text-[#635bff]" aria-hidden="true" />
              Standard UPI deep links
            </span>
            <span className="hidden h-4 w-px bg-[#d5dce6] sm:block" aria-hidden="true" />
            <span className="flex items-center gap-2 text-[13px] font-medium text-[#58667a]">
              <Smartphone size={16} className="text-[#635bff]" aria-hidden="true" />
              Works on any phone, any browser
            </span>
            <span className="hidden h-4 w-px bg-[#d5dce6] sm:block" aria-hidden="true" />
            <span className="flex items-center gap-2 text-[13px] font-medium text-[#58667a]">
              <QrGlyph size={16} className="text-[#635bff]" />
              No app install needed
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
