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

export type ManualProductData = {
  productId: string;
  product: string;
  count: number;
  availableToRemove: boolean;
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
  hora_inicio?: number | string;
  hora_fin_efectiva?: number | string;
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
  cliente_uuid?: string;
  codigo: string;
  hora_registro: string;
  hora_local: string | null;
  jornada_id?: string;
  registro_horario_id?: string;
  producto_id: string | null;
  cantidad: 1;
  estado: "activo" | "anulado";
  origen?: "scanner_pt" | "captura_manual" | "ajuste_manual";
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

type ManualAdjustmentRpcRow = {
  correccion_id: string;
  evento_id: string | null;
  registro_horario_id: string;
  pares_bloque: number;
  producto_id: string;
  cantidad: 1 | -1;
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
      | "INVALID_ADJUSTMENT_ID"
      | "UNKNOWN_BARCODE"
      | "PRODUCT_NOT_WORKED"
      | "REMOVE_NOT_AVAILABLE"
      | "NO_ACTIVE_SHIFT"
      | "NO_ACTIVE_BLOCK"
      | "BREAK_TIME"
      | "OUTSIDE_SCHEDULE"
      | "SHIFT_INACTIVE"
      | "OUTSIDE_HOUR_BLOCK"
      | "SCAN_PERMISSION_DENIED"
      | "ADJUSTMENT_NOT_CONFIGURED"
      | "ADJUSTMENT_FAILED"
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

export async function getStationStatus(
  client: SupabaseClient,
  profile: StationProfile,
  now = new Date()
): Promise<StationStatusData> {
  const { data: jornadaData, error: jornadaError } = await client
    .from("jornadas")
    .select("*")
    .eq("usuario_id", PRODUCTION_USER_ID)
    .eq("banda", profile.bandId)
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
  if (!jornada) return emptyStationStatus(profile, "missing");
  if (jornada.estado !== "activa") return emptyStationStatus(profile, "closed");

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
  const currentBlock = findCurrentBlock(registros, now);
  const dayTotal = registros.reduce((total, registro) => total + (registro.pares ?? 0), 0);
  const isDisabled = Boolean(jornada.deshabilitada);
  const blockStatus = isDisabled ? "missing" : getBlockStatus(jornada, registros, currentBlock, now);
  const scannerStatus = !isDisabled && blockStatus === "active" ? "ready" : "paused";
  const copy = stationStatusCopy(jornada, blockStatus, isDisabled);

  return {
    operatorName: profile.operatorName,
    bandName: profile.bandName,
    stationId: profile.stationId,
    shiftStatus: "active",
    blockStatus,
    scannerStatus,
    statusTitle: copy.title,
    statusDetail: copy.detail,
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
  await assertScannerReady(client, payload.profile);
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
  client: SupabaseClient,
  payload: ManualAdjustmentPayload
): Promise<SavedScan> {
  const adjustmentId = payload.adjustmentId.trim();
  if (!isUuid(adjustmentId)) {
    throw new StationScanError("INVALID_ADJUSTMENT_ID", "Identificador de ajuste invalido.", 400);
  }

  await assertScannerReady(client, payload.profile);
  const product = await findWorkedProductById(client, payload.profile, payload.productId);
  if (!product) {
    throw new StationScanError("PRODUCT_NOT_WORKED", "Este modelo no esta disponible para ajustar.", 409);
  }

  const { data: rpcData, error: rpcError } = await client.rpc("registrar_ajuste_scanner", {
    p_ajuste_uuid: adjustmentId,
    p_producto_id: payload.productId,
    p_cantidad: payload.quantity
  });

  if (rpcError) {
    const message = rpcError.message ?? "";
    logStationIssue("registrar_ajuste_scanner.rpc", rpcError.code ?? "RPC_ERROR", {
      userId: payload.profile.userId,
      supabaseCode: rpcError.code ?? null
    });
    if (/function .*registrar_ajuste_scanner|schema cache|could not find/i.test(message)) {
      throw new StationScanError(
        "ADJUSTMENT_NOT_CONFIGURED",
        "Falta aplicar la migracion de ajustes manuales en Supabase.",
        501
      );
    }
    if (rpcError.code === "42501" || /autorizado|permission|permiso/i.test(message)) {
      throw new StationScanError("SCAN_PERMISSION_DENIED", "Esta cuenta no tiene permiso para ajustar produccion.", 403);
    }
    if (/jornada/i.test(message)) {
      throw new StationScanError("SHIFT_INACTIVE", "La jornada de " + payload.profile.bandName + " no esta disponible.", 409);
    }
    if (/bloque|horario/i.test(message)) {
      throw new StationScanError("OUTSIDE_HOUR_BLOCK", "Fuera de bloque horario.", 409);
    }
    if (/disponibles|quitar|cero/i.test(message)) {
      throw new StationScanError("REMOVE_NOT_AVAILABLE", "No hay pares disponibles para quitar.", 409);
    }
    throw new StationScanError("ADJUSTMENT_FAILED", "No fue posible guardar el ajuste.", 500, true);
  }

  const rpcRow = normalizeManualAdjustmentResult(rpcData);
  if (!rpcRow) {
    throw new StationScanError("ADJUSTMENT_FAILED", "La respuesta del ajuste no fue valida.", 500, true);
  }

  const { data: correctionData } = await client
    .from("correcciones_produccion")
    .select("created_at")
    .eq("id", rpcRow.correccion_id)
    .maybeSingle();
  const status = await getStationStatus(client, payload.profile);

  return {
    productId: product.id,
    product: formatProduct(product),
    scannedAt: (correctionData as { created_at?: string } | null)?.created_at ?? new Date().toISOString(),
    hourTotal: status.hourTotal,
    hourGoal: status.hourGoal,
    dayTotal: status.dayTotal,
    duplicate: rpcRow.duplicado
  };
}

export async function getRecentScans(client: SupabaseClient, profile: StationProfile): Promise<RecentScanData[]> {
  const jornada = await getActiveJourney(client, profile.bandId);
  if (!jornada) return [];

  const { data, error } = await client
    .from("produccion_eventos")
    .select("id,codigo,hora_registro,hora_local,producto_id,cantidad,estado,origen,productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
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
      quantity: event.estado === "anulado" ? -1 : 1,
      status: event.origen === "ajuste_manual" ? "adjusted" : event.estado === "activo" ? "saved" : "rejected",
      availableToRemove: event.estado === "activo" && Boolean(event.producto_id)
    };
  });
}

export async function getManualProducts(client: SupabaseClient, profile: StationProfile): Promise<ManualProductData[]> {
  const jornada = await getActiveJourney(client, profile.bandId);
  if (!jornada) return [];

  const { data, error } = await client
    .from("produccion_eventos")
    .select("id,producto_id,estado,productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
    .eq("jornada_id", jornada.id)
    .eq("banda", profile.bandId)
    .eq("estado", "activo")
    .not("producto_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    logStationIssue("produccion_eventos.manual_products", classifySupabaseError(error), {
      userId: profile.userId,
      supabaseCode: error.code ?? null
    });
    throw new StationDataError(classifySupabaseError(error), "No fue posible leer los modelos ajustables.");
  }

  const grouped = new Map<string, ManualProductData>();
  for (const row of (data ?? []) as unknown[]) {
    const event = normalizeEvent(row);
    if (!event.producto_id || !event.products) continue;
    const existing = grouped.get(event.producto_id);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(event.producto_id, {
        productId: event.producto_id,
        product: formatProduct(event.products),
        count: 1,
        availableToRemove: true
      });
    }
  }

  return [...grouped.values()];
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

function emptyStationStatus(profile: StationProfile, shiftStatus: "missing" | "closed"): StationStatusData {
  return {
    operatorName: profile.operatorName,
    bandName: profile.bandName,
    stationId: profile.stationId,
    shiftStatus,
    blockStatus: "missing",
    scannerStatus: "disabled",
    statusTitle: "Sin jornada activa",
    statusDetail: "Espera a que DinoCore abra la jornada.",
    hourTotal: 0,
    hourGoal: null,
    dayTotal: 0,
    pendingCount: 0
  };
}

function getBlockStatus(
  jornada: JornadaRow,
  registros: RegistroHorarioRow[],
  currentBlock: RegistroHorarioRow | null,
  now = new Date()
): StationStatusData["blockStatus"] {
  if (currentBlock) return "active";
  if (registros.length === 0) return "missing";

  const hour = mexicoDecimalHour(now);
  const firstBlockStart = Math.min(...registros.map((registro) => Number(registro.hora_inicio_bloque)));
  const lastBlockEnd = Math.max(
    ...registros.map((registro) => Number(registro.hora_inicio_bloque) + Number(registro.duracion))
  );
  const shiftStart = jornada.hora_inicio == null ? firstBlockStart : Number(jornada.hora_inicio);
  const shiftEnd = jornada.hora_fin_efectiva == null ? lastBlockEnd : Number(jornada.hora_fin_efectiva);

  if (hour >= firstBlockStart && hour <= lastBlockEnd) return "break";
  if (hour >= shiftStart && hour <= shiftEnd) return "outside_schedule";
  return "outside_schedule";
}

function stationStatusCopy(
  jornada: JornadaRow,
  blockStatus: StationStatusData["blockStatus"],
  isDisabled: boolean
): { title: string; detail: string } {
  if (isDisabled) {
    return {
      title: "Escaner pausado",
      detail: jornada.motivo_deshabilitada || "La banda no esta disponible para escanear."
    };
  }
  if (blockStatus === "active") return { title: "Escaner listo", detail: "Listo para registrar produccion." };
  if (blockStatus === "break") {
    return {
      title: "Horario de descanso",
      detail: "El registro se reanudara al comenzar el siguiente bloque."
    };
  }
  if (blockStatus === "missing") {
    return {
      title: "Sin bloque horario",
      detail: "DinoCore no tiene bloques habilitados para esta jornada."
    };
  }
  return {
    title: "Fuera del horario de produccion",
    detail: "No existe un bloque habilitado para esta hora. Las horas extra deben estar habilitadas en DinoCore."
  };
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

async function assertScannerReady(client: SupabaseClient, profile: StationProfile): Promise<void> {
  const status = await getStationStatus(client, profile);
  if (status.shiftStatus !== "active") {
    throw new StationScanError("NO_ACTIVE_SHIFT", "No hay jornada activa.", 409);
  }
  if (status.blockStatus === "active" && status.scannerStatus === "ready") return;
  if (status.blockStatus === "break") {
    throw new StationScanError("BREAK_TIME", "Horario de descanso.", 409);
  }
  if (status.blockStatus === "outside_schedule") {
    throw new StationScanError("OUTSIDE_SCHEDULE", "Fuera del horario de produccion.", 409);
  }
  throw new StationScanError("NO_ACTIVE_BLOCK", "No existe un bloque habilitado para esta hora.", 409);
}

async function findWorkedProductById(
  client: SupabaseClient,
  profile: StationProfile,
  productId: string
): Promise<ProductoRow | null> {
  const jornada = await getActiveJourney(client, profile.bandId);
  if (!jornada) {
    throw new StationScanError("SHIFT_INACTIVE", "La jornada de " + profile.bandName + " no esta disponible.", 409);
  }

  const { data, error } = await client
    .from("produccion_eventos")
    .select("producto_id,productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
    .eq("jornada_id", jornada.id)
    .eq("banda", profile.bandId)
    .eq("producto_id", productId)
    .eq("estado", "activo")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new StationScanError("ADJUSTMENT_FAILED", "No fue posible validar el modelo.", 500, true);
  }

  const event = data ? normalizeEvent(data) : null;
  return event?.products && event.products.estado === "activo" ? event.products : null;
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

function normalizeManualAdjustmentResult(data: unknown): ManualAdjustmentRpcRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const record = row as Partial<ManualAdjustmentRpcRow>;
  if (
    !record.correccion_id ||
    !record.registro_horario_id ||
    !record.producto_id ||
    typeof record.pares_bloque !== "number" ||
    (record.cantidad !== 1 && record.cantidad !== -1)
  ) {
    return null;
  }
  return {
    correccion_id: record.correccion_id,
    evento_id: record.evento_id ?? null,
    registro_horario_id: record.registro_horario_id,
    pares_bloque: record.pares_bloque,
    producto_id: record.producto_id,
    cantidad: record.cantidad,
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
