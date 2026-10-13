"use client";

import { QrCode } from "lucide-react";

/** Branded splash: logo + spinner, dismissed by the parent after a beat. */
export function SplashScreen() {
  return (
    <div className="ep-splash" role="status" aria-label="Loading QR19">
      <div className="ep-splash-logo">
        <QrCode size={40} aria-hidden="true" />
      </div>
      <p className="ep-splash-name">QR19</p>
      <p className="ep-splash-sub">Collect every rupee</p>
      <div className="ep-spinner" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ transform: `rotate(${i * 45}deg)` }} />
        ))}
      </div>
    </div>
  );
}
