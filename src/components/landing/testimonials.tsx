"use client";

import { MessageSquareHeart, Star } from "lucide-react";

import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

/**
 * Testimonials — PLACEHOLDER INVITES, not reviews.
 *
 * There are no collected user quotes in this repo, and fabricating named
 * reviews would be dishonest. Replace these cards with real merchant quotes
 * (name, shop, one line) before launch. Until then they invite stories
 * instead of inventing them.
 */
export function Testimonials() {
  return (
    <section id="reviews" className="scroll-mt-24 py-20 lg:py-28" aria-labelledby="reviews-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="reviews-title"
          kicker="Merchant stories"
          title={
            <>
              Collectors, <span className="text-gradient">in their words</span>
            </>
          }
          subtitle="Real quotes from real counters go here — nothing below is a review yet."
        />
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {[1, 2, 3].map((slot, i) => (
            <Reveal key={slot} delay={i * 0.08}>
              <figure className="flex h-full flex-col items-center rounded-2xl border border-dashed border-[#c9cede] bg-white/60 px-6 py-8 text-center">
                <span className="flex gap-1 text-[#e5e7eb]" aria-label="Awaiting first reviews">
                  {Array.from({ length: 5 }, (_, s) => (
                    <Star key={s} size={15} aria-hidden="true" fill="currentColor" strokeWidth={0} />
                  ))}
                </span>
                <blockquote className="mt-4 text-[14px] font-medium leading-relaxed text-[#65748b]">
                  Your story here — how did sequential collection change your counter rush?
                </blockquote>
                <figcaption className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#8b96a8]">
                  Shop {slot} · Your town
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.1} className="mt-8 text-center">
          <a
            href="/app"
            className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-[#121a26]/15 bg-white px-6 text-[14px] font-semibold text-[#121a26] transition-all hover:-translate-y-0.5"
          >
            <MessageSquareHeart size={16} aria-hidden="true" />
            Try it today — then tell us your story
          </a>
        </Reveal>
      </div>
    </section>
  );
}
