export type LoginResponse =
  | { ok: true; operatorName: string; bandName: string; shiftStatus: string }
  | { ok: false; code: string; message: string };

export type StationStatus = {
  ok: true;
  operatorName: string;
  bandName: string;
  stationId: string;
  shiftStatus: "active" | "missing" | "paused";
  scannerStatus: "ready" | "paused" | "offline";
  hourTotal: number;
  hourGoal: number | null;
  dayTotal: number;
  pendingCount: number;
};

export type ScanResult =
  | {
      ok: true;
      product: string;
      scannedAt: string;
      hourTotal: number;
      hourGoal: number | null;
      dayTotal: number;
      duplicate: boolean;
    }
  | { ok: false; code: string; message: string; retryable?: boolean };

export type RecentScan = {
  id: string;
  product: string;
  scannedAt: string;
  status: "saved" | "rejected";
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

export function getStatus() {
  return requestJson<StationStatus | { ok: false; message: string }>("/api/station/status");
}

export function getRecent() {
  return requestJson<{ ok: true; scans: RecentScan[] } | { ok: false; message: string }>(
    "/api/station/recent"
  );
}

export function submitScan(barcode: string, scanId: string) {
  return requestJson<ScanResult>("/api/station/scan", {
    method: "POST",
    body: JSON.stringify({ barcode, scanId })
  });
}
