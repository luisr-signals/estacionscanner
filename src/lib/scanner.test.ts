import { describe, expect, it, vi } from "vitest";
import { canSubmitScan, createScanId, normalizeBarcode, scannerTone } from "./scanner";

describe("scanner capture helpers", () => {
  it("normalizes scanner input before sending it", () => {
    expect(normalizeBarcode(" 0888930260 \n")).toBe("0888930260");
    expect(normalizeBarcode("0888930260")).toHaveLength(10);
    expect(normalizeBarcode("0888 930260")).toBe("0888 930260");
    expect(normalizeBarcode("0888930260\n")).not.toBe("888930260");
  });

  it("blocks empty, busy, or offline submissions", () => {
    expect(canSubmitScan("123", false, true)).toBe(true);
    expect(canSubmitScan("", false, true)).toBe(false);
    expect(canSubmitScan("123", true, true)).toBe(false);
    expect(canSubmitScan("123", false, false)).toBe(false);
  });

  it("creates unique client scan ids", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
    const now = new Date("2026-07-25T18:42:49-06:00");
    const first = createScanId(now);
    const second = createScanId(now);
    expect(first).not.toEqual(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("uses window.crypto.getRandomValues when available for Safari-compatible UUIDs", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1;
      return bytes;
    });
    vi.stubGlobal("window", { crypto: { getRandomValues } });

    const id = createScanId();

    expect(getRandomValues).toHaveBeenCalled();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.unstubAllGlobals();
  });

  it("only defines sounds for confirmed success and server rejection", () => {
    expect(scannerTone("success")).toEqual({ frequency: 880, durationMs: 80 });
    expect(scannerTone("error")).toEqual({ frequency: 220, durationMs: 160 });
    expect(scannerTone("waiting")).toBeNull();
  });
});
