"use client";

import { useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

const FAQS = [
  {
    question: "Is QR19 really free?",
    answer:
      "Yes — completely. No setup fee, no transaction fee, no premium tier hiding around the corner. The tool runs entirely in your browser, so there are no server costs to pass on to you.",
  },
  {
    question: "Why is each QR code capped at ₹1,999?",
    answer:
      "Keeping every scan below ₹2,000 makes each payment quick and predictable for your customer — and it's where the name comes from: QR for the code you collect with, 19 for the ₹1,9(99) per-scan limit. QR19 splits your total into as many ₹1,999 codes as needed and puts the exact remainder on the last one.",
  },
  {
    question: "Do you store my UPI ID or payment details?",
    answer:
      "Never. There is no backend storing anything. Your UPI ID, name, amount and note are used to build QR codes on your device, and that's where they stay. Close the tab and it's all gone.",
  },
  {
    question: "Which UPI apps can scan these codes?",
    answer:
      "Every app that speaks UPI: Google Pay, PhonePe, Paytm, BHIM, and the rest. The codes contain standard UPI deep links, so any capable app can pay them.",
  },
  {
    question: "How do I share the codes?",
    answer:
      "Download each code as a PNG, print the whole set for your shop counter, or just show them on your screen. Scanning one code collects one part of the total; every part together adds up to the full amount.",
  },
];

export function Faq() {
  // Single-open collapsible, like the Radix accordion before it — but with
  // deterministic ids (`faq-trigger-N`). Radix generates useId-based
  // attributes that drifted between SSR and hydration here, so this subtree
  // no longer depends on generated ids at all.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onTriggerKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const count = FAQS.length;
    const next = event.key === "ArrowDown" ? (index + 1) % count : (index - 1 + count) % count;
    triggerRefs.current[next]?.focus();
  }

  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20 lg:py-28" aria-labelledby="faq-title">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="faq-title"
          kicker="FAQ"
          title={
            <>
              Questions, <span className="text-gradient">answered</span>
            </>
          }
        />
        <Reveal delay={0.1}>
          <div className="mt-10">
            {FAQS.map((faq, index) => {
              const open = openIndex === index;
              return (
                <div key={faq.question} className="border-b border-[#e3e8ef] last:border-b-0">
                  <h3 className="flex">
                    <button
                      ref={(node) => {
                        triggerRefs.current[index] = node;
                      }}
                      type="button"
                      id={`faq-trigger-${index}`}
                      aria-expanded={open}
                      aria-controls={`faq-panel-${index}`}
                      onClick={() => setOpenIndex(open ? null : index)}
                      onKeyDown={(event) => onTriggerKeyDown(event, index)}
                      className="flex flex-1 items-start justify-between gap-4 rounded-xl px-5 py-4 text-left text-[15px] font-medium text-[#26364a] transition-colors outline-none hover:bg-[#635bff]/5 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {faq.question}
                      <ChevronDownIcon
                        aria-hidden="true"
                        className={`text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200 ${open ? "rotate-180 text-[#635bff]" : ""}`}
                      />
                    </button>
                  </h3>
                  <div
                    id={`faq-panel-${index}`}
                    role="region"
                    aria-labelledby={`faq-trigger-${index}`}
                    data-open={open}
                    className="faq-panel overflow-hidden text-sm"
                  >
                    <div>
                      <p className="px-5 pb-5 pt-0 text-[13.5px] leading-relaxed text-[#65748b]">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
