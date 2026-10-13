"use client";

import { PhoneMockup, type MockScreen } from "@/components/landing/phone-mockup";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

const SCREENS: Array<{ screen: MockScreen; caption: string; sub: string }> = [
  { screen: "home", caption: "Home dashboard", sub: "Verified total, quick actions, recent" },
  { screen: "collect", caption: "Collect & QR", sub: "Split bills, show codes one by one" },
  { screen: "history", caption: "History & QR sheets", sub: "Saved queues, reopen live anytime" },
];

/** App showcase: three phone frames running the real /app screens (CSS mockups). */
export function AppShowcase() {
  return (
    <section id="app-showcase" className="scroll-mt-24 py-20 lg:py-28" aria-labelledby="showcase-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="showcase-title"
          kicker="Inside the app"
          title={
            <>
              A wallet-grade app, <span className="text-gradient">minus the wallet fiction</span>
            </>
          }
          subtitle="Five tabs, one thumb. Everything you see runs on this device against the same verified pipeline as the website."
        />
        <div className="mt-14 grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-6">
          {SCREENS.map(({ screen, caption, sub }, i) => (
            <Reveal key={screen} delay={i * 0.1} className="flex flex-col items-center text-center">
              <PhoneMockup screen={screen} />
              <p className="mt-5 text-[15px] font-semibold text-foreground">{caption}</p>
              <p className="mt-1 max-w-[26ch] text-[13px] leading-relaxed text-muted-foreground">{sub}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
