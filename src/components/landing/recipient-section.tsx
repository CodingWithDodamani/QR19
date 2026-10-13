"use client";

import { RecipientFinder } from "@/components/upi-pay/recipient-finder";

import { Reveal } from "./reveal";
import { SectionHeading } from "./section-heading";

export function RecipientSection() {
  return (
    <section
      id="find-recipient"
      className="scroll-mt-24 py-20 lg:py-28"
      aria-labelledby="find-recipient-title"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="find-recipient-title"
          kicker="Recipient discovery"
          title={
            <>
              Pay anyone with just{" "}
              <span className="text-gradient">a phone number</span>
            </>
          }
          subtitle="Search a recipient the way the UPI apps do — by mobile number, UPI ID, or a scanned QR. Lookups run server-side through the payment provider, and you always confirm the recipient before paying."
        />

        <Reveal delay={0.12} className="mx-auto mt-14 max-w-2xl">
          <RecipientFinder />
        </Reveal>
      </div>
    </section>
  );
}
