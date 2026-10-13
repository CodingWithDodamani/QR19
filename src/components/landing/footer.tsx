"use client";

import { Github, Globe, QrCode, Twitter } from "lucide-react";
import Link from "next/link";

const LINK_GROUPS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Mobile app", href: "/app" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "Follow on X", href: "https://x.com/aspizu_", external: true },
      { label: "Website", href: "https://aspiz.uk/", external: true },
      { label: "GitHub", href: "https://github.com/aspizu", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-[#e3e8ef] bg-white/70 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Link href="#top" className="flex w-fit items-center gap-2.5" aria-label="QR19 home">
              <span className="grid size-9 place-items-center rounded-xl bg-[#121a26] text-white shadow-[0_6px_18px_-6px_rgba(18,26,38,0.6)]">
                <QrCode size={18} aria-hidden="true" />
              </span>
              <span className="text-[19px] font-bold tracking-tight text-[#121a26]">
                QR<span className="text-gradient">19</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-[#65748b]">
              Split any amount into UPI QR codes of ₹1,999 or less and collect the
              full amount — with zero fees, entirely on your device.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {[
                { icon: Twitter, href: "https://x.com/aspizu_", label: "X (Twitter)" },
                { icon: Github, href: "https://github.com/aspizu", label: "GitHub" },
                { icon: Globe, href: "https://aspiz.uk/", label: "Website" },
              ].map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="grid size-9 place-items-center rounded-lg border border-[#e3e8ef] bg-white text-[#58667a] transition-all hover:-translate-y-0.5 hover:border-[#121a26]/25 hover:text-[#121a26]"
                >
                  <Icon size={16} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>

          {LINK_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8b96a8]">
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
                        className="text-[13.5px] font-medium text-[#58667a] transition-colors hover:text-[#121a26]"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        className="text-[13.5px] font-medium text-[#58667a] transition-colors hover:text-[#121a26]"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 space-y-4 border-t border-[#eef0f6] pt-6">
          <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
            <p className="text-[12px] text-[#8b96a8]">
              Just for laughs. Not recommended for actual use. We’re not lawyers, and
              this isn’t legal advice.
            </p>
            <p className="shrink-0 text-[12px] text-[#8b96a8]">
              © {new Date().getFullYear()} QR19 · Made with{" "}
              <span role="img" aria-label="love">
                ❤️
              </span>{" "}
              by{" "}
              <a
                href="https://aspiz.uk/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#5140b5] underline decoration-[#c9c4ff] underline-offset-3 transition-colors hover:text-[#635bff]"
              >
                aspizu
              </a>
            </p>
          </div>
          <div className="flex flex-col items-center justify-between gap-2 border-t border-dashed border-[#eef0f6] pt-4 text-center sm:flex-row sm:items-start sm:text-left">
            <p className="inline-flex items-center gap-2 text-[11.5px] leading-relaxed text-[#8b96a8]">
              <span className="tricolor-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Demo build — payment verification runs on a clearly-labeled demo processor
              until your own PSP keys are connected in the console.
            </p>
            <p className="shrink-0 text-[11.5px] leading-relaxed text-[#8b96a8]">
              UPI is a product of NPCI. QR19 is not affiliated with NPCI or any payment app.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
