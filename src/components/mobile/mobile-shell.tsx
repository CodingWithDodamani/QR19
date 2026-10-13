"use client";

import { Bell, House, ReceiptText, ScanLine, UserRound } from "lucide-react";

export type MobileTab = "home" | "history" | "collect" | "alerts" | "profile";

const TABS: Array<{ id: Exclude<MobileTab, "collect">; label: string; icon: typeof House }> = [
  { id: "home", label: "Home", icon: House },
  { id: "history", label: "History", icon: ReceiptText },
];

const TABS_RIGHT: Array<{ id: Exclude<MobileTab, "collect">; label: string; icon: typeof House }> = [
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "profile", label: "Profile", icon: UserRound },
];

interface MobileShellProps {
  tab: MobileTab;
  onTab: (tab: MobileTab) => void;
  alertsUnread: number;
  children: React.ReactNode;
}

/** Short haptic tick on supported phones; silent no-op elsewhere. */
export function tapTick(): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(8);
    }
  } catch {
    // ignore — haptics are best-effort
  }
}

function TabButton({
  id,
  label,
  Icon,
  active,
  badge,
  onTab,
}: {
  id: MobileTab;
  label: string;
  Icon: typeof House;
  active: boolean;
  badge?: number;
  onTab: (tab: MobileTab) => void;
}) {
  return (
    <button
      type="button"
      className={active ? "ep-tab ep-tab-active" : "ep-tab"}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onClick={() => {
        tapTick();
        onTab(id);
      }}
    >
      <span className="ep-tab-icon">
        <Icon size={24} aria-hidden="true" />
        {badge !== undefined && badge > 0 ? (
          <span className="ep-tab-dot" aria-label={`${badge} unread`} />
        ) : null}
      </span>
      <span className="ep-tab-label">{label}</span>
    </button>
  );
}

/**
 * EasyPay-style app frame: floating pill tab bar with a raised center
 * collect action. Screens render their own headers above it.
 */
export function MobileShell({ tab, onTab, alertsUnread, children }: MobileShellProps) {
  return (
    <div className="ep">
      <div className="ep-frame">
        <main className="ep-body">{children}</main>
        <nav className="ep-tabs" aria-label="App sections">
          <div className="ep-tabs-side">
            {TABS.map(({ id, label, icon: Icon }) => (
              <TabButton key={id} id={id} label={label} Icon={Icon} active={tab === id} onTab={onTab} />
            ))}
          </div>
          <button
            type="button"
            className="ep-fab"
            aria-label="New collection"
            onClick={() => {
              tapTick();
              onTab("collect");
            }}
          >
            <ScanLine size={27} aria-hidden="true" />
          </button>
          <div className="ep-tabs-side">
            {TABS_RIGHT.map(({ id, label, icon: Icon }) => (
              <TabButton
                key={id}
                id={id}
                label={label}
                Icon={Icon}
                active={tab === id}
                badge={id === "alerts" ? alertsUnread : undefined}
                onTab={onTab}
              />
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
