import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type StationProfile = {
  userId: string;
  operatorName: string;
  role: "scanner_operator";
  bandId: string;
  bandName: string;
  stationId: string;
};

export type StationStatusData = {
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

export type ScanPayload = {
  barcode: string;
  scanId: string;
  profile: StationProfile;
};

export type SavedScan = {
  product: string;
  scannedAt: string;
  hourTotal: number;
  hourGoal: number | null;
  dayTotal: number;
};

export type RecentScanData = {
  id: string;
  product: string;
  scannedAt: string;
  status: "saved" | "rejected";
};

export function getSupabaseForToken(accessToken: string): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: "Bearer " + accessToken
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function getStationProfile(_client: SupabaseClient): Promise<StationProfile> {
  throw new Error("SCHEMA_MAPPING_REQUIRED");
}

export async function getStationStatus(_client: SupabaseClient, _profile: StationProfile): Promise<StationStatusData> {
  throw new Error("SCHEMA_MAPPING_REQUIRED");
}

export async function saveStationScan(_client: SupabaseClient, _payload: ScanPayload): Promise<SavedScan> {
  throw new Error("SCHEMA_MAPPING_REQUIRED");
}

export async function getRecentScans(_client: SupabaseClient, _profile: StationProfile): Promise<RecentScanData[]> {
  throw new Error("SCHEMA_MAPPING_REQUIRED");
}

export function schemaMappingMessage() {
  return "Falta mapear el esquema real de Supabase antes de escribir registros de produccion.";
}
