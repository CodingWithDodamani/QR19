import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createQueue } from "./service";

/**
 * Input/output validation at the queue boundary: every malformed merchant
 * input the Collect form can submit must be rejected with a clear error
 * before anything is persisted.
 */

function baseInput() {
  return {
    upiId: "test@okaxis",
    payeeName: "Test Shop",
    note: "Invoice 001",
    amountsPaise: [199900, 50200],
    expiresInSecs: 900,
    idempotencyKey: randomUUID(),
  };
}

describe("createQueue input validation", () => {
  it("rejects malformed UPI IDs", async () => {
    for (const upiId of ["", "a@b", "no-at-sign", "@bank", "name@", "a b@c", "x".repeat(61) + "@bank"]) {
      await expect(createQueue({ ...baseInput(), upiId })).rejects.toThrow(/UPI ID/);
    }
  });

  it("rejects blank or over-long payee names", async () => {
    await expect(createQueue({ ...baseInput(), payeeName: "   " })).rejects.toThrow(/Payee name/);
    await expect(createQueue({ ...baseInput(), payeeName: "x".repeat(101) })).rejects.toThrow(/Payee name/);
  });

  it("rejects bad amount lists and over-limit totals", async () => {
    await expect(createQueue({ ...baseInput(), amountsPaise: [] })).rejects.toThrow(/amountsPaise/);
    await expect(createQueue({ ...baseInput(), amountsPaise: [0] })).rejects.toThrow(/amountsPaise/);
    await expect(createQueue({ ...baseInput(), amountsPaise: [199901] })).rejects.toThrow(/amountsPaise/);
    await expect(
      createQueue({ ...baseInput(), amountsPaise: Array(101).fill(100) })
    ).rejects.toThrow(/amountsPaise/);
  });

  it("rejects duplicate amounts in unique-amounts mode", async () => {
    await expect(
      createQueue({ ...baseInput(), amountsPaise: [50000, 50000], uniqueAmounts: true })
    ).rejects.toThrow(/different/);
  });

  it("rejects short idempotency keys", async () => {
    await expect(createQueue({ ...baseInput(), idempotencyKey: "short" })).rejects.toThrow(
      /idempotency key/
    );
  });

  it("accepts a fully valid payload and returns a payable queue", async () => {
    const result = await createQueue(baseInput());
    expect(result.created).toBe(true);
    expect(result.state.queue.currentSeq).toBe(1);
    expect(result.state.orders).toHaveLength(2);
    expect(result.state.orders.every((o) => o.status === "pending" || o.status === "displayed")).toBe(true);
  });
});
