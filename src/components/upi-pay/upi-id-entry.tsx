"use client";

import { ArrowRight, CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateUpiId } from "./api";

/**
 * "Enter UPI ID" alternative — for when the recipient shares a VPA directly.
 *
 * Honest scope: the backend only checks the FORMAT (localPart@handle). It
 * cannot verify that the account exists — only the payer's bank does that at
 * payment time. The UI says exactly that.
 */

interface UpiIdEntryProps {
  onProceed: (upiId: string) => void;
  onSignInNeeded: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "invalid"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterSecs?: number }
  | { kind: "error"; message: string }
  | { kind: "valid"; normalized: string; message: string };

export function UpiIdEntry({ onProceed, onSignInNeeded }: UpiIdEntryProps) {
  const [upiId, setUpiId] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!upiId.trim() || status.kind === "checking") return;
    setStatus({ kind: "checking" });

    const outcome = await validateUpiId(upiId);
    if (outcome.ok) {
      if (outcome.valid) {
        setStatus({ kind: "valid", normalized: outcome.normalized, message: outcome.message });
      } else {
        setStatus({ kind: "invalid", message: outcome.message });
      }
    } else if (outcome.state === "rate_limited") {
      setStatus({ kind: "rate_limited", message: outcome.message, retryAfterSecs: outcome.retryAfterSecs });
    } else if (outcome.state === "unauthorized") {
      setStatus({ kind: "idle" });
      onSignInNeeded();
    } else {
      setStatus({ kind: "error", message: outcome.message });
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="upi-id-input">UPI ID</Label>
          <Input
            id="upi-id-input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@bank"
            value={upiId}
            onChange={(event) => {
              setUpiId(event.target.value);
              if (status.kind !== "idle" && status.kind !== "checking") setStatus({ kind: "idle" });
            }}
            aria-invalid={status.kind === "invalid"}
            aria-describedby="upi-id-hint upi-id-status"
            className="h-11 font-mono text-[15px]"
          />
          <p id="upi-id-hint" className="text-[12px] text-[#65748b]">
            Format: name@bank — get it from the payee directly.
          </p>
        </div>

        <Button
          type="submit"
          disabled={!upiId.trim() || status.kind === "checking"}
          className="h-11 w-full gap-2 rounded-full bg-[#635bff] text-[14px] hover:bg-[#5348f0]"
        >
          {status.kind === "checking" ? (
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight size={16} aria-hidden="true" />
          )}
          {status.kind === "checking" ? "Checking format…" : "Check & continue"}
        </Button>
      </form>

      <div id="upi-id-status" aria-live="polite">
        {status.kind === "invalid" && (
          <p role="alert" className="flex items-start gap-1.5 text-[12.5px] font-medium text-[#b42318]">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {status.message}
          </p>
        )}
        {status.kind === "rate_limited" && (
          <p role="alert" className="text-[12.5px] font-medium text-[#b45309]">
            {status.message}
            {status.retryAfterSecs ? ` Try again in ~${status.retryAfterSecs}s.` : ""}
          </p>
        )}
        {status.kind === "error" && (
          <p role="alert" className="text-[12.5px] font-medium text-[#b42318]">
            {status.message}
          </p>
        )}
        {status.kind === "valid" && (
          <div className="space-y-3 rounded-xl border border-[#e3e8ef] bg-[#f7f9fc] p-4">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[#16754b]" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-mono text-[13.5px] font-semibold break-all text-[#26364a]">
                  {status.normalized}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-[#65748b]">{status.message}</p>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => onProceed(status.normalized)}
              className="h-11 w-full gap-2 rounded-full bg-[#635bff] text-[14px] hover:bg-[#5348f0]"
            >
              Continue to payment
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
