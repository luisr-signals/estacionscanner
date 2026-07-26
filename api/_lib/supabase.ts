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
  duplicate: boolean;
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

type ProductoRow = {
  id: string;
  codigo_id: string;
  cliente_marca: string | null;
  modelo: string | null;
  color: string | null;
  talla: string | null;
  estado: string;
};

type ProduccionEventoRow = {
  id: string;
  codigo: string;
  hora_registro: string;
  hora_local: string | null;
  producto_id: string | null;
  cantidad: 1;
  estado: "activo" | "anulado";
  productos?: ProductoRow | null;
};

type NormalizedEvent = ProduccionEventoRow & {
  products: ProductoRow | null;
};

type ScannerRpcRow = {
  evento_id: string;
  registro_horario_id: string;
  pares_bloque: number;
  producto_id: string | null;
  duplicado: boolean;
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

export class StationScanError extends Error {
  constructor(
    public code:
      | "INVALID_SCAN_ID"
      | "UNKNOWN_BARCODE"
      | "SHIFT_INACTIVE"
      | "OUTSIDE_HOUR_BLOCK"
      | "SCAN_PERMISSION_DENIED"
      | "SCAN_FAILED",
    message: string,
    public status: number,
    public retryable = false
  ) {
    super(message);
    this.name = "StationScanError";
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

export async function saveStationScan(client: SupabaseClient, payload: ScanPayload): Promise<SavedScan> {
  const scanId = payload.scanId.trim();
  if (!isUuid(scanId)) {
    throw new StationScanError("INVALID_SCAN_ID", "Identificador de escaneo invalido.", 400);
  }

  const barcode = payload.barcode.trim();
  const product = await findActiveProductByCode(client, barcode);
  if (!product) {
    throw new StationScanError("UNKNOWN_BARCODE", "Codigo no reconocido", 404);
  }

  const { data: rpcData, error: rpcError } = await client.rpc("registrar_escaneo_scanner", {
    p_cliente_uuid: scanId,
    p_codigo: barcode
  });

  if (rpcError) {
    const message = rpcError.message ?? "";
    logStationIssue("registrar_escaneo_scanner.rpc", rpcError.code ?? "RPC_ERROR", {
      userId: payload.profile.userId,
      supabaseCode: rpcError.code ?? null
    });
    if (rpcError.code === "42501" || /autorizado|permission|permiso/i.test(message)) {
      throw new StationScanError("SCAN_PERMISSION_DENIED", "Esta cuenta no tiene permiso para registrar escaneos.", 403);
    }
    if (rpcError.code === "P0002" && /jornada/i.test(message)) {
      throw new StationScanError("SHIFT_INACTIVE", "La jornada de " + payload.profile.bandName + " no esta disponible.", 409);
    }
    if (rpcError.code === "P0002" && /bloque/i.test(message)) {
      throw new StationScanError("OUTSIDE_HOUR_BLOCK", "Fuera de bloque horario.", 409);
    }
    throw new StationScanError("SCAN_FAILED", "No fue posible guardar el registro.", 500, true);
  }

  const rpcRow = normalizeRpcResult(rpcData);
  if (!rpcRow) {
    throw new StationScanError("SCAN_FAILED", "La respuesta del registro no fue valida.", 500, true);
  }

  const { data: eventData, error: eventError } = await client
    .from("produccion_eventos")
    .select("id,codigo,hora_registro,hora_local,producto_id,cantidad,estado,productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
    .eq("id", rpcRow.evento_id)
    .maybeSingle();

  if (eventError || !eventData) {
    throw new StationScanError("SCAN_FAILED", "El registro se guardo, pero no fue posible leer la confirmacion.", 500, true);
  }

  const dayTotal = await getDayTotal(client, rpcRow.evento_id);
  const hourGoal = await getHourGoalForRegister(client, rpcRow.registro_horario_id);
  const event = normalizeEvent(eventData);
  const canonicalProduct = event.products ?? product;

  return {
    productId: canonicalProduct.id,
    product: formatProduct(canonicalProduct),
    scannedAt: event.hora_registro,
    hourTotal: rpcRow.pares_bloque,
    hourGoal,
    dayTotal,
    duplicate: rpcRow.duplicado
  };
}

export async function saveManualAdjustment(
  _client: SupabaseClient,
  _payload: ManualAdjustmentPayload
): Promise<SavedScan> {
  throw new Error("SCHEMA_MAPPING_REQUIRED");
}

export async function getRecentScans(client: SupabaseClient, profile: StationProfile): Promise<RecentScanData[]> {
  const jornada = await getActiveJourney(client, profile.bandId);
  if (!jornada) return [];

  const { data, error } = await client
    .from("produccion_eventos")
    .select("id,codigo,hora_registro,hora_local,producto_id,cantidad,estado,productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
    .eq("jornada_id", jornada.id)
    .eq("banda", profile.bandId)
    .order("hora_registro", { ascending: false })
    .limit(10);

  if (error) {
    logStationIssue("produccion_eventos.recent", classifySupabaseError(error), {
      userId: profile.userId,
      supabaseCode: error.code ?? null
    });
    throw new StationDataError(classifySupabaseError(error), "No fue posible leer los ultimos escaneos.");
  }

  return ((data ?? []) as unknown[]).map((row) => {
    const event = normalizeEvent(row);
    return {
      id: event.id,
      productId: event.producto_id ?? "",
      product: event.products ? formatProduct(event.products) : event.codigo,
      scannedAt: event.hora_registro,
      quantity: 1,
      status: event.estado === "activo" ? "saved" : "rejected",
      availableToRemove: false
    };
  });
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

async function getActiveJourney(client: SupabaseClient, bandId: Banda): Promise<JornadaRow | null> {
  const { data, error } = await client
    .from("jornadas")
    .select("*")
    .eq("usuario_id", PRODUCTION_USER_ID)
    .eq("banda", bandId)
    .eq("estado", "activa")
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new StationDataError(classifySupabaseError(error), "No fue posible leer la jornada activa.");
  return data as JornadaRow | null;
}

async function findActiveProductByCode(client: SupabaseClient, barcode: string): Promise<ProductoRow | null> {
  const { data: direct, error: directError } = await client
    .from("productos")
    .select("id,codigo_id,cliente_marca,modelo,color,talla,estado")
    .eq("codigo_id", barcode)
    .eq("estado", "activo")
    .maybeSingle();

  if (directError) {
    throw new StationScanError("SCAN_FAILED", "No fue posible validar el codigo.", 500, true);
  }
  if (direct) return direct as ProductoRow;

  const { data: alias, error: aliasError } = await client
    .from("productos_codigos_alias")
    .select("productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
    .eq("codigo_id", barcode)
    .maybeSingle();

  if (aliasError && aliasError.code !== "42P01") {
    throw new StationScanError("SCAN_FAILED", "No fue posible validar el codigo.", 500, true);
  }

  const aliasProductRaw = (alias as { productos?: ProductoRow | ProductoRow[] | null } | null)?.productos ?? null;
  const aliasProduct = Array.isArray(aliasProductRaw) ? aliasProductRaw[0] ?? null : aliasProductRaw;
  return aliasProduct && aliasProduct.estado === "activo" ? aliasProduct : null;
}

async function getDayTotal(client: SupabaseClient, eventId: string): Promise<number> {
  const { data: event } = await client.from("produccion_eventos").select("jornada_id").eq("id", eventId).maybeSingle();
  const jornadaId = (event as { jornada_id?: string } | null)?.jornada_id;
  if (!jornadaId) return 0;

  const { data } = await client.from("registros_horarios").select("pares").eq("jornada_id", jornadaId);
  return ((data ?? []) as Array<{ pares: number | null }>).reduce((total, row) => total + (row.pares ?? 0), 0);
}

async function getHourGoalForRegister(client: SupabaseClient, registroId: string): Promise<number | null> {
  const { data } = await client
    .from("registros_horarios")
    .select("duracion,jornadas(meta_por_hora)")
    .eq("id", registroId)
    .maybeSingle();
  const row = data as { duracion?: number | string; jornadas?: { meta_por_hora?: number | string } | null } | null;
  if (!row || !row.jornadas) return null;
  return Math.round(Number(row.duracion) * Number(row.jornadas.meta_por_hora));
}

function normalizeRpcResult(data: unknown): ScannerRpcRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const record = row as Partial<ScannerRpcRow>;
  if (!record.evento_id || !record.registro_horario_id || typeof record.pares_bloque !== "number") return null;
  return {
    evento_id: record.evento_id,
    registro_horario_id: record.registro_horario_id,
    pares_bloque: record.pares_bloque,
    producto_id: record.producto_id ?? null,
    duplicado: Boolean(record.duplicado)
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatProduct(product: ProductoRow): string {
  return [product.modelo || product.codigo_id, product.color, product.talla ? "Talla " + product.talla : null]
    .filter(Boolean)
    .join(" - ");
}

function normalizeEvent(data: unknown): NormalizedEvent {
  const event = data as ProduccionEventoRow & { productos?: ProductoRow | ProductoRow[] | null };
  const products = Array.isArray(event.productos) ? event.productos[0] ?? null : event.productos ?? null;
  return { ...event, products };
}

function classifySupabaseError(error: { code?: string; message?: string }): StationDataError["code"] {
  if (error.code === "42501" || /permission|rls|policy/i.test(error.message ?? "")) return "RLS_BLOCKED";
  return "SUPABASE_QUERY_FAILED";
}

function logStationIssue(operation: string, code: string, details: Record<string, string | number | null>) {
  console.error("[station-data]", { operation, code, ...details });
}
