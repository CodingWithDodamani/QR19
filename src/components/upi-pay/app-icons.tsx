"use client";

import type { ComponentType, SVGProps } from "react";

import {
  AMAZONPAY_PATH,
  GOOGLEPAY_PATH,
  PAYTM_PATH,
  PHONEPE_PATH,
  WHATSAPP_PATH,
} from "./icon-paths";

/**
 * UPI payment-app brand icons.
 *
 * Provenance, verified 2026 against upstream sources:
 * - PhonePe / Google Pay / Paytm / WhatsApp — byte-identical to the
 *   simple-icons glyphs (CC0, https://simpleicons.org), rendered here in
 *   each brand's official color. Verified programmatically against the
 *   published SVGs (only decimal formatting differs, which parses
 *   identically at render sizes).
 * - Amazon Pay / BHIM / CRED / UPI mark — purpose-built square tiles drawn
 *   for this app (the official Amazon Pay and BHIM lockups are ~5:1 wide
 *   wordmarks: illegible at 28px tile size and duplicative next to the text
 *   labels they sit beside; no official CRED vector is publicly available).
 *   Kept deliberately — see report 2026-10-13.
 *
 * All marks belong to their owners and are used solely to identify which
 * UPI apps a recipient can be paid with (nominative use).
 */

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function base(props: IconProps): IconProps {
  return {
    viewBox: "0 0 24 24",
    role: "img",
    focusable: "false",
    ...props,
    className: props.className ?? "size-6",
  };
}

/** PhonePe — the purple "पे" blob (glyph holes read as the white symbol). */
export function PhonePeIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="PhonePe">
      <path fill="#5F259F" d={PHONEPE_PATH} />
    </svg>
  );
}

/** Google Pay — "G Pay" wordmark in Google blue. */
export function GooglePayIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="Google Pay">
      <path fill="#4285F4" d={GOOGLEPAY_PATH} />
    </svg>
  );
}

/** Paytm — wordmark in Paytm navy. */
export function PaytmIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="Paytm">
      <path fill="#002E6E" d={PAYTM_PATH} />
    </svg>
  );
}

/** Amazon Pay — white wordmark on the dark navy app tile. */
export function AmazonPayIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="Amazon Pay">
      <rect width="24" height="24" rx="5.2" fill="#232F3E" />
      <g transform="translate(2.4 7.2) scale(0.8)">
        <path fill="#FFFFFF" d={AMAZONPAY_PATH} />
      </g>
    </svg>
  );
}

/** WhatsApp — green glyph (WhatsApp Pay rides on UPI). */
export function WhatsAppIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="WhatsApp Pay">
      <path fill="#25D366" d={WHATSAPP_PATH} />
    </svg>
  );
}

/** BHIM (NPCI) — tricolor tile with the rupee mark. */
export function BhimIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="BHIM">
      <defs>
        <clipPath id="bhim-clip">
          <rect width="24" height="24" rx="5.2" />
        </clipPath>
      </defs>
      <g clipPath="url(#bhim-clip)">
        <rect width="24" height="8" fill="#FF9933" />
        <rect y="8" width="24" height="8" fill="#FFFFFF" />
        <rect y="16" width="24" height="8" fill="#138808" />
      </g>
      <rect width="24" height="24" rx="5.2" fill="none" stroke="#0A2E65" strokeWidth="0.9" />
      <text
        x="12"
        y="16.4"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="800"
        fill="#000088"
        fontFamily="system-ui, sans-serif"
      >
        ₹
      </text>
    </svg>
  );
}

/** CRED — black tile with the wordmark. */
export function CredIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="CRED">
      <rect width="24" height="24" rx="5.2" fill="#0D0D0D" />
      <text
        x="12"
        y="15.3"
        textAnchor="middle"
        fontSize="7.2"
        fontWeight="800"
        letterSpacing="0.4"
        fill="#FFFFFF"
        fontFamily="system-ui, sans-serif"
      >
        CRED
      </text>
    </svg>
  );
}

/** NPCI UPI mark — saffron + green chevrons with the UPI wordmark. */
export function UpiIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-label="UPI — Unified Payments Interface">
      <path d="M2.6 3.2 8.4 12l-5.8 8.8h4.1L12.5 12 6.7 3.2Z" fill="#F97316" />
      <path d="M9.1 3.2 14.9 12l-5.8 8.8h4.1L18.9 12l-5.7-8.8Z" fill="#097E52" />
      <text
        x="13.2"
        y="15.4"
        fontSize="8.6"
        fontWeight="800"
        fill="#1A2E5A"
        fontFamily="system-ui, sans-serif"
      >
        UPI
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Registries used across the recipient-discovery UI + landing marquee */
/* ------------------------------------------------------------------ */

export interface UpiAppEntry {
  id: string;
  name: string;
  Icon: ComponentType<IconProps>;
}

/** Apps that can open a `upi://` intent with recipient + amount pre-filled. */
export const INTENT_APPS: UpiAppEntry[] = [
  { id: "phonepe", name: "PhonePe", Icon: PhonePeIcon },
  { id: "gpay", name: "Google Pay", Icon: GooglePayIcon },
  { id: "paytm", name: "Paytm", Icon: PaytmIcon },
  { id: "bhim", name: "BHIM", Icon: BhimIcon },
];

/** Everything scannable from / usable for UPI — used in "works with" strips. */
export const UPI_APPS: UpiAppEntry[] = [
  ...INTENT_APPS,
  { id: "amazonpay", name: "Amazon Pay", Icon: AmazonPayIcon },
  { id: "whatsapp", name: "WhatsApp Pay", Icon: WhatsAppIcon },
  { id: "cred", name: "CRED", Icon: CredIcon },
  { id: "upi", name: "Any UPI app", Icon: UpiIcon },
];
