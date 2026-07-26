import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "./idempotency";

describe("idempotency store", () => {
  it("returns the first saved result for the same user and scan id", () => {
    const store = new InMemoryIdempotencyStore<{ hourTotal: number }>();
    const first = store.save("user-1", "scan-1", { hourTotal: 10 });
    const second = store.save("user-1", "scan-1", { hourTotal: 11 });

    expect(second).toBe(first);
    expect(store.get("user-1", "scan-1")?.result.hourTotal).toBe(10);
  });

  it("isolates equal scan ids from different users", () => {
    const store = new InMemoryIdempotencyStore<{ hourTotal: number }>();
    store.save("user-1", "scan-1", { hourTotal: 10 });
    store.save("user-2", "scan-1", { hourTotal: 20 });

    expect(store.get("user-1", "scan-1")?.result.hourTotal).toBe(10);
    expect(store.get("user-2", "scan-1")?.result.hourTotal).toBe(20);
  });
});
