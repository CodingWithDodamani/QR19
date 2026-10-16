"use client";

import type { ReactNode } from "react";

import { Reveal } from "@/components/landing/reveal";

interface SectionHeadingProps {
  id: string;
  kicker: string;
  title: ReactNode;
  subtitle?: string;
  align?: "center" | "left";
}

export function SectionHeading({ id, kicker, title, subtitle, align = "center" }: SectionHeadingProps) {
  return (
    <Reveal className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <span className="inline-flex items-center gap-2 rounded-full border border-[#16a34a]/30 dark:border-[#34d399]/30 bg-[#16a34a]/8 dark:bg-[#34d399]/12 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
        <span className="size-1.5 rounded-full bg-[#16a34a] dark:bg-[#34d399]" aria-hidden="true" />
        {kicker}
      </span>
      <h2
        id={id}
        className="section-title mt-4 text-balance font-bold text-foreground"
      >
        {title}
      </h2>
      {subtitle && <p className="mt-4 text-pretty text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>}
    </Reveal>
  );
}
