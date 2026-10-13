"use client";

import { ArrowLeft, Check, Copy, Info, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildUpiLink, formatINR, parseAmountToPaise } from "@/lib/upi";
import { INTENT_APPS } from "./app-icons";

/**
 * Shared "confirm → pay" step used after a recipient was found by ANY method
 * (mobile lookup, direct UPI ID, scanned QR).
 *
 * The recipient is already confirmed before this screen. Payment authorization
 * itself happens INSIDE the user's UPI app via the intent link — this app
 * never sees or collects a UPI PIN, password, or any banking credential.
 */

interface PaymentStepProps {
  payeeName: string;
  upiId: string;
  /** Extra chip rendered next to the recipient (e.g. "Demo data"). */
  badge?: React.ReactNode;
  onBack: () => void;
}

function randomTxnRef(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export function PaymentStep({ payeeName, upiId, badge, onBack }: PaymentStepProps) {
  const [name, setName] = useState(payeeName);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [amountPaise, setAmountPaise] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const txnRef = useMemo(() => randomTxnRef(), []);

  const upiLink =
    amountPaise !== null
      ? buildUpiLink(upiId, name.trim() || "UPI Recipient", amountPaise, note.trim(), txnRef)
      : null;

  function handleAmountChange(value: string) {
    setAmount(value);
    setCopied(false);
    if (!value.trim()) {
      setAmountPaise(null);
      setAmountError(null);
      return;
    }
    try {
      const paise = parseAmountToPaise(value);
      setAmountPaise(paise);
      setAmountError(null);
    } catch (error) {
      setAmountPaise(null);
      setAmountError(error instanceof Error ? error.message : "Invalid amount.");
    }
  }

  async function copyLink() {
    if (!upiLink) return;
    try {
      await navigator.clipboard.writeText(upiLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#65748b] transition-colors hover:text-[#26364a]"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Back to recipient search
      </button>

      {/* Recipient summary */}
      <div className="flex items-center gap-3 rounded-xl border border-[#e3e8ef] bg-white p-3.5">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full bg-[#eeedf9] text-[16px] font-bold text-[#5140b5]"
          aria-hidden="true"
        >
          {(name.trim() || upiId).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-[#26364a]">
              {name.trim() || "UPI recipient"}
            </p>
            {badge}
          </div>
          <p className="truncate font-mono text-[12px] text-[#65748b]">{upiId}</p>
        </div>
      </div>

      {/* Amount + note */}
      <div className="space-y-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="pay-amount">Amount (₹)</Label>
          <Input
            id="pay-amount"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(event) => handleAmountChange(event.target.value)}
            aria-invalid={Boolean(amountError)}
            aria-describedby={amountError ? "pay-amount-error" : "pay-amount-preview"}
            className="h-11 text-[16px]"
          />
          {amountError ? (
            <p id="pay-amount-error" role="alert" className="text-[12.5px] font-medium text-[#b42318]">
              {amountError}
            </p>
          ) : (
            <p id="pay-amount-preview" aria-live="polite" className="min-h-[18px] text-[12.5px] text-[#65748b]">
              {amountPaise !== null ? `Paying ${formatINR(amountPaise)}` : "Enter the amount to pay"}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-name">Payee name (shown in your UPI app)</Label>
          <Input
            id="pay-name"
            value={name}
            maxLength={40}
            placeholder="UPI Recipient"
            onChange={(event) => {
              setName(event.target.value);
              setCopied(false);
            }}
            className="h-11"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-note">Note (optional)</Label>
          <Input
            id="pay-note"
            value={note}
            maxLength={50}
            placeholder="Rent, dinner, invoice #…"
            onChange={(event) => {
              setNote(event.target.value);
              setCopied(false);
            }}
            className="h-11"
          />
        </div>
      </div>

      {/* Pay using … */}
      {upiLink && (
        <div className="space-y-3 rounded-xl border border-[#e3e8ef] bg-[#f7f9fc] p-4">
          <p className="text-[13px] font-semibold text-[#26364a]">Pay using</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {INTENT_APPS.map(({ id, name: appName, Icon }) => (
              <a
                key={id}
                href={upiLink}
                aria-label={`Open this payment in ${appName}`}
                className="group flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[#e3e8ef] bg-white px-2 py-3 text-center shadow-[0_1px_2px_rgba(36,54,75,0.05)] transition-all hover:-translate-y-0.5 hover:border-[#635bff]/40 hover:shadow-[0_8px_20px_-10px_rgba(99,91,255,0.5)]"
              >
                <Icon className="size-7 transition-transform group-hover:scale-110" />
                <span className="text-[11.5px] font-medium leading-tight text-[#58667a] group-hover:text-[#26364a]">
                  {appName}
                </span>
              </a>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={copyLink}
            className="h-10 w-full gap-2 border-[#e3e8ef] text-[#26364a] hover:bg-white"
          >
            {copied ? <Check size={15} className="text-[#16754b]" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copied ? "Link copied" : "Copy UPI intent link"}
          </Button>
          <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[#65748b]">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            Opens your UPI app with the recipient, amount and note pre-filled. On desktop, copy the link and open it on your phone.
          </p>
        </div>
      )}

      <p className="flex items-start gap-1.5 rounded-lg bg-[#e5f5ed] px-3 py-2.5 text-[12px] leading-relaxed text-[#16754b]">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        Payment is authorized inside your UPI app — never here. We never collect UPI PINs, passwords, or banking credentials.
      </p>
    </div>
  );
}
