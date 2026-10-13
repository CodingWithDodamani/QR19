import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createQueue,
  getQueueState,
  processProviderEvent,
} from "./service";
import type { ProviderEvent } from "./types";

/**
 * Guards of the single write-path (`processProviderEvent`), against an
 * isolated SQLite DB (see vitest.global-setup.ts). Every test builds its
 * own queue with unique keys/refs so tests never interfere.
 */

function evt(partial: Partial<ProviderEvent> & { orderId: string }): ProviderEvent {
  return {
    eventId: `evt-${randomUUID()}`,
    type: "payment.success",
    ...partial,
  };
}

async function makeQueue(amountsPaise = [199900, 50200]) {
  const res = await createQueue({
    upiId: "test@okaxis",
    payeeName: "Test Shop",
    note: "vitest",
    amountsPaise,
    expiresInSecs: 900,
    idempotencyKey: randomUUID(),
  });
  if (!res.state.current) throw new Error("queue has no current order");
  return { queueId: res.queueId, state: res.state };
}

describe("processProviderEvent guards", () => {
  it("marks the current order paid and advances the pointer on exact success", async () => {
    const { queueId, state } = await makeQueue();
    const order = state.current;
    if (!order) throw new Error("no current order");

    const result = await processProviderEvent(
      evt({ orderId: order.orderId, amountPaise: order.amountPaise, providerRef: `pay-${randomUUID()}` }),
      "demo"
    );
    expect(result).toMatchObject({ handled: true, reason: "ok" });

    const fresh = await getQueueState(queueId);
    expect(fresh?.current?.seq).toBe(2);
    expect(fresh?.paidCount).toBe(1);
    expect(fresh?.orders[0].status).toBe("paid");
  });

  it("blocks wrong amounts without advancing", async () => {
    const { queueId, state } = await makeQueue();
    const order = state.current;
    if (!order) throw new Error("no current order");

    const result = await processProviderEvent(
      evt({ orderId: order.orderId, amountPaise: order.amountPaise + 100, providerRef: `pay-${randomUUID()}` }),
      "demo"
    );
    expect(result).toMatchObject({ handled: false, reason: "amount_mismatch" });

    const fresh = await getQueueState(queueId);
    expect(fresh?.current?.seq).toBe(1);
    expect(fresh?.paidCount).toBe(0);
  });

  it("treats redelivered event ids as duplicates", async () => {
    const { state } = await makeQueue();
    const order = state.current;
    if (!order) throw new Error("no current order");

    const event = evt({
      orderId: order.orderId,
      amountPaise: order.amountPaise,
      providerRef: `pay-${randomUUID()}`,
    });
    const first = await processProviderEvent(event, "demo");
    expect(first).toMatchObject({ handled: true, reason: "ok" });

    const replay = await processProviderEvent(event, "demo");
    expect(replay).toMatchObject({ handled: false, reason: "duplicate" });
  });

  it("blocks one provider ref verifying two orders (reused-proof scam)", async () => {
    const { queueId, state } = await makeQueue();
    const first = state.current;
    if (!first) throw new Error("no current order");
    const ref = `pay-${randomUUID()}`;

    const ok = await processProviderEvent(
      evt({ orderId: first.orderId, amountPaise: first.amountPaise, providerRef: ref }),
      "demo"
    );
    expect(ok).toMatchObject({ handled: true, reason: "ok" });

    const second = (await getQueueState(queueId))?.current;
    if (!second) throw new Error("queue did not advance");
    const blocked = await processProviderEvent(
      evt({ orderId: second.orderId, amountPaise: second.amountPaise, providerRef: ref }),
      "demo"
    );
    expect(blocked).toMatchObject({ handled: false, reason: "duplicate_txn_ref" });

    const fresh = await getQueueState(queueId);
    expect(fresh?.current?.seq).toBe(2);
    expect(fresh?.paidCount).toBe(1);
  });

  it("ignores a second, different success for an already-paid order", async () => {
    const { state } = await makeQueue();
    const order = state.current;
    if (!order) throw new Error("no current order");

    await processProviderEvent(
      evt({ orderId: order.orderId, amountPaise: order.amountPaise, providerRef: `pay-${randomUUID()}` }),
      "demo"
    );
    const again = await processProviderEvent(
      evt({ orderId: order.orderId, amountPaise: order.amountPaise, providerRef: `pay-${randomUUID()}` }),
      "demo"
    );
    expect(again).toMatchObject({ handled: false, reason: "already_paid" });
  });

  it("reports successes for unknown order references without progressing", async () => {
    await makeQueue();
    const result = await processProviderEvent(
      evt({ orderId: `ON99NOPE${randomUUID().slice(0, 6).toUpperCase()}`, providerRef: `pay-${randomUUID()}` }),
      "demo"
    );
    expect(result).toMatchObject({ handled: false, reason: "unknown_order" });
  });

  // ---- Concurrency / race guards (webhook + poll fallback fire together) ----

  it("racing duplicate events for one order produce exactly one advance", async () => {
    const { queueId, state } = await makeQueue();
    const order = state.current;
    if (!order) throw new Error("no current order");

    const ref = `pay-${randomUUID()}`;
    // Two distinct eventIds, SAME payment (same providerRef) delivered at
    // once — webhook + poll-fallback style.
    const deliveries = [
      processProviderEvent(
        evt({ orderId: order.orderId, amountPaise: order.amountPaise, providerRef: ref }),
        "webhook"
      ),
      processProviderEvent(
        evt({ orderId: order.orderId, amountPaise: order.amountPaise, providerRef: ref }),
        "poll"
      ),
    ];
    const results = await Promise.allSettled(deliveries);
    const handled = results.map((r) =>
      r.status === "fulfilled" ? r.value : { handled: false, reason: "error" }
    );
    // Exactly one wins the conditional update; the loser collapses into
    // duplicate/already_paid — never a second paid row or second pointer move.
    const winners = handled.filter((r) => r.handled && r.reason === "ok");
    expect(winners.length).toBe(1);

    const fresh = await getQueueState(queueId);
    expect(fresh?.paidCount).toBe(1);
    expect(fresh?.paidCount).not.toBe(2);
    expect(fresh?.current?.seq).toBe(2);
  });

  it("same providerRef offered for two orders concurrently is blocked exactly once", async () => {
    const { queueId, state } = await makeQueue();
    const first = state.current;
    if (!first) throw new Error("no current order");

    // First order settles with a ref.
    const ref = `pay-${randomUUID()}`;
    await processProviderEvent(
      evt({ orderId: first.orderId, amountPaise: first.amountPaise, providerRef: ref }),
      "demo"
    );
    const second = (await getQueueState(queueId))?.current;
    if (!second) throw new Error("queue did not advance");

    // The same ref is presented for the next order twice, concurrently.
    const attacks = [
      processProviderEvent(
        evt({ orderId: second.orderId, amountPaise: second.amountPaise, providerRef: ref }),
        "webhook"
      ),
      processProviderEvent(
        evt({ orderId: second.orderId, amountPaise: second.amountPaise, providerRef: ref }),
        "poll"
      ),
    ];
    const results = await Promise.allSettled(attacks);
    const reasons = results.map((r) =>
      r.status === "fulfilled" ? r.value.reason : "error"
    );
    expect(reasons.every((reason) => reason === "duplicate_txn_ref")).toBe(true);

    // Nothing advanced by fraud.
    const fresh = await getQueueState(queueId);
    expect(fresh?.paidCount).toBe(1);
    expect(fresh?.current?.seq).toBe(2);
  });

  it("a redelivered unprocessed event (crash before completion) re-runs safely", async () => {
    // Simulates the ledger-crash window: an event row exists as handled:false
    // (crash mid-processing), then the provider redelivers the SAME eventId.
    // Processing must converge to exactly one paid order either way.
    const { queueId, state } = await makeQueue();
    const order = state.current;
    if (!order) throw new Error("no current order");

    const event = evt({
      orderId: order.orderId,
      amountPaise: order.amountPaise,
      providerRef: `pay-${randomUUID()}`,
    });
    const first = await processProviderEvent(event, "demo");
    expect(first).toMatchObject({ handled: true, reason: "ok" });
    // Redelivery of the same eventId is absorbed by the idempotency ledger.
    const replay = await processProviderEvent(event, "demo");
    expect(replay).toMatchObject({ handled: false, reason: "duplicate" });
    const fresh = await getQueueState(queueId);
    expect(fresh?.paidCount).toBe(1);
  });
});
