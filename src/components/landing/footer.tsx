"use client";

import { ArrowUp, BadgeCheck, Github, Heart, QrCode, ShieldCheck, Twitter, Zap } from "lucide-react";
import Link from "next/link";

const LINK_GROUPS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "PSP console", href: "#psp-console" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Collect",
    links: [
      { label: "Mobile app", href: "/app" },
      { label: "Find recipient", href: "/app" },
      { label: "Fraud shield", href: "#safety" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "GitHub", href: "https://github.com/CodingWithDodamani/QR19", external: true },
      { label: "Report an issue", href: "https://github.com/CodingWithDodamani/QR19/issues", external: true },
      { label: "Follow on X", href: "https://x.com/aspizu_", external: true },
    ],
  },
];

const TRUST_POINTS = [
  { icon: Zap, label: "₹0 fees · ₹1,999 per QR" },
  { icon: ShieldCheck, label: "Provider-verified only" },
  { icon: BadgeCheck, label: "Works offline" },
];

const SOCIALS = [
  { icon: Twitter, href: "https://x.com/aspizu_", label: "X (Twitter)" },
  { icon: Github, href: "https://github.com/CodingWithDodamani/QR19", label: "GitHub" },
];

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t dark:border-[#e2e8f0]/20 dark:bg-[#121a26]/70 bg-white/70 backdrop-blur">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#635bff]/50 to-transparent"
      />
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <ul className="mb-10 flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
          {TRUST_POINTS.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e3e8ef] dark:border-[#e2e8f0]/20 bg-white dark:bg-[#1e293b] px-3 py-1.5 text-[12px] font-semibold text-[#40506a] dark:text-[#cbd5e1]"
            >
              <Icon size={13} className="text-[#16a34a] dark:text-[#4ade80]" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Link href="#top" className="flex w-fit items-center gap-2.5" aria-label="QR19 home">
              <span className="grid size-9 place-items-center rounded-xl bg-[#121a26] text-white shadow-[0_6px_18px_-6px_rgba(18,26,38,0.6)]">
                <QrCode size={18} aria-hidden="true" />
              </span>
              <span className="text-[19px] font-bold tracking-tight text-[#121a26] dark:text-white">
                QR<span className="text-gradient">19</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-[#65748b] dark:text-[#94a3b8]">
              Split any amount into UPI QR codes of ₹1,999 or less and collect the
              full amount — with zero fees, entirely on your device.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {SOCIALS.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="grid size-9 place-items-center rounded-lg border border-[#e3e8ef] dark:border-[#e2e8f0]/20 bg-white dark:bg-[#1e293b] text-[#58667a] dark:text-[#cbd5e1] transition-all hover:-translate-y-0.5 hover:border-[#635bff]/40 dark:hover:border-[#87e64b]/40 hover:text-[#121a26] dark:hover:text-[#e2e8f0]"
                >
                  <Icon size={16} aria-hidden="true" />
                </a>
              ))}
              <button
                type="button"
                onClick={scrollToTop}
                aria-label="Back to top"
                className="grid size-9 place-items-center rounded-lg border border-[#e3e8ef] dark:border-[#e2e8f0]/20 bg-white dark:bg-[#1e293b] text-[#58667a] dark:text-[#cbd5e1] transition-all hover:-translate-y-0.5 hover:text-[#121a26] dark:hover:text-[#e2e8f0]"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {LINK_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8b96a8] dark:text-[#94a3b8]">
                {group.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 text-[13.5px] font-medium text-[#58667a] dark:text-[#94a3b8] transition-colors hover:text-[#121a26] dark:hover:text-[#e2e8f0]"
                      >
                        <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                          {link.label}
                        </span>
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        className="group inline-flex items-center gap-1 text-[13.5px] font-medium text-[#58667a] dark:text-[#94a3b8] transition-colors hover:text-[#121a26] dark:hover:text-[#e2e8f0]"
                      >
                        <span className="transition-transform duration-200 group-hover:translate-x-0.5">
                          {link.label}
                        </span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 space-y-4 border-t dark:border-[#e2e8f0]/10 border-[#eef0f6] pt-6">
          <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
            <p className="text-[12px] text-[#8b96a8] dark:text-[#94a3b8]">
              Just for laughs. Not recommended for actual use. We’re not lawyers, and
              this isn’t legal advice.
            </p>
            <p className="inline-flex items-center gap-1.5 text-[12px] text-[#8b96a8] dark:text-[#94a3b8]">
              © {new Date().getFullYear()} QR19 · Crafted with{" "}
              <Heart size={12} className="fill-[#e5484d] text-[#e5484d]" aria-label="love" />{" "}
              by{" "}
              <a
                href="https://github.com/CodingWithDodamani"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#5140b5] underline decoration-[#c9c4ff] underline-offset-3 transition-colors hover:text-[#635bff]"
              >
                Dodamani_Hallu
              </a>
            </p>
          </div>
          <div className="flex flex-col items-center justify-between gap-2 border-t border-dashed border-[#eef0f6] dark:border-[#e2e8f0]/20 pt-4 text-center sm:flex-row sm:items-start sm:text-left">
            <p className="inline-flex items-center gap-2 text-[11.5px] leading-relaxed text-[#8b96a8] dark:text-[#94a3b8]">
              <span className="tricolor-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Demo build — payment verification runs on a clearly-labeled demo processor
              until your own PSP keys are connected in the console.
            </p>
            <p className="shrink-0 text-[11.5px] leading-relaxed text-[#8b96a8] dark:text-[#94a3b8]">
              UPI is a product of NPCI. QR19 is not affiliated with NPCI or any payment app.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
