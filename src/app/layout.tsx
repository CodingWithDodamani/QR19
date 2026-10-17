import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Inter_Tight } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { GoogleAnalytics } from "@/components/analytics";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const interTight = Inter_Tight({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QR19 — Collect the full amount",
  description:
    "Collect the full amount with UPI QR codes of ₹1,999 or less. No setup or transaction fees.",
  keywords: [
    "UPI QR code",
    "split bill QR",
    "collect UPI payments",
    "merchant QR collection",
    "PhonePe",
    "Paytm",
    "Razorpay",
    "offline UPI collection",
  ],
  openGraph: {
    title: "QR19 — Collect the full amount",
    description:
      "Split any bill into UPI QR codes of ₹1,999 or less and collect the full amount, one provider-verified payment at a time.",
    type: "website",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "QR19",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#121a26",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${interTight.variable} ${geistSans.variable} ${geistMono.variable}`}
    >
      {/* suppressHydrationWarning: browser extensions stamp attributes onto
          <body> before React hydrates (e.g. `__processed_<uuid>__`); this
          silences attribute-only diffs on body itself — child mismatches are
          still detected. */}
      <body
        suppressHydrationWarning
        className="antialiased bg-background text-foreground"
      >
        <GoogleAnalytics />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
