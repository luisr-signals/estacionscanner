import { describe, expect, it } from "vitest";
import { RecentScan } from "./api";
import { canConfirmAdjustment, recentProductsFromScans } from "./manual";

const scans: RecentScan[] = [
  {
    id: "1",
    productId: "p1",
    product: "470D325 · Miel negro outdoor · Talla 23",
    quantity: 1,
    scannedAt: "2026-07-25T17:15:17-06:00",
    status: "saved",
    availableToRemove: true
  },
  {
    id: "2",
    productId: "p1",
    product: "470D325 · Miel negro outdoor · Talla 23",
    quantity: 1,
    scannedAt: "2026-07-25T17:15:12-06:00",
    status: "saved",
    availableToRemove: true
  },
  {
    id: "3",
    productId: "p2",
    product: "807 Oxford · Negro · Talla 24",
    quantity: -1,
    scannedAt: "2026-07-25T17:15:08-06:00",
    status: "adjusted",
    availableToRemove: false
  }
];

describe("manual adjustment helpers", () => {
  it("keeps only recent unique products", () => {
    expect(recentProductsFromScans(scans)).toEqual([
      {
        productId: "p1",
        product: "470D325 · Miel negro outdoor · Talla 23",
        availableToRemove: true
      },
      {
        productId: "p2",
        product: "807 Oxford · Negro · Talla 24",
        availableToRemove: false
      }
    ]);
  });

  it("blocks remove when the product has no available positive movement", () => {
    const products = recentProductsFromScans(scans);
    expect(canConfirmAdjustment("remove", products[0], false)).toBe(true);
    expect(canConfirmAdjustment("remove", products[1], false)).toBe(false);
    expect(canConfirmAdjustment("add", products[1], false)).toBe(true);
    expect(canConfirmAdjustment("add", products[1], true)).toBe(false);
  });
});
