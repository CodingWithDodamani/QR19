"use client";

import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { ArrowRight, Menu, QrCode, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#psp-console", label: "PSP console" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
  { href: "/app", label: "Mobile app" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announceVisible, setAnnounceVisible] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Post-hydration only: localStorage differs between server and client.
    try {
      if (window.localStorage.getItem("qr19-ann-dismissed") !== "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync; cannot be computed during render without breaking hydration.
        setAnnounceVisible(true);
      }
    } catch {
      // private mode — show once per load
      setAnnounceVisible(true);
    }
  }, []);

  function dismissAnnounce() {
    try {
      window.localStorage.setItem("qr19-ann-dismissed", "1");
    } catch {
      // ignore
    }
    setAnnounceVisible(false);
  }

  return (
    <motion.header
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-[#e5e7eb]/80 dark:border-[#e2e8f0]/20 bg-white/85 dark:bg-[#0f172a]/90 shadow-[0_1px_16px_-6px_rgba(18,26,38,0.12)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      {/* Scroll progress */}
      <motion.div
        aria-hidden="true"
        style={{ scaleX: progress }}
        className="absolute inset-x-0 top-0 h-[2.5px] origin-left bg-gradient-to-r from-[#635bff] via-[#9d7bff] to-[#00baf2]"
      />

      <AnimatePresence>
        {announceVisible && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden bg-[#121a26]"
          >
            <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center sm:px-6 lg:px-8">
              <Sparkles size={13} className="shrink-0 text-[#87e64b]" aria-hidden="true" />
              <p className="truncate text-[12px] font-medium text-white">
                New · Offline-ready mobile app —{" "}
                <a href="/app" className="font-semibold text-[#87e64b] underline underline-offset-4 hover:text-white">
                  open it here
                </a>
              </p>
              <button
                type="button"
                onClick={dismissAnnounce}
                aria-label="Dismiss announcement"
                className="grid size-7 shrink-0 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8" aria-label="Main">
        <Link href="#top" className="group flex items-center gap-2.5" aria-label="QR19 home">
          <span className="grid size-9 place-items-center rounded-xl bg-[#121a26] text-white shadow-[0_6px_18px_-6px_rgba(18,26,38,0.6)] transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
            <QrCode size={18} aria-hidden="true" />
          </span>
          <span className="text-[19px] font-bold tracking-tight text-[#121a26] dark:text-[#f8fafc]">
            QR<span className="text-gradient">19</span>
          </span>
        </Link>

        <div className="ml-8 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-[#5d708c] dark:text-[#94a3b8] transition-colors hover:bg-[#121a26]/5 dark:hover:bg-[#e2e8f0]/10 hover:text-[#121a26] dark:hover:text-[#f8fafc]"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button asChild className="cta-shimmer group rounded-full bg-[#87e64b] px-5 font-semibold text-[#121a26] shadow-[0_8px_22px_-8px_rgba(135,230,75,0.7)] hover:bg-[#7bd63f] hover:text-[#121a26]">
            <a href="/app">
              Open app
              <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
            </a>
          </Button>
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-[#121a26]/10 dark:bg-[#e2e8f0]/20" />
          <ThemeToggle className="rounded-full border border-[#121a26]/10 dark:border-[#e2e8f0]/20 text-[#121a26] dark:text-[#f8fafc] hover:bg-[#121a26]/5 dark:hover:bg-[#e2e8f0]/10" />
        </div>

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <ThemeToggle />
        <button
          type="button"
          className="ml-auto grid size-10 place-items-center rounded-lg text-[#121a26] dark:text-[#f8fafc] transition-colors hover:bg-[#121a26]/5 dark:hover:bg-[#e2e8f0]/10 md:hidden"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-b border-[#e5e7eb]/70 dark:border-[#e2e8f0]/20 bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-xl md:hidden"
          >
            <div className="space-y-1 px-4 py-4">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-[15px] font-medium text-[#5d708c] dark:text-[#94a3b8] transition-colors hover:bg-[#121a26]/5 dark:hover:bg-[#e2e8f0]/10 hover:text-[#121a26] dark:hover:text-[#f8fafc]"
                >
                  {link.label}
                </a>
              ))}
              <Button asChild className="mt-2 w-full rounded-full bg-[#87e64b] font-semibold text-[#121a26] hover:bg-[#7bd63f] hover:text-[#121a26]">
                <a href="/app" onClick={() => setMenuOpen(false)}>
                  Open app
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
