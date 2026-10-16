"use client";

import Link from "next/link";
import { Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Sticky mobile-only CTA bar fixed to the bottom of the screen.
 * Hidden on desktop. Safe-area aware for iPhone home indicator.
 */
export function MobileCtaBar() {
  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-[60] md:hidden"
      style={{ paddingBottom: `env(safe-area-inset-bottom)` }}
    >
      <div className="mx-auto flex max-w-[600px] flex-col items-center justify-center gap-2 px-4 py-3 border-t border-[#e5e7eb]/60 dark:border-[#e2e8f0]/20 bg-white/90 dark:bg-[#0f172a]/95 backdrop-blur-md shadow-[0_-10px_30px_-10px_rgba(18,26,38,0.15)]">
        <div className="flex w-full items-center justify-between gap-3">
          <Button
            asChild
            size="sm"
            className="flex-1 bg-[#87e64b] px-4 py-2.5 text-[13px] font-semibold text-[#121a26] shadow-[0_6px_16px_-6px_rgba(135,230,75,0.4)] hover:bg-[#7bd63f] hover:text-[#121a26]"
          >
            <Link href="/app">
              <Smartphone size={14} className="mr-1.5" aria-hidden="true" />
              Open app
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="flex-1 px-4 py-2.5 text-[13px] font-medium text-[#121a26] dark:text-[#f8fafc] hover:bg-[#121a26]/5 dark:hover:bg-[#e2e8f0]/10"
          >
            <Link href="#how-it-works">How it works</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
