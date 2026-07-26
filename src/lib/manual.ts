import { RecentScan } from "./api";

export type RecentProduct = {
  productId: string;
  product: string;
  count?: number;
  availableToRemove: boolean;
};

export function recentProductsFromScans(scans: RecentScan[]): RecentProduct[] {
  const byProduct: Record<string, RecentProduct> = {};

  scans.forEach((scan) => {
    if (!scan.productId || byProduct[scan.productId]) return;
    byProduct[scan.productId] = {
      productId: scan.productId,
      product: scan.product,
      availableToRemove: scan.availableToRemove && scan.quantity > 0
    };
  });

  return Object.keys(byProduct).map((key) => byProduct[key]);
}

export function canConfirmAdjustment(
  action: "add" | "remove" | null,
  product: RecentProduct | null,
  isBusy: boolean
): boolean {
  if (!action || !product || isBusy) return false;
  if (action === "remove") return product.availableToRemove;
  return true;
}
