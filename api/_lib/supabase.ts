import { createClient, SupabaseClient } from "@supabase/supabase-js";

const PRODUCTION_USER_ID = "278a5fc3-be3d-460c-ae2c-fa890bfca685";
const SCANNER_ROLE = "scanner_operator";

type Banda = 1 | 2;

export type StationProfile = {
  userId: string;
  operatorName: string;
  role: "scanner_operator";
  bandId: Banda;
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

export type ManualAdjustmentPayload = {
  productId: string;
  quantity: 1 | -1;
  adjustmentId: string;
  profile: StationProfile;
};

export type SavedScan = {
  productId: string;
  product: string;
  scannedAt: string;
  hourTotal: number;
  hourGoal: number | null;
  dayTotal: number;
};

export type RecentScanData = {
  id: string;
  productId: string;
  product: string;
  scannedAt: string;
  quantity: 1 | -1;
  status: "saved" | "rejected" | "adjusted";
  availableToRemove: boolean;
};

type UsuarioRow = {
  id: string;
  nombre: string;
  correo: string;
  rol: string;
  banda_asignada: number | null;
  estacion: string | null;
};

type JornadaRow = {
  id: string;
  fecha: string;
  estado: "activa" | "cerrada";
  banda: Banda;
  meta_por_hora: number | string;
  deshabilitada?: boolean | null;
  motivo_deshabilitada?: string | null;
};

type RegistroHorarioRow = {
  id: string;
  hora_inicio_bloque: number | string;
  duracion: number | string;
  pares: number | null;
};

export class StationDataError extends Error {
  constructor(
    public code:
      | "TOKEN_EXPIRED"
      | "PROFILE_NOT_FOUND"
      | "USER_INACTIVE"
      | "INVALID_ROLE"
      | "MISSING_BAND"
      | "MISSING_STATION"
      | "RLS_BLOCKED"
      | "SUPABASE_QUERY_FAILED",
    message: string,
    public details?: Record<string, string | number | null>
  ) {
    super(message);
    this.name = "StationDataError";
  }
}

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

export async function getStationProfile(client: SupabaseClient): Promise<StationProfile> {
  const {
    data: { user },
    error: userError
  } = await client.auth.getUser();

  if (userError || !user) {
    logStationIssue("auth.getUser", "TOKEN_EXPIRED", { supabaseCode: userError?.code ?? null });
    throw new StationDataError("TOKEN_EXPIRED", "Tu sesion vencio. Inicia sesion nuevamente.");
  }

  const { data, error } = await client
    .from("usuarios")
    .select("id,nombre,correo,rol,banda_asignada,estacion")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    logStationIssue("usuarios.select", classifySupabaseError(error), {
      userId: user.id,
      supabaseCode: error.code ?? null
    });
    throw new StationDataError(classifySupabaseError(error), "No fue posible leer el perfil operativo.");
  }

  const profile = data as UsuarioRow | null;
  if (!profile) {
    throw new StationDataError("PROFILE_NOT_FOUND", "No encontramos el perfil operativo de esta cuenta.", {
      userId: user.id
    });
  }

  if (profile.rol !== SCANNER_ROLE) {
    throw new StationDataError("INVALID_ROLE", "Esta cuenta no tiene permiso para utilizar Estacion 337.", {
      userId: user.id
    });
  }

  if (profile.banda_asignada !== 1 && profile.banda_asignada !== 2) {
    throw new StationDataError("MISSING_BAND", "La cuenta no tiene una banda asignada.", { userId: user.id });
  }

  if (!profile.estacion || !profile.estacion.trim()) {
    throw new StationDataError("MISSING_STATION", "La cuenta no tiene una estacion asignada.", { userId: user.id });
  }

  return {
    userId: user.id,
    operatorName: profile.nombre,
    role: SCANNER_ROLE,
    bandId: profile.banda_asignada,
    bandName: "Banda " + profile.banda_asignada,
    stationId: profile.estacion
  };
}

export async function getStationStatus(client: SupabaseClient, profile: StationProfile): Promise<StationStatusData> {
  const { data: jornadaData, error: jornadaError } = await client
    .from("jornadas")
    .select("*")
    .eq("usuario_id", PRODUCTION_USER_ID)
    .eq("banda", profile.bandId)
    .eq("estado", "activa")
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jornadaError) {
    logStationIssue("jornadas.select", classifySupabaseError(jornadaError), {
      userId: profile.userId,
      supabaseCode: jornadaError.code ?? null
    });
    throw new StationDataError(classifySupabaseError(jornadaError), "No fue posible leer la jornada activa.");
  }

  const jornada = jornadaData as JornadaRow | null;
  if (!jornada) {
    return {
      operatorName: profile.operatorName,
      bandName: profile.bandName,
      stationId: profile.stationId,
      shiftStatus: "missing",
      scannerStatus: "paused",
      hourTotal: 0,
      hourGoal: null,
      dayTotal: 0,
      pendingCount: 0
    };
  }

  const { data: registrosData, error: registrosError } = await client
    .from("registros_horarios")
    .select("id,hora_inicio_bloque,duracion,pares")
    .eq("jornada_id", jornada.id)
    .order("orden", { ascending: true });

  if (registrosError) {
    logStationIssue("registros_horarios.select", classifySupabaseError(registrosError), {
      userId: profile.userId,
      supabaseCode: registrosError.code ?? null
    });
    throw new StationDataError(classifySupabaseError(registrosError), "No fue posible leer los bloques horarios.");
  }

  const registros = (registrosData ?? []) as RegistroHorarioRow[];
  const currentBlock = findCurrentBlock(registros);
  const dayTotal = registros.reduce((total, registro) => total + (registro.pares ?? 0), 0);
  const isDisabled = Boolean(jornada.deshabilitada);

  return {
    operatorName: profile.operatorName,
    bandName: profile.bandName,
    stationId: profile.stationId,
    shiftStatus: isDisabled ? "paused" : "active",
    scannerStatus: !isDisabled && currentBlock ? "ready" : "paused",
    hourTotal: currentBlock ? currentBlock.pares ?? 0 : 0,
    hourGoal: currentBlock ? Math.round(Number(currentBlock.duracion) * Number(jornada.meta_por_hora)) : null,
    dayTotal,
    pendingCount: await getPendingConfirmationCount(client, jornada.id, profile.bandId)
  };
}

export async function saveStationScan(_client: SupabaseClient, _payload: ScanPayload): Promise<SavedScan> {
  throw new Error("SCHEMA_MAPPING_REQUIRED");
}

export async function saveManualAdjustment(
  _client: SupabaseClient,
  _payload: ManualAdjustmentPayload
): Promise<SavedScan> {
  throw new Error("SCHEMA_MAPPING_REQUIRED");
}

export async function getRecentScans(_client: SupabaseClient, _profile: StationProfile): Promise<RecentScanData[]> {
  return [];
}

export function schemaMappingMessage() {
  return "Falta mapear el esquema real de Supabase antes de escribir registros de produccion.";
}

function findCurrentBlock(registros: RegistroHorarioRow[], now = new Date()): RegistroHorarioRow | null {
  const hour = mexicoDecimalHour(now);
  for (const registro of registros) {
    const start = Number(registro.hora_inicio_bloque);
    const end = start + Number(registro.duracion);
    if (hour >= start && hour < end) return registro;
  }
  return null;
}

function mexicoDecimalHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const second = Number(parts.find((part) => part.type === "second")?.value ?? 0);
  return hour + minute / 60 + second / 3600;
}

async function getPendingConfirmationCount(client: SupabaseClient, jornadaId: string, bandId: Banda): Promise<number> {
  const { count, error } = await client
    .from("confirmaciones_bloque")
    .select("id", { count: "exact", head: true })
    .eq("jornada_id", jornadaId)
    .eq("banda", bandId)
    .eq("estado", "pendiente");

  if (error) {
    logStationIssue("confirmaciones_bloque.count", classifySupabaseError(error), {
      supabaseCode: error.code ?? null
    });
    return 0;
  }

  return count ?? 0;
}

function classifySupabaseError(error: { code?: string; message?: string }): StationDataError["code"] {
  if (error.code === "42501" || /permission|rls|policy/i.test(error.message ?? "")) return "RLS_BLOCKED";
  return "SUPABASE_QUERY_FAILED";
}

function logStationIssue(operation: string, code: string, details: Record<string, string | number | null>) {
  console.error("[station-data]", { operation, code, ...details });
}
