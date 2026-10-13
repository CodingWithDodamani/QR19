import type { Metadata } from "next";

import { MobileApp } from "@/components/mobile/mobile-app";

export const metadata: Metadata = {
  title: "QR19 App — Collect payments",
  description: "The QR19 mobile app interface: collect split UPI payments with offline queueing.",
};

export default function AppRoutePage() {
  return <MobileApp />;
}
