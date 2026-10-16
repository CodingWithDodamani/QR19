"use client";

import { LockKeyhole } from "lucide-react";

import { QrTool } from "@/components/qr19/qr-tool";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

export function Demo() {
  return (
    <section id="try" className="demo-shell scroll-mt-24 py-20 lg:py-28" aria-labelledby="try-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="try-title"
          kicker="Live demo"
          title={
            <>
              Try it right here — <span className="text-gradient">it&rsquo;s already running</span>
            </>
          }
          subtitle="This is the real tool, not a screenshot. Fill it in, generate codes, download them. Nothing is sent anywhere."
        />

        <Reveal delay={0.12} className="relative mx-auto mt-14 max-w-4xl">
          {/* Soft ring glow behind the glass card */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-4 -z-10 rounded-[32px] bg-gradient-to-br from-[#635bff]/16 via-transparent to-[#00baf2]/14 blur-2xl sm:-inset-5 sm:rounded-[34px]"
          />

          {/* Gradient hairline ring around the tool */}
          <div className="rounded-[26px] bg-gradient-to-br from-[#635bff]/40 via-[#e3e8ef] to-[#00baf2]/40 p-px shadow-[0_24px_70px_-30px_rgba(36,54,75,0.25)]">
            <div className="rounded-[25px] bg-white/40 p-px backdrop-blur-md">
              <div className="rounded-3xl border border-[#e3e8ef] dark:border-[#e2e8f0]/20 bg-white/50 dark:bg-[#1e293b]/50 p-3 shadow-[0_24px_70px_-30px_rgba(36,54,75,0.25)] backdrop-blur-sm sm:p-6">
                <QrTool />
              </div>
            </div>
          </div>

          <p className="mt-5 flex items-center justify-center gap-2 text-center text-[12px] text-[#8b96a8] dark:text-[#94a3b8]">
            <LockKeyhole size={12} aria-hidden="true" />
            Just for laughs. Not recommended for actual use. We’re not lawyers, and this isn’t legal advice.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
