export type ScannerState = "ready" | "waiting" | "success" | "error" | "offline" | "paused";

export function normalizeBarcode(value: string): string {
  return value.trim();
}

export function normalizeDefectCode(rawValue: string): string {
  const candidate = stripControlCharacters(rawValue).trim();
  const match = candidate.match(/^DEF['’´`-](\d{1,2})$/i);

  if (!match) return rawValue.trim();

  const defectNumber = Number(match[1]);
  if (defectNumber < 1 || defectNumber > 24) return rawValue.trim();

  return "DEF-" + String(defectNumber).padStart(2, "0");
}

function stripControlCharacters(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 31) || code === 127) continue;
    normalized += value.charAt(index);
  }
  return normalized;
}

export function canSubmitScan(value: string, isBusy: boolean, isOnline: boolean): boolean {
  return normalizeBarcode(value).length > 0 && !isBusy && isOnline;
}

export function createScanId(now = new Date()): string {
  const bytes = new Uint8Array(16);
  const cryptoSource = getCryptoSource();
  if (cryptoSource && cryptoSource.getRandomValues) {
    cryptoSource.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes, now);
}

export function scannerTone(result: ScannerState): { frequency: number; durationMs: number } | null {
  if (result === "success") return { frequency: 880, durationMs: 80 };
  if (result === "error") return { frequency: 220, durationMs: 160 };
  return null;
}

function formatUuid(bytes: Uint8Array, _now: Date): string {
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

function getCryptoSource(): Crypto | null {
  if (
    typeof window !== "undefined" &&
    window.crypto &&
    typeof window.crypto.getRandomValues === "function"
  ) {
    return window.crypto;
  }
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    return globalThis.crypto;
  }
  return null;
}
