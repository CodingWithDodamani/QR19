"use client";

import { useEffect, useState } from "react";

/** Reactive online status (iOS Safari + Android Chrome compatible). */
export function useOnline(): boolean {
  // SSR + first client render agree on `true` to avoid a hydration
  // mismatch — navigator.onLine is read only after mount.
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    // Post-hydration sync only; listeners keep it live afterwards.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync from navigator.onLine; cannot be computed during render without breaking hydration.
    setOnline(navigator.onLine !== false);
    const toOnline = () => setOnline(true);
    const toOffline = () => setOnline(false);
    window.addEventListener("online", toOnline);
    window.addEventListener("offline", toOffline);
    return () => {
      window.removeEventListener("online", toOnline);
      window.removeEventListener("offline", toOffline);
    };
  }, []);

  return online;
}
