import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/payment/rate-limit";
import { getPspCredentials } from "@/lib/payment/psp-settings";
import { razorpayFetchQrImage } from "@/lib/payment/razorpay";

export const dynamic = "force-dynamic";

/**
 * GET /api/psp/qr-image/:qrId — server-side proxy for a REAL Razorpay QR
 * image (public; rate-limited).
 *
 * Why a proxy instead of hot-linking Razorpay's image_url? The short link
 * must be fetched server-side to be certain about content-type and to keep
 * the display device free of third-party requests. Only QR ids that this
 * app itself provisioned (present on a PaymentOrder row) are proxied —
 * this is never an open proxy.
 *
 * Images are cached in memory for 10 minutes (a static QR artwork).
 */

interface CachedImage {
  bytes: Buffer;
  contentType: string;
  expiresAt: number;
}

const globalForQrImages = globalThis as unknown as {
  __pspQrImageCache: Map<string, CachedImage> | undefined;
};

function cache(): Map<string, CachedImage> {
  if (!globalForQrImages.__pspQrImageCache) {
    globalForQrImages.__pspQrImageCache = new Map();
  }
  return globalForQrImages.__pspQrImageCache;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ qrId: string }> }
) {
  const limit = await rateLimit(request, "pspQrImage");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many image requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const { qrId } = await params;
  if (!/^qr_[A-Za-z0-9]+$/.test(qrId)) {
    return NextResponse.json({ error: "Invalid QR id." }, { status: 400 });
  }

  const cached = cache().get(qrId);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(new Uint8Array(cached.bytes), {
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // Only images this app provisioned are proxied (never an open proxy).
  const order = await db.paymentOrder.findFirst({
    where: { providerQrId: qrId },
    select: { providerQrImageUrl: true },
  });
  if (!order?.providerQrImageUrl) {
    return NextResponse.json({ error: "No such provider QR." }, { status: 404 });
  }

  const creds = await getPspCredentials();
  if (!creds) {
    return NextResponse.json({ error: "PSP not configured." }, { status: 404 });
  }

  const image = await razorpayFetchQrImage(creds, order.providerQrImageUrl);
  if (!image) {
    return NextResponse.json(
      { error: "The provider's QR image could not be fetched right now." },
      { status: 502 }
    );
  }

  cache().set(qrId, { ...image, expiresAt: Date.now() + 10 * 60_000 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
