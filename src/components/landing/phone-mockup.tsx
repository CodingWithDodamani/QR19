"use client";

import { Bell, Check, House, QrCode, ReceiptText, ScanLine, UserRound } from "lucide-react";

import { QrIllustration } from "@/components/landing/qr-illustration";
import { formatINR } from "@/lib/upi";

export type MockScreen = "home" | "collect" | "history";

const TABS = [
  { Icon: House, label: "Home" },
  { Icon: ReceiptText, label: "History" },
] as const;

const TABS_RIGHT = [
  { Icon: Bell, label: "Alerts" },
  { Icon: UserRound, label: "Profile" },
] as const;

function MockTabs({ active }: { active: string }) {
  return (
    <div className="flex items-center rounded-full bg-[#1e293b] dark:bg-[#0f172a] px-2 py-1.5 shadow-[0_8px_24px_-10px_rgba(18,26,38,0.25)]">
      <div className="flex flex-1 items-center justify-evenly">
        {TABS.map(({ Icon, label }) => (
          <span key={label} className={active === label ? "text-[#4ade80]" : "text-[#64748b]"}>
            <Icon size={15} aria-hidden="true" />
          </span>
        ))}
      </div>
      <span className="grid size-9 place-items-center rounded-full bg-[#121a26] text-white ring-4 ring-white">
        <ScanLine size={15} aria-hidden="true" />
      </span>
      <div className="flex flex-1 items-center justify-evenly">
        {TABS_RIGHT.map(({ Icon, label }) => (
          <span key={label} className={active === label ? "text-[#4ade80]" : "text-[#64748b]"}>
            <Icon size={15} aria-hidden="true" />
          </span>
        ))}
      </div>
    </div>
  );
}

function MockHome() {
  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-full bg-[#121a26] text-[11px] font-bold text-white">
          RS
        </span>
        <div>
          <p className="text-[11px] font-semibold leading-tight text-[#121a26] dark:text-[#f8fafc]">Hi, Ramesh</p>
          <p className="text-[8px] leading-tight text-[#5d708c] dark:text-[#94a3b8]">ramesh@okaxis</p>
        </div>
        <span className="ml-auto grid size-7 place-items-center rounded-full border border-[#e9ecef] dark:border-[#e2e8f0]/30 bg-white dark:bg-[#1e293b] text-[#121a26] dark:text-[#f8fafc]">
          <Bell size={12} aria-hidden="true" />
        </span>
      </div>
      <div className="rounded-2xl bg-[#121a26] p-3 text-white">
        <p className="text-[8px] font-medium text-white/70">Verified collected</p>
        <p className="text-[22px] font-bold tabular-nums tracking-tight">{formatINR(450000)}</p>
        <p className="text-[8px] text-white/60">2 collections · 3 QRs verified</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <span className="flex items-center justify-center gap-1.5 rounded-full bg-white dark:bg-[#1e293b] py-2 text-[9px] font-semibold text-[#121a26] dark:text-[#f8fafc] shadow-sm">
          <QrCode size={11} aria-hidden="true" /> Collect
        </span>
        <span className="flex items-center justify-center gap-1.5 rounded-full bg-white dark:bg-[#1e293b] py-2 text-[9px] font-semibold text-[#121a26] dark:text-[#f8fafc] shadow-sm">
          <ReceiptText size={11} aria-hidden="true" /> History
        </span>
      </div>
      {[
        { name: "Ramesh Store", sub: "2/2 paid · just now", amt: 250100 },
        { name: "Gupta Sweets", sub: "1/3 paid · 5m ago", amt: 199900 },
      ].map((row) => (
        <div key={row.name} className="flex items-center gap-2 rounded-2xl bg-white dark:bg-[#1e293b] p-2 shadow-sm">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e6f7ec] dark:bg-[#0f2a1d] text-[10px] font-bold text-[#16a34a] dark:text-[#4ade80]">
            {row.name[0]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-semibold text-[#121a26] dark:text-[#f8fafc]">{row.name}</span>
            <span className="block truncate text-[8px] text-[#5d708c] dark:text-[#94a3b8]">{row.sub}</span>
          </span>
          <span className="text-[10px] font-bold tabular-nums text-[#121a26] dark:text-[#f8fafc]">{formatINR(row.amt)}</span>
        </div>
      ))}
      <div className="mt-auto">
        <MockTabs active="Home" />
      </div>
    </div>
  );
}

function MockCollect() {
  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="pt-1 text-center">
        <p className="text-[13px] font-bold text-[#121a26] dark:text-[#f8fafc]">New collection</p>
        <p className="text-[8px] text-[#5d708c] dark:text-[#94a3b8]">Split a bill into ₹1,999-or-less QRs</p>
      </div>
      <div className="rounded-2xl bg-[#121a26] p-3 text-center text-white">
        <p className="text-[8px] font-medium text-white/70">Total to collect</p>
        <p className="text-[24px] font-bold tabular-nums tracking-tight">{formatINR(399800)}</p>
        <p className="text-[8px] text-white/60">2 QR codes · unique amounts</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[199900, 199900].map((paise, i) => (
          <div key={i} className="flex flex-col items-center gap-1 rounded-2xl bg-white dark:bg-[#1e293b] p-2 shadow-sm">
            <QrIllustration className="w-full text-[#182621] dark:text-[#f8fafc]" />
            <p className="text-[11px] font-bold tabular-nums text-[#121a26] dark:text-[#f8fafc]">{formatINR(paise)}</p>
          </div>
        ))}
      </div>
      <span className="mt-auto flex items-center justify-center gap-2 rounded-2xl bg-[#87e64b] py-3 text-[11px] font-bold text-[#121a26]">
        <Check size={12} aria-hidden="true" /> Start collecting
      </span>
      <MockTabs active="Collect" />
    </div>
  );
}

function MockHistory() {
  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="pt-1 text-center">
        <p className="text-[13px] font-bold text-[#121a26] dark:text-[#f8fafc]">History</p>
        <p className="text-[8px] text-[#5d708c] dark:text-[#94a3b8]">{formatINR(650000)} verified · on this device</p>
      </div>
      <div className="flex flex-col gap-2">
        {[
          { name: "Ramesh Store", sub: "Completed · 2/2 paid", amt: 250100, done: true },
          { name: "Gupta Sweets", sub: "1/3 paid · active", amt: 400000, done: false },
          { name: "City Bakery", sub: "Completed · 1/1 paid", amt: 0, done: true },
        ].map((row) => (
          <div key={row.name} className="flex items-center gap-2 rounded-2xl bg-white dark:bg-[#1e293b] p-2 shadow-sm">
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                row.done
                  ? "bg-[#e6f7ec] dark:bg-[#0f2a1d] text-[#16a34a] dark:text-[#4ade80]"
                  : "bg-[#e9f0ff] dark:bg-[#003159] text-[#006aff] dark:text-[#87e6ff]"
              }`}
            >
              {row.name[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10px] font-semibold text-[#121a26] dark:text-[#f8fafc]">{row.name}</span>
              <span className="block truncate text-[8px] text-[#5d708c] dark:text-[#94a3b8]">{row.sub}</span>
            </span>
            <span className="text-[10px] font-bold tabular-nums text-[#121a26] dark:text-[#f8fafc]">
              {row.amt > 0 ? formatINR(row.amt) : "—"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <MockTabs active="History" />
      </div>
    </div>
  );
}

/**
 * Static phone mockup of the real /app screens (decorative — the live
 * product is one tap away). Pure CSS, no images, screen-reader hidden.
 */
export function PhoneMockup({ screen = "home", className = "" }: { screen?: MockScreen; className?: string }) {
  return (
    <div aria-hidden="true" className={`mx-auto w-[240px] rounded-[2.2rem] border-[9px] dark:border-[#e2e8f0]/30 border-[#121a26] dark:bg-[#0e1520] bg-[#f6fafd] shadow-[0_30px_70px_-24px_rgba(18,26,38,0.45)] sm:w-[260px] ${className}`}>
      <div className="mx-auto mt-1.5 h-4 w-20 rounded-full bg-[#121a26]" />
      <div className="h-[430px] overflow-hidden sm:h-[460px]">
        {screen === "home" ? <MockHome /> : screen === "collect" ? <MockCollect /> : <MockHistory />}
      </div>
      <div className="mx-auto mb-1.5 h-1 w-24 rounded-full bg-[#121a26]/20" />
    </div>
  );
}
