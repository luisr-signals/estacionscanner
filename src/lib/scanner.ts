export type ScannerState = "ready" | "waiting" | "success" | "error" | "offline" | "paused";

export function normalizeBarcode(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

export function canSubmitScan(value: string, isBusy: boolean, isOnline: boolean): boolean {
  return normalizeBarcode(value).length > 0 && !isBusy && isOnline;
}

export function createScanId(now = new Date()): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return "scan-" + now.getTime().toString(36) + "-" + randomPart;
}

export function scannerTone(result: ScannerState): { frequency: number; durationMs: number } | null {
  if (result === "success") return { frequency: 880, durationMs: 80 };
  if (result === "error") return { frequency: 220, durationMs: 160 };
  return null;
}
