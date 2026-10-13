"use client";

import { useCallback, useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";

import { loadMerchantProfile, pushNotification, subscribeNotifications, unreadCount } from "@/lib/offline/notifications";
import type { MerchantProfile } from "@/lib/offline/notifications";

import { AlertsScreen } from "./mobile-alerts";
import { CollectScreen } from "./mobile-collect";
import { HistoryScreen } from "./mobile-activity";
import { HomeScreen } from "./mobile-home";
import { hasSeenOnboarding, OnboardingScreen } from "./mobile-onboarding";
import { ProfileScreen } from "./mobile-profile";
import { MobileShell, type MobileTab } from "./mobile-shell";
import { SplashScreen } from "./mobile-splash";

/** EasyPay-style mobile app: splash → onboarding → Home/History/Collect/Alerts/Profile. */
export function MobileApp() {
  const [stage, setStage] = useState<"splash" | "onboard" | "app">("splash");
  const [tab, setTab] = useState<MobileTab>("home");
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStage(hasSeenOnboarding() ? "app" : "onboard");
    }, 1400);
    return () => window.clearTimeout(timer);
  }, []);

  const refreshProfile = useCallback(() => {
    setProfile(loadMerchantProfile());
  }, []);

  const refreshUnread = useCallback(() => {
    setUnread(unreadCount());
  }, []);

  useEffect(() => {
    // Post-hydration sync from device storage (profile + badge counts).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync; cannot be computed during render without breaking hydration.
    refreshProfile();
    refreshUnread();
    return subscribeNotifications(() => {
      refreshUnread();
    });
  }, [refreshProfile, refreshUnread]);

  // Real connectivity transitions feed the Alerts inbox (deduped, local).
  useEffect(() => {
    const wentOffline = () => {
      pushNotification({
        kind: "offline",
        title: "You went offline",
        body: "New collections will queue on this device and sync later.",
      });
    };
    const wentOnline = () => {
      pushNotification({
        kind: "online",
        title: "Back online",
        body: "Queued collections can sync now.",
      });
    };
    window.addEventListener("offline", wentOffline);
    window.addEventListener("online", wentOnline);
    return () => {
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("online", wentOnline);
    };
  }, []);

  if (stage === "splash") return <SplashScreen />;
  if (stage === "onboard") {
    return <OnboardingScreen onDone={() => setStage("app")} />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <MobileShell
        tab={tab}
        onTab={(next) => {
          setTab(next);
          if (next === "profile") refreshProfile();
        }}
        alertsUnread={unread}
      >
        {tab === "home" ? (
          <HomeScreen
            profile={profile}
            onCollect={() => setTab("collect")}
            onHistory={() => setTab("history")}
            onAlerts={() => setTab("alerts")}
            onProfile={() => setTab("profile")}
          />
        ) : null}
        {tab === "history" ? <HistoryScreen /> : null}
        {tab === "collect" ? <CollectScreen /> : null}
        {tab === "alerts" ? <AlertsScreen /> : null}
        {tab === "profile" ? <ProfileScreen /> : null}
      </MobileShell>
    </MotionConfig>
  );
}
