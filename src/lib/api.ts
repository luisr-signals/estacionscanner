export type LoginResponse =
  | { ok: true; operatorName: string; bandName: string; shiftStatus: string; stationMode: StationMode; redirectPath: string }
  | { ok: false; code: string; message: string };

export type StationMode = "scanner" | "band_display";

export type ProfileResponse =
  | {
      ok: true;
      operatorName: string;
      bandName: string;
      stationId: string;
      stationMode: StationMode;
      redirectPath: string;
    }
  | { ok: false; code: string; message: string; retryable?: boolean };

export type StationStatus = {
  ok: true;
  operatorName: string;
  bandName: string;
  stationId: string;
  shiftStatus: "active" | "missing" | "closed";
  blockStatus: "active" | "break" | "outside_schedule" | "missing";
  scannerStatus: "ready" | "paused" | "disabled";
  statusTitle: string;
  statusDetail: string;
  hourTotal: number;
  hourGoal: number | null;
  dayTotal: number;
  pendingCount: number;
};

export type MovementQuantity = 1 | -1;

export type ScanResult =
  | {
      ok: true;
      product: string;
      productId?: string;
      scannedAt: string;
      hourTotal: number;
      hourGoal: number | null;
      dayTotal: number;
      duplicate: boolean;
    }
  | { ok: false; code: string; message: string; retryable?: boolean };

export type RecentScan = {
  id: string;
  productId: string;
  product: string;
  scannedAt: string;
  quantity: MovementQuantity;
  status: "saved" | "rejected" | "adjusted";
  availableToRemove: boolean;
};

export type ManualProduct = {
  productId: string;
  product: string;
  count: number;
  availableToRemove: boolean;
};

export type AdjustmentResult =
  | {
      ok: true;
      product: string;
      productId: string;
      quantity: MovementQuantity;
      adjustedAt: string;
      hourTotal: number;
      hourGoal: number | null;
      dayTotal: number;
      duplicate: boolean;
    }
  | { ok: false; code: string; message: string; retryable?: boolean };

export type DisplayStatus = {
  ok: true;
  bandName: string;
  stationId: string;
  shiftStatus: "active" | "missing" | "closed";
  blockStatus: "active" | "break" | "outside_schedule" | "missing";
  statusTitle: string;
  statusDetail: string;
  serverTime: string;
  blockEndsAt: string | null;
  nextBlockStartsAt: string | null;
  hourTotal: number;
  hourGoal: number | null;
  hourRemaining: number | null;
  dayTotal: number;
  dayGoal: number;
  dayRemaining: number;
  expectedTotal: number;
  delay: number;
  ahead: number;
  productiveSecondsRemaining: number;
  currentAveragePerMinute: number;
  idealAveragePerMinute: number;
  projectedResult: number;
  projectedCompliance: number | null;
  paceStatus: "on_track" | "ahead" | "behind";
  paceLabel: string;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {})
    },
    ...init
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && body) return body as T;
  if (!body) throw new Error("Respuesta invalida del servidor");
  return body as T;
}

export function login(email: string, password: string) {
  return requestJson<LoginResponse>("/api/station/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function logout() {
  return requestJson<{ ok: boolean }>("/api/station/logout", { method: "POST" });
}

export function refreshSession() {
  return requestJson<{ ok: boolean } | { ok: false; code: string; message: string }>("/api/station/refresh", {
    method: "POST"
  });
}

export function getProfile() {
  return requestJson<ProfileResponse>("/api/station/profile");
}

export function getStatus() {
  return requestJson<StationStatus | { ok: false; code: string; message: string }>("/api/station/status");
}

export function getDisplayStatus() {
  return requestJson<DisplayStatus | { ok: false; code: string; message: string; retryable?: boolean }>(
    "/api/display/status"
  );
}

export function getRecent() {
  return requestJson<{ ok: true; scans: RecentScan[] } | { ok: false; message: string }>(
    "/api/station/recent"
  );
}

export function getManualProducts() {
  return requestJson<{ ok: true; products: ManualProduct[] } | { ok: false; code: string; message: string }>(
    "/api/station/manual-products"
  );
}

export function submitScan(barcode: string, scanId: string) {
  return requestJson<ScanResult>("/api/station/scan", {
    method: "POST",
    body: JSON.stringify({ barcode, scanId })
  });
}

export function submitAdjustment(productId: string, quantity: MovementQuantity, adjustmentId: string) {
  return requestJson<AdjustmentResult>("/api/station/adjust", {
    method: "POST",
    body: JSON.stringify({ productId, quantity, adjustmentId })
  });
}
