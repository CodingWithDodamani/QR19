import type { Metadata } from "next";
import { MotionConfig } from "framer-motion";

import { AppShowcase } from "@/components/landing/app-showcase";
import { AppsMarquee } from "@/components/landing/apps-marquee";
import { Benefits } from "@/components/landing/benefits";
import { DownloadCta } from "@/components/landing/download-cta";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { MobileCtaBar } from "@/components/landing/mobile-cta-bar";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Navbar } from "@/components/landing/navbar";
import { PricingStrip } from "@/components/landing/pricing-strip";
import { PspConsole } from "@/components/landing/psp-console";
import { Safety } from "@/components/landing/safety";
import { StatsBand } from "@/components/landing/stats-band";
import { Testimonials } from "@/components/landing/testimonials";

export const metadata: Metadata = {
  title: "QR19 — Collect the full amount",
  description:
    "Split any bill into UPI QR codes of ₹1,999 or less and collect the full amount, one provider-verified payment at a time. No signup, works offline.",
};

export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <Navbar />
        <main className="flex-1 pb-[80px] sm:pb-0">
          <Hero />
          <AppsMarquee />
          <StatsBand />
          <Features />
          <HowItWorks />
          <AppShowcase />
          <PspConsole />
          <Benefits />
          <Safety />
          <PricingStrip />
          <Testimonials />
          <DownloadCta />
          <Faq />
        </main>
        <Footer />
        <MobileCtaBar />
      </div>
    </MotionConfig>
  );
}
