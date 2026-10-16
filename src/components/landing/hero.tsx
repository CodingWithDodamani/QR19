"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Check, ShieldCheck, Smartphone, Zap } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { GradientWave } from "@/components/landing/gradient-wave";
import { PhoneMockup } from "@/components/landing/phone-mockup";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Green-and-white wave bands; module-level so the
 *  shader effect never re-initializes on re-render. */
const HERO_WAVE_COLORS = ["#4ade80", "#ffffff", "#22c55e", "#f0fdf4", "#4ade80", "#ffffff"];

/**
 * Animated counter: counts from 0 to `target` when the element enters the viewport.
 * Respects prefers-reduced-motion (shows final value instantly).
 */
function CountUp({ target, formatter, prefersReducedMotion }: { target: number; formatter: (n: number) => string; prefersReducedMotion: boolean }) {
  const [displayed, setDisplayed] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion || hasAnimated.current) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let rafId = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        hasAnimated.current = true;
        observer.disconnect();
        const start = performance.now();
        const duration = 1.2; // seconds
        const step = (now: number) => {
          if (cancelled) return;
          const elapsed = (now - start) / 1000;
          const progress = Math.min(elapsed / duration, 1);
          // ease-out-cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          if (progress < 1) {
            setDisplayed(Math.floor(eased * target));
            rafId = requestAnimationFrame(step);
          } else {
            setDisplayed(target);
          }
        };
        rafId = requestAnimationFrame(step);
      },
      { threshold: 0.1, rootMargin: "-10% 0px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [prefersReducedMotion, target]);

  // Reduced-motion users see the final value immediately (no animation state).
  const value = prefersReducedMotion ? target : displayed;
  return (
    <span ref={ref}>{formatter(value)}</span>
  );
}

const PROOFS = [
  { value: 1999, label: "Max per QR", formatter: (n: number) => `₹${n.toLocaleString()}` },
  { value: 0, label: "Platform fees", formatter: (n: number) => `₹${n.toLocaleString()}` },
  { value: 100, label: "Orders per batch", formatter: (n: number) => `${n}` },
] as const;

export function Hero() {
  const prefersReducedMotion = useReducedMotion() === true;

  // Subtle mouse parallax for the floating chips (fine pointers only)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 55, damping: 18 });
  const sy = useSpring(my, { stiffness: 55, damping: 18 });
  const chip1X = useTransform(sx, (v) => v * 26);
  const chip1Y = useTransform(sy, (v) => v * 18);
  const chip3X = useTransform(sx, (v) => v * 12);
  const chip3Y = useTransform(sy, (v) => v * -10);

  function handleMouseMove(event: MouseEvent<HTMLElement>) {
    if (prefersReducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    mx.set((event.clientX - rect.left) / rect.width - 0.5);
    my.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  return (
    <section
      id="top"
      onMouseMove={handleMouseMove}
      className="relative overflow-hidden bg-[#4ade80] dark:bg-[#166534] pb-16 pt-32 sm:pt-36 lg:pb-24"
    >
      {/* Animated WebGL gradient band (warm fallback color if WebGL is off) */}
      <GradientWave colors={HERO_WAVE_COLORS} isPlaying={!prefersReducedMotion} />

      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 text-center sm:px-6 lg:px-8">
        <motion.h1
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
          className="text-display-xl font-display mx-auto mt-5 flex w-full max-w-3xl flex-col items-center justify-center text-center font-bold text-[#121a26] dark:text-white lg:max-w-4xl lg:text-[76px] lg:leading-[1.02] lg:tracking-[-0.04em] lg:[text-indent:-0.04em]"
        >
          <span className="block w-full text-center">Collect every rupee.</span>
          <span className="block w-full text-center">Pay ₹0 fees.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.14, ease: EASE }}
          className="mt-4 text-center text-[15px] font-semibold tracking-tight text-[#121a26] dark:text-[#e2e8f0] sm:text-base"
        >
          Bade amount? Chhote QR codes. Sab auto.
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.18, ease: EASE }}
          className="mx-auto mt-2 max-w-xl text-pretty text-center text-[16px] leading-relaxed text-[#40506a] dark:text-[#94a3b8] sm:text-[17px]"
        >
          Split any bill into UPI QR codes of ₹1,999 or less and collect them one
          verified payment at a time — no setup, no transaction fees, no middlemen.
          Each code completes only when your provider confirms it.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.24, ease: EASE }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Button
            asChild
            size="lg"
            className="cta-shimmer group h-12 rounded-full bg-[#121a26] dark:bg-[#e2e8f0] px-7 text-[15px] font-semibold text-white dark:text-[#121a26] shadow-[0_14px_34px_-10px_rgba(18,26,38,0.55)] transition-all hover:-translate-y-0.5 hover:bg-black hover:text-white hover:shadow-[0_18px_40px_-10px_rgba(18,26,38,0.65)] dark:hover:bg-[#cbd5e1]"
          >
            <a href="/app">
              <Smartphone size={17} aria-hidden="true" />
              Open the app
              <ArrowRight size={17} className="transition-transform duration-300 ease-out group-hover:translate-x-1" aria-hidden="true" />
            </a>
          </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="btn-shine group h-12 rounded-full border-[#121a26]/15 dark:border-[#e2e8f0]/20 bg-white/70 dark:bg-[#121a26]/20 px-7 text-[15px] font-semibold text-[#121a26] dark:text-[#e2e8f0] backdrop-blur transition-all hover:-translate-y-0.5 hover:border-[#121a26]/30 hover:text-[#121a26] dark:hover:border-[#e2e8f0]/30 dark:hover:text-[#e2e8f0]"
            >
              <a href="#how-it-works">
                <Zap size={17} aria-hidden="true" />
                See how it works
                <ArrowRight size={15} className="transition-transform duration-300 ease-out group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.32 }}
          className="mt-4 text-center text-[12.5px] font-medium text-[#40506a] dark:text-[#94a3b8]"
        >
          Installable PWA for iOS &amp; Android · Works offline
        </motion.p>

        {/* -------- App visual -------- */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 36 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.28, ease: EASE }}
          className="relative mx-auto mt-12 w-fit"
        >
          <div
            className="absolute left-1/2 top-1/2 -z-10 size-[115%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25 blur-[70px]"
            aria-hidden="true"
          />
          <PhoneMockup screen="collect" />

          {/* Floating chip: payment received */}
          <motion.div
            style={{ x: chip1X, y: chip1Y }}
            className="absolute -right-6 top-24 hidden sm:block lg:-right-20"
          >
            <motion.div
              animate={prefersReducedMotion ? undefined : { y: [0, -12, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
              className="flex items-center gap-2.5 rounded-xl bg-white/95 dark:bg-[#1e293b]/90 p-3 pr-4 text-left shadow-[0_18px_44px_-14px_rgba(36,54,75,0.35)] ring-1 ring-[#121a26]/10 dark:ring-[#e2e8f0]/10 backdrop-blur"
            >
              <span className="anim-ring grid size-9 place-items-center rounded-full bg-[#e5f5ed] text-[#16754b]">
                <Check size={16} strokeWidth={2.5} aria-hidden="true" />
              </span>
              <div>
                <div className="text-[12px] font-semibold text-[#121a26] dark:text-[#f8fafc]">Payment received</div>
                <div className="text-[11px] tabular-nums text-[#16754b] dark:text-[#4ade80]">₹1,999.00 · just now</div>
              </div>
            </motion.div>
          </motion.div>

          {/* Floating chip: privacy */}
          <motion.div
            style={{ x: chip3X, y: chip3Y }}
            className="absolute -top-2 left-0 hidden md:block lg:-left-10"
          >
            <motion.div
              animate={prefersReducedMotion ? undefined : { y: [0, -9, 0] }}
              transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
              className="flex items-center gap-2 rounded-full bg-[#121a26] px-3.5 py-2 text-[11px] font-medium text-white shadow-[0_14px_34px_-10px_rgba(18,26,38,0.55)]"
            >
              <ShieldCheck size={13} className="text-[#87e64b]" aria-hidden="true" />
              Details never leave your device
            </motion.div>
          </motion.div>
        </motion.div>

        {/* -------- Proof chips -------- */}
        <motion.dl
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: EASE }}
          className="mx-auto mt-12 flex max-w-2xl flex-col items-center justify-center gap-4 sm:flex-row sm:items-stretch sm:gap-0"
        >
          {PROOFS.map((proof, i) => (
            <div
              key={proof.label}
              className={`flex items-center justify-center gap-3 text-center sm:flex-1 sm:flex-col sm:justify-center sm:gap-1 ${
                i > 0 ? "sm:border-l sm:border-[#121a26]/10 dark:border-[#e2e8f0]/10" : ""
              }`}
            >
              <dd className="text-[22px] font-bold tabular-nums tracking-tight text-[#121a26] dark:text-[#f8fafc] sm:text-[26px]">
                <CountUp target={proof.value} formatter={proof.formatter} prefersReducedMotion={prefersReducedMotion} />
              </dd>
              <dt className="text-[13px] font-medium text-[#40506a] dark:text-[#94a3b8]">{proof.label}</dt>
            </div>
          ))}
        </motion.dl>
      </div>
    </section>
  );
}
