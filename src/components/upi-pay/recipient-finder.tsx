"use client";

import {
  Camera,
  CloudOff,
  KeyRound,
  Keyboard,
  LoaderCircle,
  LogOut,
  Search,
  ShieldAlert,
  ShieldCheck,
  Timer,
  TriangleAlert,
  UserSearch,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { maskUpiId, normalizeIndianMobile, parseUpiQrPayload } from "@/lib/upi-lookup/phone";
import {
  createSession,
  destroySession,
  fetchLookupConfig,
  fetchSession,
  lookupRecipient,
  type FoundRecipient,
  type LookupConfig,
} from "./api";
import { UPI_APPS } from "./app-icons";
import { PaymentStep } from "./payment-step";
import { QrScan } from "./qr-scan";
import { UpiIdEntry } from "./upi-id-entry";

/**
 * "Find UPI recipient" — recipient search in the style of the UPI apps.
 *
 * Honest-mode rules baked into this screen:
 * - Lookup happens ONLY on the explicit "Find recipient" action (never per
 *   keystroke), through the backend provider adapter.
 * - Every result is labeled; in demo mode results are visibly synthetic.
 * - A returned name is NOT treated as identity proof (disclaimer shown).
 * - The user must confirm the recipient before any payment step.
 * - Clear states: invalid input, no match, unsupported lookup, rate limit,
 *   service unavailable, session required.
 */

type Phase = "loading" | "signed-out" | "ready";

interface ConfirmTarget {
  payeeName: string;
  upiId: string;
  queriedMobileMasked?: string;
  source: "lookup" | "qr";
}

interface PayTarget {
  payeeName: string;
  upiId: string;
}

type MobileStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "invalid"; message: string }
  | { kind: "not-found" }
  | { kind: "unsupported"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "rate-limited"; message: string; retryAfterSecs?: number }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

export function RecipientFinder() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [config, setConfig] = useState<LookupConfig | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [signInName, setSignInName] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const [tab, setTab] = useState("mobile");
  const [phone, setPhone] = useState("");
  const [mobileStatus, setMobileStatus] = useState<MobileStatus>({ kind: "idle" });
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const lastQueryRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextConfig, session] = await Promise.all([fetchLookupConfig(), fetchSession()]);
      if (cancelled) return;
      setConfig(nextConfig);
      if (session.authenticated && session.session) {
        setSessionName(session.session.name);
        setPhase("ready");
      } else {
        setPhase("signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignIn = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (signInBusy) return;
    setSignInBusy(true);
    setSignInError(null);
    const outcome = await createSession(signInName);
    setSignInBusy(false);
    if (!outcome.ok) {
      setSignInError(
        outcome.retryAfterSecs
          ? `Too many attempts — try again in ~${outcome.retryAfterSecs}s.`
          : "Couldn't start a session. Try again."
      );
      return;
    }
    if (outcome.session.authenticated && outcome.session.session) {
      setSessionName(outcome.session.session.name);
      setPhase("ready");
    }
  }, [signInBusy, signInName]);

  const handleSignOut = useCallback(async () => {
    await destroySession();
    setConfirmTarget(null);
    setPayTarget(null);
    setMobileStatus({ kind: "idle" });
    setSessionName("");
    setPhase("signed-out");
  }, []);

  const handleLookup = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (mobileStatus.kind === "submitting") return;

      const normalized = normalizeIndianMobile(phone);
      if (!normalized.ok) {
        setMobileStatus({ kind: "invalid", message: normalized.error });
        phoneInputRef.current?.focus();
        return;
      }

      setMobileStatus({ kind: "submitting" });
      setConfirmTarget(null);
      lastQueryRef.current = normalized.value;

      const outcome = await lookupRecipient(normalized.value);

      if (outcome.ok) {
        if (outcome.result.kind === "found") {
          setConfirmTarget({
            payeeName: outcome.result.payeeName,
            upiId: outcome.result.upiId,
            queriedMobileMasked: outcome.result.queriedMobileMasked,
            source: "lookup",
          });
          setMobileStatus({ kind: "idle" });
        } else {
          setMobileStatus({ kind: "not-found" });
        }
        return;
      }

      switch (outcome.state) {
        case "invalid":
          setMobileStatus({ kind: "invalid", message: outcome.message });
          break;
        case "rate_limited":
          setMobileStatus({
            kind: "rate-limited",
            message: outcome.message,
            retryAfterSecs: outcome.retryAfterSecs,
          });
          break;
        case "unsupported":
          setMobileStatus({ kind: "unsupported", message: outcome.message });
          break;
        case "unavailable":
          setMobileStatus({ kind: "unavailable", message: outcome.message });
          break;
        case "unauthorized":
          setMobileStatus({ kind: "unauthorized" });
          setConfirmTarget(null);
          setPayTarget(null);
          setPhase("signed-out");
          break;
        default:
          setMobileStatus({ kind: "error", message: outcome.message });
      }
    },
    [mobileStatus.kind, phone]
  );

  const handleQrResult = useCallback((text: string) => {
    const parsed = parseUpiQrPayload(text);
    if (!parsed) {
      setScanError("This QR code isn't a UPI payment QR. Scan a UPI app's QR code.");
      return;
    }
    setScanError(null);
    setConfirmTarget({
      payeeName: parsed.pn ?? "",
      upiId: parsed.pa,
      source: "qr",
    });
  }, []);

  const fillDemoNumber = useCallback((number: string) => {
    setPhone(number.replace(/\s/g, ""));
    setMobileStatus({ kind: "idle" });
    setConfirmTarget(null);
    phoneInputRef.current?.focus();
  }, []);

  const isDemo = config?.mode === "demo";
  const submitting = mobileStatus.kind === "submitting";

  /* ------------------------------ sign-in gate ----------------------------- */

  if (phase === "loading") {
    return (
      <div className="grid min-h-[280px] place-items-center rounded-2xl border border-[#e3e8ef] bg-white/70" role="status" aria-label="Loading recipient finder">
        <LoaderCircle size={26} className="animate-spin text-[#635bff]" aria-hidden="true" />
      </div>
    );
  }

  if (phase === "signed-out") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-[#e3e8ef] bg-white p-6 shadow-[0_1px_2px_rgba(36,54,75,0.05)] sm:p-7">
        <span className="grid size-12 place-items-center rounded-xl bg-[#eeedf9] text-[#5140b5]">
          <KeyRound size={20} aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-[18px] font-semibold text-[#26364a]">Sign in to look up recipients</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#65748b]">
          Recipient lookups are authenticated so numbers can&rsquo;t be bulk-probed or harvested. This demo uses a
          lightweight signed session; production apps authenticate through their payment provider or OAuth.
        </p>
        {mobileStatus.kind === "unauthorized" && (
          <p role="alert" className="mt-3 rounded-lg bg-[#fef3f2] px-3 py-2 text-[12.5px] font-medium text-[#b42318]">
            Your session expired — sign in again to continue.
          </p>
        )}
        <form onSubmit={handleSignIn} className="mt-5 space-y-3.5" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="demo-name">Your name (optional)</Label>
            <Input
              id="demo-name"
              value={signInName}
              maxLength={40}
              placeholder="Demo user"
              autoComplete="off"
              onChange={(event) => setSignInName(event.target.value)}
              className="h-11"
            />
          </div>
          {signInError && (
            <p role="alert" className="text-[12.5px] font-medium text-[#b42318]">
              {signInError}
            </p>
          )}
          <Button
            type="submit"
            disabled={signInBusy}
            className="h-11 w-full gap-2 rounded-full bg-[#635bff] text-[14px] hover:bg-[#5348f0]"
          >
            {signInBusy && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            Continue
          </Button>
        </form>
        <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#8b96a8]">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          No password is collected. UPI PINs and banking credentials are never asked for anywhere in this app.
        </p>
      </div>
    );
  }

  /* ------------------------------- main screen ------------------------------ */

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-[#e3e8ef] bg-white shadow-[0_1px_2px_rgba(36,54,75,0.05)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#e3e8ef] px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16px] font-semibold text-[#26364a]">Find UPI recipient</h3>
            {isDemo ? (
              <Badge className="border-none bg-[#fef0c7] text-[10.5px] font-semibold uppercase tracking-wide text-[#b45309] hover:bg-[#fef0c7]">
                Demo
              </Badge>
            ) : (
              <Badge className="border-none bg-[#e5f5ed] text-[10.5px] font-semibold uppercase tracking-wide text-[#16754b] hover:bg-[#e5f5ed]">
                Live
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[#8b96a8]">
            Signed in as {sessionName}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleSignOut()}
          className="h-9 gap-1.5 rounded-full text-[12.5px] text-[#65748b] hover:bg-[#f7f9fc] hover:text-[#26364a]"
        >
          <LogOut size={13} aria-hidden="true" />
          Sign out
        </Button>
      </div>

      <div className="px-5 py-5 sm:px-6">
        {payTarget ? (
          <PaymentStep
            payeeName={payTarget.payeeName}
            upiId={payTarget.upiId}
            badge={isDemo ? <DemoChip /> : null}
            onBack={() => setPayTarget(null)}
          />
        ) : confirmTarget ? (
          <ConfirmCard
            target={confirmTarget}
            isDemo={Boolean(isDemo)}
            onConfirm={() =>
              setPayTarget({ payeeName: confirmTarget.payeeName, upiId: confirmTarget.upiId })
            }
            onBack={() => {
              setConfirmTarget(null);
              if (confirmTarget.source === "qr") setTab("scan");
            }}
          />
        ) : (
          <>
            {/* Demo banner */}
            {config?.demo && (
              <div className="mb-4 rounded-xl border border-[#fedf89] bg-[#fffaeb] p-3.5">
                <p className="flex items-start gap-1.5 text-[12.5px] font-medium leading-relaxed text-[#b45309]">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  Demo mode — results are synthetic test data, never real UPI matches. No PSP is connected in this
                  environment.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] text-[#8b96a8]">Try:</span>
                  {config.demo.testNumbers.slice(0, 3).map((number) => (
                    <button
                      key={number}
                      type="button"
                      onClick={() => fillDemoNumber(number)}
                      className="rounded-full border border-[#fedf89] bg-white px-2.5 py-1 font-mono text-[11.5px] text-[#b45309] transition-colors hover:bg-[#fef0c7]"
                    >
                      {number}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => fillDemoNumber(config.demo!.failureNumber)}
                    className="rounded-full border border-[#fedf89] bg-white px-2.5 py-1 font-mono text-[11.5px] text-[#98a2b3] transition-colors hover:bg-[#fef0c7]"
                    title="Simulates a provider outage"
                  >
                    {config.demo.failureNumber} (outage)
                  </button>
                </div>
              </div>
            )}

            <Tabs value={tab} onValueChange={(next) => { setTab(next); setScanError(null); }}>
              <TabsList className="grid h-11 w-full grid-cols-3 rounded-full bg-[#f7f9fc] p-1">
                <TabsTrigger
                  value="mobile"
                  className="gap-1.5 rounded-full text-[12.5px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  <Search size={13} aria-hidden="true" />
                  Mobile
                </TabsTrigger>
                <TabsTrigger
                  value="upi-id"
                  className="gap-1.5 rounded-full text-[12.5px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  <Keyboard size={13} aria-hidden="true" />
                  UPI ID
                </TabsTrigger>
                <TabsTrigger
                  value="scan"
                  className="gap-1.5 rounded-full text-[12.5px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  <Camera size={13} aria-hidden="true" />
                  Scan QR
                </TabsTrigger>
              </TabsList>

              {/* ------------------------- Mobile lookup ------------------------- */}
              <TabsContent value="mobile" className="mt-5">
                <form onSubmit={handleLookup} className="space-y-3.5" noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone-input">Mobile number</Label>
                    <div className="flex">
                      <span
                        aria-hidden="true"
                        className="inline-flex select-none items-center rounded-l-md border border-r-0 border-[#d5dce6] bg-[#f7f9fc] px-3 font-mono text-[14px] text-[#65748b]"
                      >
                        +91
                      </span>
                      <Input
                        id="phone-input"
                        ref={phoneInputRef}
                        inputMode="numeric"
                        autoComplete="tel-national"
                        placeholder="98765 43210"
                        maxLength={14}
                        value={phone}
                        onChange={(event) => {
                          setPhone(event.target.value);
                          if (mobileStatus.kind !== "idle" && mobileStatus.kind !== "submitting") {
                            setMobileStatus({ kind: "idle" });
                          }
                          setConfirmTarget(null);
                        }}
                        aria-invalid={mobileStatus.kind === "invalid"}
                        aria-describedby="phone-status"
                        className="h-11 rounded-l-none text-[16px]"
                      />
                    </div>
                    <p className="text-[12px] text-[#65748b]">
                      10-digit Indian mobile number linked to the payee&rsquo;s UPI.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    disabled={submitting || !phone.trim()}
                    className="h-11 w-full gap-2 rounded-full bg-[#635bff] text-[14px] hover:bg-[#5348f0]"
                  >
                    {submitting ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Search size={16} aria-hidden="true" />
                    )}
                    {submitting ? "Checking with the provider…" : "Find recipient"}
                  </Button>
                </form>

                <div id="phone-status" aria-live="polite" className="mt-4">
                  {mobileStatus.kind === "invalid" && (
                    <p role="alert" className="flex items-start gap-1.5 text-[12.5px] font-medium text-[#b42318]">
                      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      {mobileStatus.message}
                    </p>
                  )}
                  {mobileStatus.kind === "submitting" && (
                    <div className="space-y-2" role="status" aria-label="Looking up recipient">
                      <div className="h-12 animate-pulse rounded-xl bg-[#f7f9fc]" />
                      <div className="h-4 w-2/3 animate-pulse rounded bg-[#f7f9fc]" />
                    </div>
                  )}
                  {mobileStatus.kind === "not-found" && (
                    <NotFoundCard onSwitchTab={setTab} />
                  )}
                  {mobileStatus.kind === "unsupported" && (
                    <UnsupportedCard message={mobileStatus.message} onSwitchTab={setTab} />
                  )}
                  {mobileStatus.kind === "unavailable" && (
                    <StateCard
                      icon={<CloudOff size={19} aria-hidden="true" />}
                      tone="amber"
                      title="Lookup service unavailable"
                      body={mobileStatus.message}
                      action={
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setMobileStatus({ kind: "idle" });
                            void handleLookup({ preventDefault() {} } as React.FormEvent);
                          }}
                          className="h-10 rounded-full border-[#e3e8ef] text-[13px] text-[#26364a]"
                        >
                          Try again
                        </Button>
                      }
                    />
                  )}
                  {mobileStatus.kind === "rate-limited" && (
                    <StateCard
                      icon={<Timer size={19} aria-hidden="true" />}
                      tone="amber"
                      title="Too many lookups"
                      body={`${mobileStatus.message}${
                        mobileStatus.retryAfterSecs ? ` Try again in ~${mobileStatus.retryAfterSecs}s.` : ""
                      } Rate limits protect recipients from bulk probing and enumeration.`}
                    />
                  )}
                  {mobileStatus.kind === "error" && (
                    <StateCard
                      icon={<TriangleAlert size={19} aria-hidden="true" />}
                      tone="amber"
                      title="Something went wrong"
                      body={mobileStatus.message}
                    />
                  )}
                </div>
              </TabsContent>

              {/* --------------------------- UPI ID ---------------------------- */}
              <TabsContent value="upi-id" className="mt-5">
                <UpiIdEntry
                  onProceed={(upiId) => setPayTarget({ payeeName: "", upiId })}
                  onSignInNeeded={() => {
                    setPhase("signed-out");
                    setMobileStatus({ kind: "unauthorized" });
                  }}
                />
              </TabsContent>

              {/* --------------------------- Scan QR --------------------------- */}
              <TabsContent value="scan" className="mt-5">
                <QrScan onResult={handleQrResult} />
                {scanError && (
                  <p role="alert" className="mt-3 flex items-start gap-1.5 text-[12.5px] font-medium text-[#b42318]">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {scanError}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {/* Footer strip */}
      <div className="border-t border-[#e3e8ef] px-5 py-4 sm:px-6">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#8b96a8]">
          Payable from every UPI app
        </p>
        <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Supported UPI apps">
          {UPI_APPS.map(({ id, name, Icon }) => (
            <li key={id} className="flex items-center gap-1.5">
              <Icon className="size-5" aria-hidden="true" />
              <span className="text-[11.5px] font-medium text-[#58667a]">{name}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[#8b96a8]">
          Lookups run server-side through the provider adapter. Nothing is stored, numbers never appear in logs, and
          UPI PINs are never collected — authorization happens in your UPI app.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ subcomponents ------------------------------ */

function DemoChip() {
  return (
    <Badge className="border-none bg-[#fef0c7] text-[10.5px] font-semibold uppercase tracking-wide text-[#b45309] hover:bg-[#fef0c7]">
      Demo data
    </Badge>
  );
}

function ConfirmCard({
  target,
  isDemo,
  onConfirm,
  onBack,
}: {
  target: ConfirmTarget;
  isDemo: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#65748b] transition-colors hover:text-[#26364a]"
      >
        <Search size={13} aria-hidden="true" />
        Search again
      </button>

      <div className="rounded-2xl border border-[#e3e8ef] bg-[#f7f9fc] p-5 text-center" aria-live="polite">
        <span
          className="mx-auto grid size-14 place-items-center rounded-full bg-[#eeedf9] text-[22px] font-bold text-[#5140b5]"
          aria-hidden="true"
        >
          {(target.payeeName || target.upiId).slice(0, 1).toUpperCase()}
        </span>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <h4 className="text-[18px] font-semibold text-[#26364a]">
            {target.payeeName || "UPI recipient"}
          </h4>
          {isDemo && target.source === "lookup" && <DemoChip />}
        </div>
        <p className="mt-1 font-mono text-[13px] text-[#65748b]">{maskUpiId(target.upiId)}</p>
        {target.queriedMobileMasked && (
          <p className="mt-0.5 text-[12px] text-[#8b96a8]">
            UPI Number ••••&nbsp;{target.queriedMobileMasked.split(" ").pop()}
          </p>
        )}
        <p className="mx-auto mt-3 max-w-[42ch] text-[11.5px] leading-relaxed text-[#8b96a8]">
          Name is shown exactly as returned by the provider. It is <strong>not proof of identity</strong> — confirm
          you know this recipient before paying.
        </p>
        <Button
          type="button"
          onClick={onConfirm}
          className="mt-4 h-11 w-full rounded-full bg-[#635bff] text-[14px] hover:bg-[#5348f0]"
        >
          Yes, this is the right recipient
        </Button>
        <p className="mt-2 text-[11.5px] text-[#8b96a8]">
          The full UPI ID is shared with your UPI app only when you pay.
        </p>
      </div>
    </div>
  );
}

function NotFoundCard({ onSwitchTab }: { onSwitchTab: (tab: string) => void }) {
  return (
    <StateCard
      icon={<UserSearch size={19} aria-hidden="true" />}
      tone="neutral"
      title="No UPI recipient found"
      body="This number may not be registered on UPI, or the person may have turned off discoverability. A number is not automatically a UPI alias."
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onSwitchTab("upi-id")}
            className="h-10 rounded-full border-[#e3e8ef] text-[13px] text-[#26364a]"
          >
            Enter a UPI ID
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onSwitchTab("scan")}
            className="h-10 rounded-full border-[#e3e8ef] text-[13px] text-[#26364a]"
          >
            Scan their QR
          </Button>
        </div>
      }
    />
  );
}

function UnsupportedCard({ message, onSwitchTab }: { message: string; onSwitchTab: (tab: string) => void }) {
  return (
    <StateCard
      icon={<ShieldAlert size={19} aria-hidden="true" />}
      tone="neutral"
      title="Mobile lookup not supported here"
      body={`${message} Until a provider with an approved number-resolution API is connected, pay with a UPI ID or a scanned QR instead.`}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onSwitchTab("upi-id")}
            className="h-10 rounded-full border-[#e3e8ef] text-[13px] text-[#26364a]"
          >
            Enter a UPI ID
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onSwitchTab("scan")}
            className="h-10 rounded-full border-[#e3e8ef] text-[13px] text-[#26364a]"
          >
            Scan their QR
          </Button>
        </div>
      }
    />
  );
}

function StateCard({
  icon,
  tone,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  tone: "neutral" | "amber";
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const toneClass =
    tone === "amber"
      ? "border-[#fedf89] bg-[#fffaeb] text-[#b45309]"
      : "border-[#e3e8ef] bg-[#f7f9fc] text-[#5140b5]";
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">{title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed opacity-90">{body}</p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}
