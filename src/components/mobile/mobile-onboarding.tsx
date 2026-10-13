"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, ScanLine, Share2, Wallet } from "lucide-react";

import { tapTick } from "./mobile-shell";

const SLIDES = [
  {
    Icon: Wallet,
    tint: "ep-tint-blue",
    title: "Track every rupee",
    copy: "Verified collections add up on your home dashboard and history — every figure is provider-confirmed, never typed in.",
  },
  {
    Icon: ScanLine,
    tint: "ep-tint-paper",
    title: "Show QR, collect scans",
    copy: "Display one code at a time. Customers scan with any UPI app and pay the exact amount shown.",
  },
  {
    Icon: BadgeCheck,
    tint: "ep-tint-green",
    title: "Verified, not promised",
    copy: "Each code completes only on provider confirmation — never on screenshots, SMS, or forwarded success screens.",
  },
  {
    Icon: Share2,
    tint: "ep-tint-amber",
    title: "Share & sync anywhere",
    copy: "Send payment requests in one tap. Made one offline? It queues on this device and syncs itself when you're back.",
  },
] as const;

const SEEN_KEY = "qr19.offline.v1.onboarded";

/** First-run intro. Shown once (localStorage flag); purely presentational. */
export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;
  const { Icon, tint, title, copy } = SLIDES[index];

  function finish() {
    tapTick();
    try {
      window.localStorage.setItem("qr19.offline.v1.onboarded", "1");
    } catch {
      // private mode — show again next time
    }
    onDone();
  }

  return (
    <div className="ep-onboard">
      <button type="button" className="ep-onboard-skip" onClick={finish}>
        Skip
      </button>
      <div className="ep-onboard-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={index}
            className="ep-onboard-slide"
            initial={{ opacity: 0, x: 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -48 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <span className={`ep-onboard-tile ${tint}`}>
              <Icon size={44} aria-hidden="true" />
            </span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="ep-onboard-dots" aria-hidden="true">
        {SLIDES.map((_, i) => (
          <span key={i} className={i === index ? "ep-dot ep-dot-on" : "ep-dot"} />
        ))}
      </div>
      <button
        type="button"
        className="ep-btn"
        onClick={() => {
          tapTick();
          if (last) finish();
          else setIndex((v) => v + 1);
        }}
      >
        {last ? "Get started" : "Next"}
      </button>
    </div>
  );
}

export function hasSeenOnboarding(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}
