import { subscribe, type Subscriber } from "@/lib/payment/event-bus";
import { resolvePaymentMode } from "@/lib/payment/psp-settings";
import {
  getQueueState,
  pollCurrentOrderPayments,
  publishState,
} from "@/lib/payment/service";
import type { SseMessage } from "@/lib/payment/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/payment-queues/:id/events — Server-Sent Events stream.
 *
 * The display device's single real-time channel:
 * - `hello`    → payment mode (demo|live)
 * - `state`    → full authoritative snapshot (sent on connect + on every
 *                server-side change; the client replaces its whole view,
 *                so resync after a reconnect is automatic and stateless)
 * - `notice`   → transient non-blocking messages (declines, mismatches…)
 * - `:ping`    → 25s heartbeat; each beat also reaps expired orders
 *                server-side so expiry works even with a connected screen
 *                and no other traffic.
 *
 * The client NEVER polls this or guesses success — advances arrive here.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const mode = await resolvePaymentMode();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (message: SseMessage) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by the platform
        }
      };

      request.signal.addEventListener("abort", cleanup);

      // 1. Immediate authoritative snapshot — this IS the resync.
      const state = await getQueueState(id);
      if (!state) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "notice", notice: { id: "init", kind: "order_expired", message: "Queue not found." } })}\n\n`)
        );
        cleanup();
        return;
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "hello", mode })}\n\n`));
      send({ type: "state", state });

      // 2. Live push for every server-side change.
      const subscriber: Subscriber = (message) => send(message);
      unsubscribe = subscribe(id, subscriber);

      // 2b. Webhook-less verification fallback (Razorpay modes): on every
      //     fresh connection, check the provider for payments that may have
      //     landed while no screen was connected.
      void pollCurrentOrderPayments(id).catch(() => undefined);

      // 3. Heartbeat: keeps proxies from closing the stream, reaps expired
      //    orders server-side, and — in Razorpay modes — polls the provider
      //    for captured payments on the current QR so a queue advances even
      //    when webhooks cannot reach this deployment.
      heartbeat = setInterval(() => {
        if (closed) return;
        void publishState(id).catch(() => undefined);
        void pollCurrentOrderPayments(id).catch(() => undefined);
        try {
          controller.enqueue(encoder.encode(`:ping\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
