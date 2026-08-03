import { createClient, SupabaseClient } from "@supabase/supabase-js";

const PRODUCTION_USER_ID = "278a5fc3-be3d-460c-ae2c-fa890bfca685";
const SCANNER_ROLE = "scanner_operator";

type Banda = 1 | 2;
export type StationMode = "scanner" | "band_display";

export type StationProfile = {
  userId: string;
  operatorName: string;
  role: "scanner_operator";
  bandId: Banda;
  bandName: string;
  stationId: string;
  stationMode: StationMode;
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
  hourDefects: number;
  dayTotal: number;
  pendingCount: number;
};

export type DisplayStatusData = {
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

export type ProductResolutionData = {
  normalizedCode: string;
  originalLength: number;
  normalizedLength: number;
  trimmedLength: number;
  removedOnlyLineTerminators: boolean;
  stage: "products.codigo_id" | "productos_codigos_alias.codigo_id" | "not_found";
  product: {
    id: string;
    code: string;
    codeLength: number;
    codeHasOuterWhitespace: boolean;
    codeHasInvisibleWhitespace: boolean;
    label: string;
    status: string;
    model: string | null;
    color: string | null;
    size: string | null;
  } | null;
};

export type ScannerPreflightData = {
  input: {
    received: string;
    receivedLength: number;
    trimmed: string;
    trimmedLength: number;
    normalizedCode: string;
    normalizedLength: number;
  };
  profile: {
    userId: string;
    role: string;
    bandId: Banda;
    bandName: string;
    stationId: string;
    stationMode: StationMode;
  };
  catalogChecks: ProductResolutionData[];
  canonicalCode: string | null;
  productReady: boolean;
  journey: {
    id: string;
    state: string;
    bandId: Banda;
    operatingDate: string;
    disabled: boolean;
  } | null;
  block: {
    id: string;
    status: StationStatusData["blockStatus"];
    startsAtHour: number;
    durationHours: number;
    endsAtHour: number;
    pairs: number;
    timezone: "America/Mexico_City";
  } | null;
  rpc: {
    name: "registrar_escaneo_scanner";
    parameters: {
      p_cliente_uuid: "uuid";
      p_codigo: "text";
    };
    executionCheck: "not_executed_read_only";
  };
  expectedStatus:
    | "READY_TO_SCAN"
    | "PRODUCT_NOT_FOUND"
    | "PRODUCT_INACTIVE"
    | "NO_ACTIVE_SHIFT"
    | "NO_ACTIVE_BLOCK"
    | "BREAK_TIME"
    | "OUTSIDE_SCHEDULE";
};

export type SavedScan = {
  productId: string | null;
  product: string;
  code: string;
  scannedAt: string;
  hourTotal: number;
  hourGoal: number | null;
  dayTotal: number;
  duplicate: boolean;
  unidentified: boolean;
};

export type RecentScanData = {
  id: string;
  productId: string | null;
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
  station_mode?: string | null;
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
  orden?: number | null;
};

type ProductoRow = {
  id: string;
  codigo_id: string;
  sku?: string | null;
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
  codigo_normalizado?: string | null;
  estado_identificacion?: "identificado" | "pendiente" | null;
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
      | "INVALID_STATION_MODE"
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
      | "PRODUCT_NOT_FOUND"
      | "PRODUCT_INACTIVE"
      | "CATALOG_PERMISSION_DENIED"
      | "PRODUCT_NOT_WORKED"
      | "REMOVE_NOT_AVAILABLE"
      | "NO_ACTIVE_SHIFT"
      | "NO_ACTIVE_BLOCK"
      | "BREAK_TIME"
      | "OUTSIDE_SCHEDULE"
      | "SHIFT_INACTIVE"
      | "OUTSIDE_HOUR_BLOCK"
      | "SCAN_PERMISSION_DENIED"
      | "SCAN_RPC_NOT_FOUND"
      | "SCAN_RPC_SIGNATURE_MISMATCH"
      | "SCAN_CONSTRAINT_VIOLATION"
      | "SCAN_CONFIRMATION_UNREADABLE"
      | "ADJUSTMENT_NOT_CONFIGURED"
      | "ADJUSTMENT_FAILED"
      | "SCAN_WRITE_FAILED"
      | "SCAN_FAILED"
      | "DEFECT_NOT_FOUND"
      | "DEFECT_PERMISSION_DENIED"
      | "DEFECT_LOOKUP_FAILED"
      | "DEFECT_NOT_CONFIGURED"
      | "PAIR_NOT_FOUND"
      | "DEFECT_REGISTER_FAILED",
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
    .select("id,nombre,correo,rol,banda_asignada,estacion,station_mode")
    .eq("id", user.id)
    .maybeSingle();

  const profileResult =
    error && error.code === "42703"
      ? await client.from("usuarios").select("id,nombre,correo,rol,banda_asignada,estacion").eq("id", user.id).maybeSingle()
      : { data, error };

  if (profileResult.error) {
    logStationIssue("usuarios.select", classifySupabaseError(profileResult.error), {
      userId: user.id,
      supabaseCode: profileResult.error.code ?? null
    });
    throw new StationDataError(classifySupabaseError(profileResult.error), "No fue posible leer el perfil operativo.");
  }

  const profile = profileResult.data as UsuarioRow | null;
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

  const stationMode = profile.station_mode == null || profile.station_mode === "" ? "scanner" : profile.station_mode;
  if (stationMode !== "scanner" && stationMode !== "band_display") {
    throw new StationDataError("INVALID_STATION_MODE", "El modo de Estacion 337 no es valido.", { userId: user.id });
  }

  return {
    userId: user.id,
    operatorName: profile.nombre,
    role: SCANNER_ROLE,
    bandId: profile.banda_asignada,
    bandName: "Banda " + profile.banda_asignada,
    stationId: profile.estacion,
    stationMode
  };
}

export function assertStationMode(profile: StationProfile, expected: StationMode) {
  if (profile.stationMode === expected) return;
  throw new StationDataError(
    "INVALID_STATION_MODE",
    expected === "scanner" ? "Esta cuenta no puede escribir en el scanner." : "Esta cuenta no puede abrir el tablero.",
    { userId: profile.userId }
  );
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
    .select("id,hora_inicio_bloque,duracion,pares,orden")
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
    hourDefects: currentBlock ? await getBlockDefectCount(client, currentBlock.id, profile.bandId) : 0,
    dayTotal,
    pendingCount: await getPendingConfirmationCount(client, jornada.id, profile.bandId)
  };
}

export async function getDisplayStatus(
  client: SupabaseClient,
  profile: StationProfile,
  now = new Date()
): Promise<DisplayStatusData> {
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
    logStationIssue("display.jornadas.select", classifySupabaseError(jornadaError), {
      userId: profile.userId,
      supabaseCode: jornadaError.code ?? null
    });
    throw new StationDataError(classifySupabaseError(jornadaError), "No fue posible leer la jornada activa.");
  }

  const base = {
    bandName: profile.bandName,
    stationId: profile.stationId,
    serverTime: mexicoIso(now)
  };
  const jornada = jornadaData as JornadaRow | null;
  if (!jornada) {
    return {
      ...base,
      shiftStatus: "missing",
      blockStatus: "missing",
      statusTitle: "Sin jornada activa",
      statusDetail: "Espera a que DinoCore abra la jornada.",
      blockEndsAt: null,
      nextBlockStartsAt: null,
      hourTotal: 0,
      hourGoal: null,
      hourRemaining: null,
      dayTotal: 0,
      dayGoal: 0,
      dayRemaining: 0,
      expectedTotal: 0,
      delay: 0,
      ahead: 0,
      productiveSecondsRemaining: 0,
      currentAveragePerMinute: 0,
      idealAveragePerMinute: 0,
      projectedResult: 0,
      projectedCompliance: null,
      paceStatus: "on_track",
      paceLabel: "Ritmo estable"
    };
  }

  const { data: registrosData, error: registrosError } = await client
    .from("registros_horarios")
    .select("id,hora_inicio_bloque,duracion,pares,orden")
    .eq("jornada_id", jornada.id)
    .order("orden", { ascending: true });

  if (registrosError) {
    logStationIssue("display.registros_horarios.select", classifySupabaseError(registrosError), {
      userId: profile.userId,
      supabaseCode: registrosError.code ?? null
    });
    throw new StationDataError(classifySupabaseError(registrosError), "No fue posible leer los bloques horarios.");
  }

  const registros = (registrosData ?? []) as RegistroHorarioRow[];
  const currentBlock = findCurrentBlock(registros, now);
  const dayTotal = registros.reduce((total, registro) => total + (registro.pares ?? 0), 0);
  const dayGoal = Math.round(registros.reduce((total, registro) => total + Number(registro.duracion) * Number(jornada.meta_por_hora), 0));
  const expectedTotal = getExpectedTotal(jornada, registros, now);
  const delay = Math.max(expectedTotal - dayTotal, 0);
  const ahead = Math.max(dayTotal - expectedTotal, 0);
  const productiveMinutesElapsed = getProductiveMinutesElapsed(registros, now);
  const productiveMinutesRemaining = getProductiveMinutesRemaining(registros, now);
  const currentAveragePerMinute = productiveMinutesElapsed > 0 ? roundTwo(dayTotal / productiveMinutesElapsed) : 0;
  const idealAveragePerMinute =
    productiveMinutesRemaining > 0 ? roundTwo(Math.max(dayGoal - dayTotal, 0) / productiveMinutesRemaining) : 0;
  const projectedResult = Math.round(dayTotal + currentAveragePerMinute * productiveMinutesRemaining);
  const projectedCompliance = dayGoal > 0 ? Math.round((projectedResult / dayGoal) * 100) : null;
  const isDisabled = Boolean(jornada.deshabilitada);
  const blockStatus = isDisabled ? "missing" : getBlockStatus(jornada, registros, currentBlock, now);
  const copy = jornada.estado !== "activa" ? emptyDisplayCopy() : stationStatusCopy(jornada, blockStatus, isDisabled);
  const nextBlock = currentBlock ? null : findNextBlock(registros, now);
  const hourGoal = currentBlock ? Math.round(Number(currentBlock.duracion) * Number(jornada.meta_por_hora)) : null;
  const hourTotal = currentBlock ? currentBlock.pares ?? 0 : 0;

  return {
    ...base,
    shiftStatus: jornada.estado === "activa" ? "active" : "closed",
    blockStatus: jornada.estado === "activa" ? blockStatus : "missing",
    statusTitle: copy.title,
    statusDetail: copy.detail,
    blockEndsAt: currentBlock ? blockBoundaryIso(currentBlock, "end", now) : null,
    nextBlockStartsAt: nextBlock ? blockBoundaryIso(nextBlock, "start", now) : null,
    hourTotal,
    hourGoal,
    hourRemaining: hourGoal == null ? null : Math.max(hourGoal - hourTotal, 0),
    dayTotal,
    dayGoal,
    dayRemaining: Math.max(dayGoal - dayTotal, 0),
    expectedTotal,
    delay,
    ahead,
    productiveSecondsRemaining: Math.max(Math.round(productiveMinutesRemaining * 60), 0),
    currentAveragePerMinute,
    idealAveragePerMinute,
    projectedResult,
    projectedCompliance,
    paceStatus: ahead > 0 ? "ahead" : delay > 0 ? "behind" : "on_track",
    paceLabel: ahead > 0 ? "Adelanto de " + ahead + " pares" : delay > 0 ? "Retraso de " + delay + " pares" : "Ritmo estable"
  };
}

export async function saveStationScan(client: SupabaseClient, payload: ScanPayload): Promise<SavedScan> {
  const scanId = payload.scanId.trim();
  if (!isUuid(scanId)) {
    throw new StationScanError("INVALID_SCAN_ID", "Identificador de escaneo invalido.", 400);
  }

  const barcode = normalizeScannedCode(payload.barcode);
  await assertScannerReady(client, payload.profile);

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
    if (rpcError.code === "42883" || /function .* does not exist|schema cache|signature/i.test(message)) {
      throw new StationScanError("SCAN_RPC_NOT_FOUND", "La funcion de registro no esta disponible.", 500, true);
    }
    if (rpcError.code === "PGRST202" || rpcError.code === "42804" || /could not find.*function|parameter/i.test(message)) {
      throw new StationScanError("SCAN_RPC_SIGNATURE_MISMATCH", "La llamada de registro no coincide con la funcion desplegada.", 500, true);
    }
    if (rpcError.code === "P0002" && /jornada/i.test(message)) {
      throw new StationScanError("SHIFT_INACTIVE", "La jornada de " + payload.profile.bandName + " no esta disponible.", 409);
    }
    if (rpcError.code === "P0002" && /bloque/i.test(message)) {
      throw new StationScanError("OUTSIDE_HOUR_BLOCK", "Fuera de bloque horario.", 409);
    }
    if (/NO_ACTIVE_BLOCK/i.test(message)) {
      throw new StationScanError("NO_ACTIVE_BLOCK", "No existe un bloque habilitado para esta hora.", 409);
    }
    if (/BREAK_TIME/i.test(message)) {
      throw new StationScanError("BREAK_TIME", "Horario de descanso.", 409);
    }
    if (["23502", "23503", "23505", "23514", "22P02"].includes(rpcError.code ?? "")) {
      throw new StationScanError("SCAN_CONSTRAINT_VIOLATION", "La base de datos rechazo el registro.", 500, true);
    }
    throw new StationScanError("SCAN_WRITE_FAILED", "No se pudo confirmar el registro.", 500, true);
  }

  const rpcRow = normalizeRpcResult(rpcData);
  if (!rpcRow) {
    throw new StationScanError("SCAN_RPC_SIGNATURE_MISMATCH", "La respuesta del registro no fue valida.", 500, true);
  }

  const { data: eventData, error: eventError } = await client
    .from("produccion_eventos")
    .select("id,codigo,codigo_normalizado,estado_identificacion,hora_registro,hora_local,producto_id,cantidad,estado,productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
    .eq("id", rpcRow.evento_id)
    .maybeSingle();

  if (eventError || !eventData) {
    logStationIssue("produccion_eventos.confirmation", "SCAN_CONFIRMATION_UNREADABLE", {
      userId: payload.profile.userId,
      supabaseCode: eventError?.code ?? null
    });
  }

  const dayTotal = await getDayTotal(client, rpcRow.evento_id);
  const hourGoal = await getHourGoalForRegister(client, rpcRow.registro_horario_id);
  const event = eventData ? normalizeEvent(eventData) : null;
  const canonicalProduct = event?.products ?? null;
  const normalizedCode = event?.codigo_normalizado || event?.codigo || barcode;
  const unidentified = !canonicalProduct || event?.estado_identificacion === "pendiente" || !rpcRow.producto_id;

  return {
    productId: canonicalProduct?.id ?? null,
    product: canonicalProduct ? formatProduct(canonicalProduct) : "Codigo " + normalizedCode + " - Producto pendiente de identificar",
    code: normalizedCode,
    scannedAt: event?.hora_registro ?? new Date().toISOString(),
    hourTotal: rpcRow.pares_bloque,
    hourGoal,
    dayTotal,
    duplicate: rpcRow.duplicado,
    unidentified
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
    if (/NO_ACTIVE_SHIFT|jornada/i.test(message)) {
      throw new StationScanError("SHIFT_INACTIVE", "La jornada de " + payload.profile.bandName + " no esta disponible.", 409);
    }
    if (/NO_ACTIVE_BLOCK|bloque|horario/i.test(message)) {
      throw new StationScanError("OUTSIDE_HOUR_BLOCK", "Fuera de bloque horario.", 409);
    }
    if (/PRODUCT_NOT_WORKED/i.test(message)) {
      throw new StationScanError("PRODUCT_NOT_WORKED", "Este modelo no esta disponible para ajustar.", 409);
    }
    if (/PRODUCT_NOT_AVAILABLE/i.test(message)) {
      throw new StationScanError("PRODUCT_NOT_WORKED", "Producto no disponible.", 409);
    }
    if (/REMOVE_NOT_AVAILABLE|disponibles|quitar|cero/i.test(message)) {
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
    code: product.codigo_id,
    scannedAt: (correctionData as { created_at?: string } | null)?.created_at ?? new Date().toISOString(),
    hourTotal: status.hourTotal,
    hourGoal: status.hourGoal,
    dayTotal: status.dayTotal,
    duplicate: rpcRow.duplicado,
    unidentified: false
  };
}

export async function resolveProductForScanner(
  client: SupabaseClient,
  rawCode: string
): Promise<ProductResolutionData> {
  const trimmedCode = rawCode.trim();
  const normalizedCode = normalizeScannedCode(rawCode);
  if (!normalizedCode) {
    throw new StationScanError("PRODUCT_NOT_FOUND", "Codigo no reconocido", 404);
  }

  const result = await resolveProductByCode(client, normalizedCode);
  if (!result.product) {
    return {
      normalizedCode,
      originalLength: rawCode.length,
      trimmedLength: trimmedCode.length,
      normalizedLength: normalizedCode.length,
      removedOnlyLineTerminators: normalizedCode === trimmedCode.replace(/[\r\n]+/g, ""),
      stage: "not_found",
      product: null
    };
  }

  return {
    normalizedCode,
    originalLength: rawCode.length,
    trimmedLength: trimmedCode.length,
    normalizedLength: normalizedCode.length,
    removedOnlyLineTerminators: normalizedCode === trimmedCode.replace(/[\r\n]+/g, ""),
    stage: result.stage,
    product: {
      id: result.product.id,
      code: result.product.codigo_id,
      codeLength: result.product.codigo_id.length,
      codeHasOuterWhitespace: result.product.codigo_id !== result.product.codigo_id.trim(),
      codeHasInvisibleWhitespace: /\s/.test(result.product.codigo_id),
      label: formatProduct(result.product),
      status: result.product.estado,
      model: result.product.modelo,
      color: result.product.color,
      size: result.product.talla
    }
  };
}

export async function getScannerPreflight(
  client: SupabaseClient,
  profile: StationProfile,
  rawCode: string,
  compareCodes: string[] = [],
  now = new Date()
): Promise<ScannerPreflightData> {
  const trimmed = rawCode.trim();
  const normalizedCode = normalizeScannedCode(rawCode);
  const codes = [rawCode, ...compareCodes].filter((code, index, values) => code && values.indexOf(code) === index);
  const catalogChecks = await Promise.all(codes.map((code) => resolveProductForScanner(client, code)));
  const primary = catalogChecks[0] ?? null;
  const productReady = Boolean(primary?.product && primary.product.status === "activo");

  const jornada = await getActiveJourney(client, profile.bandId);
  let registros: RegistroHorarioRow[] = [];
  if (jornada) {
    registros = await getJourneyRegisters(client, jornada.id, profile.userId);
  }
  const currentBlock = findCurrentBlock(registros, now);
  const blockStatus = jornada ? getBlockStatus(jornada, registros, currentBlock, now) : "missing";

  return {
    input: {
      received: rawCode,
      receivedLength: rawCode.length,
      trimmed,
      trimmedLength: trimmed.length,
      normalizedCode,
      normalizedLength: normalizedCode.length
    },
    profile: {
      userId: profile.userId,
      role: profile.role,
      bandId: profile.bandId,
      bandName: profile.bandName,
      stationId: profile.stationId,
      stationMode: profile.stationMode
    },
    catalogChecks,
    canonicalCode: primary?.product?.code ?? null,
    productReady,
    journey: jornada
      ? {
          id: jornada.id,
          state: jornada.estado,
          bandId: jornada.banda,
          operatingDate: jornada.fecha,
          disabled: Boolean(jornada.deshabilitada)
        }
      : null,
    block: currentBlock
      ? {
          id: currentBlock.id,
          status: blockStatus,
          startsAtHour: Number(currentBlock.hora_inicio_bloque),
          durationHours: Number(currentBlock.duracion),
          endsAtHour: Number(currentBlock.hora_inicio_bloque) + Number(currentBlock.duracion),
          pairs: currentBlock.pares ?? 0,
          timezone: "America/Mexico_City"
        }
      : null,
    rpc: {
      name: "registrar_escaneo_scanner",
      parameters: {
        p_cliente_uuid: "uuid",
        p_codigo: "text"
      },
      executionCheck: "not_executed_read_only"
    },
    expectedStatus: preflightExpectedStatus(Boolean(jornada), blockStatus, productReady, primary?.product?.status ?? null)
  };
}

export async function getRecentScans(client: SupabaseClient, profile: StationProfile): Promise<RecentScanData[]> {
  const jornada = await getActiveJourney(client, profile.bandId);
  if (!jornada) return [];

  const { data, error } = await client
    .from("produccion_eventos")
    .select("id,codigo,codigo_normalizado,estado_identificacion,hora_registro,hora_local,producto_id,cantidad,estado,origen,productos(id,codigo_id,cliente_marca,modelo,color,talla,estado)")
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
    const normalizedCode = event.codigo_normalizado || event.codigo;
    return {
      id: event.id,
      productId: event.producto_id ?? null,
      product: event.products ? formatProduct(event.products) : "Codigo " + normalizedCode + " - Producto pendiente de identificar",
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

export type QualityDefectData = {
  codigo: string;
  nombre: string;
};

export type QualityDefectRegistration = {
  nombre: string;
  modelo: string | null;
  duplicado: boolean;
};

// El catalogo de defectos vive en DinoCore (calidad_defectos_catalogo) y tiene
// RLS de solo lectura para cualquier authenticated, asi que el scanner puede
// leerlo directo para mostrar el nombre en el primer escaneo. La ESCRITURA en
// cambio pasa por la RPC registrar_defecto_scanner (SECURITY DEFINER, ver
// supabase/migrations/0031 de DinoCore): la RLS de calidad_perdidas es
// admin-only y un insert directo del scanner seria rechazado.
export async function resolveQualityDefect(client: SupabaseClient, defectoCodigo: string): Promise<QualityDefectData> {
  const codigo = defectoCodigo.trim().toUpperCase();
  if (!codigo) {
    throw new StationScanError("DEFECT_NOT_FOUND", "Codigo de defecto invalido.", 400);
  }

  const { data, error } = await client
    .from("calidad_defectos_catalogo")
    .select("codigo,nombre")
    .eq("codigo", codigo)
    .eq("activo", true)
    .maybeSingle();

  if (error) {
    logStationIssue("calidad_defectos_catalogo.select", classifySupabaseError(error), { supabaseCode: error.code ?? null });
    if (error.code === "42501" || /permission|rls|policy/i.test(error.message ?? "")) {
      throw new StationScanError("DEFECT_PERMISSION_DENIED", "Permiso insuficiente para leer el catalogo de defectos.", 403);
    }
    throw new StationScanError("DEFECT_LOOKUP_FAILED", "No fue posible leer el catalogo de defectos.", 500, true);
  }
  if (!data) {
    throw new StationScanError("DEFECT_NOT_FOUND", "El codigo de defecto no existe en el catalogo.", 404);
  }

  const row = data as { codigo: string; nombre: string };
  return { codigo: row.codigo, nombre: row.nombre };
}

type RegistrarDefectoRpcRow = {
  perdida_id: string;
  defecto_id: string;
  defecto_nombre: string;
  modelo: string | null;
  producto_nombre: string | null;
  duplicado: boolean;
};

export async function registerQualityDefect(
  client: SupabaseClient,
  params: { defectoCodigo: string; parCodigo: string; clienteUuid: string; profile: StationProfile }
): Promise<QualityDefectRegistration> {
  const parCodigo = params.parCodigo.trim();
  if (!parCodigo) {
    throw new StationScanError("PAIR_NOT_FOUND", "No hay par escaneado.", 400);
  }
  if (!isUuid(params.clienteUuid.trim())) {
    throw new StationScanError("INVALID_ADJUSTMENT_ID", "Identificador de registro invalido.", 400);
  }

  const { data, error } = await client.rpc("registrar_defecto_scanner", {
    p_cliente_uuid: params.clienteUuid.trim(),
    p_codigo_defecto: params.defectoCodigo.trim().toUpperCase(),
    p_codigo_par: parCodigo
  });

  if (error) {
    const message = error.message ?? "";
    logStationIssue("registrar_defecto_scanner.rpc", error.code ?? "RPC_ERROR", {
      userId: params.profile.userId,
      supabaseCode: error.code ?? null
    });
    if (error.code === "42501" || /autorizado|permission|permiso/i.test(message)) {
      throw new StationScanError("DEFECT_PERMISSION_DENIED", "Esta cuenta no tiene permiso para registrar defectos.", 403);
    }
    if (error.code === "42883" || error.code === "PGRST202" || /function .* does not exist|could not find.*function|schema cache/i.test(message)) {
      throw new StationScanError("DEFECT_NOT_CONFIGURED", "Falta aplicar la migracion 0031 (registrar_defecto_scanner) en Supabase.", 501);
    }
    if (/Defecto no encontrado/i.test(message)) {
      throw new StationScanError("DEFECT_NOT_FOUND", "El codigo de defecto no existe en el catalogo.", 404);
    }
    if (/jornada/i.test(message)) {
      throw new StationScanError("NO_ACTIVE_SHIFT", "No hay jornada activa para esta banda.", 409);
    }
    if (/bloque/i.test(message)) {
      throw new StationScanError("OUTSIDE_HOUR_BLOCK", "Fuera de bloque horario.", 409);
    }
    throw new StationScanError("DEFECT_REGISTER_FAILED", "No fue posible guardar el defecto.", 500, true);
  }

  const row = (Array.isArray(data) ? data[0] : data) as RegistrarDefectoRpcRow | undefined;
  if (!row || !row.defecto_nombre) {
    throw new StationScanError("DEFECT_REGISTER_FAILED", "La respuesta del registro no fue valida.", 500, true);
  }

  return { nombre: row.defecto_nombre, modelo: row.modelo ?? null, duplicado: Boolean(row.duplicado) };
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
    hourDefects: 0,
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

function emptyDisplayCopy() {
  return {
    title: "Sin jornada activa",
    detail: "Espera a que DinoCore abra la jornada."
  };
}

function getExpectedTotal(jornada: JornadaRow, registros: RegistroHorarioRow[], now = new Date()): number {
  const hour = mexicoDecimalHour(now);
  const metaPorHora = Number(jornada.meta_por_hora);
  const expected = registros.reduce((total, registro) => {
    const start = Number(registro.hora_inicio_bloque);
    const duration = Number(registro.duracion);
    const elapsed = Math.min(Math.max(hour - start, 0), duration);
    return total + elapsed * metaPorHora;
  }, 0);
  return Math.round(expected);
}

function getProductiveMinutesElapsed(registros: RegistroHorarioRow[], now = new Date()): number {
  const hour = mexicoDecimalHour(now);
  return registros.reduce((total, registro) => {
    const start = Number(registro.hora_inicio_bloque);
    const duration = Number(registro.duracion);
    return total + Math.min(Math.max(hour - start, 0), duration) * 60;
  }, 0);
}

function getProductiveMinutesRemaining(registros: RegistroHorarioRow[], now = new Date()): number {
  const hour = mexicoDecimalHour(now);
  return registros.reduce((total, registro) => {
    const start = Number(registro.hora_inicio_bloque);
    const end = start + Number(registro.duracion);
    return total + Math.max(end - Math.max(hour, start), 0) * 60;
  }, 0);
}

function findNextBlock(registros: RegistroHorarioRow[], now = new Date()): RegistroHorarioRow | null {
  const hour = mexicoDecimalHour(now);
  for (const registro of registros) {
    if (Number(registro.hora_inicio_bloque) > hour) return registro;
  }
  return null;
}

function blockBoundaryIso(registro: RegistroHorarioRow, edge: "start" | "end", now = new Date()): string {
  const start = Number(registro.hora_inicio_bloque);
  const decimal = edge === "start" ? start : start + Number(registro.duracion);
  return mexicoIsoAtDecimalHour(now, decimal);
}

function mexicoIsoAtDecimalHour(date: Date, decimalHour: number): string {
  const parts = mexicoDateParts(date);
  const hour = Math.floor(decimalHour);
  const minute = Math.floor((decimalHour - hour) * 60);
  const second = Math.round((((decimalHour - hour) * 60) - minute) * 60);
  return (
    parts.year +
    "-" +
    pad2(parts.month) +
    "-" +
    pad2(parts.day) +
    "T" +
    pad2(hour) +
    ":" +
    pad2(minute) +
    ":" +
    pad2(second) +
    "-06:00"
  );
}

function mexicoIso(date: Date): string {
  const parts = mexicoDateParts(date);
  return (
    parts.year +
    "-" +
    pad2(parts.month) +
    "-" +
    pad2(parts.day) +
    "T" +
    pad2(parts.hour) +
    ":" +
    pad2(parts.minute) +
    ":" +
    pad2(parts.second) +
    "-06:00"
  );
}

function mexicoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  return {
    year: parts.find((part) => part.type === "year")?.value ?? "1970",
    month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
    second: Number(parts.find((part) => part.type === "second")?.value ?? 0)
  };
}

function pad2(value: number | string): string {
  return String(value).padStart(2, "0");
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
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

// Defectos activos registrados en el bloque horario actual (calidad_perdidas).
// Solo lectura — el scanner_operator la tiene por RLS. Se usa para mostrar el
// contador "Buenos" = pares del bloque - defectos, sin tocar la produccion.
async function getBlockDefectCount(client: SupabaseClient, blockId: string, bandId: Banda): Promise<number> {
  const { count, error } = await client
    .from("calidad_perdidas")
    .select("id", { count: "exact", head: true })
    .eq("registro_horario_id", blockId)
    .eq("banda", bandId)
    .eq("estado", "activo");

  if (error) {
    logStationIssue("calidad_perdidas.count", classifySupabaseError(error), {
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

async function getJourneyRegisters(
  client: SupabaseClient,
  jornadaId: string,
  userId: string
): Promise<RegistroHorarioRow[]> {
  const { data, error } = await client
    .from("registros_horarios")
    .select("id,hora_inicio_bloque,duracion,pares,orden")
    .eq("jornada_id", jornadaId)
    .order("orden", { ascending: true });

  if (error) {
    logStationIssue("registros_horarios.preflight", classifySupabaseError(error), {
      userId,
      supabaseCode: error.code ?? null
    });
    throw new StationDataError(classifySupabaseError(error), "No fue posible leer los bloques horarios.");
  }

  return (data ?? []) as RegistroHorarioRow[];
}

function preflightExpectedStatus(
  hasJourney: boolean,
  blockStatus: StationStatusData["blockStatus"],
  productReady: boolean,
  productStatus: string | null
): ScannerPreflightData["expectedStatus"] {
  if (!hasJourney) return "NO_ACTIVE_SHIFT";
  if (!productReady) return productStatus && productStatus !== "activo" ? "PRODUCT_INACTIVE" : "PRODUCT_NOT_FOUND";
  if (blockStatus === "active") return "READY_TO_SCAN";
  if (blockStatus === "break") return "BREAK_TIME";
  if (blockStatus === "outside_schedule") return "OUTSIDE_SCHEDULE";
  return "NO_ACTIVE_BLOCK";
}

type ProductResolutionInternal = {
  product: ProductoRow | null;
  stage: ProductResolutionData["stage"];
};

async function resolveProductByCode(client: SupabaseClient, barcode: string): Promise<ProductResolutionInternal> {
  const { data: direct, error: directError } = await client
    .from("productos")
    .select("id,codigo_id,sku,cliente_marca,modelo,color,talla,estado")
    .eq("codigo_id", barcode)
    .maybeSingle();

  if (directError) {
    if (directError.code === "42501" || /permission|rls|policy/i.test(directError.message ?? "")) {
      throw new StationScanError("CATALOG_PERMISSION_DENIED", "Permiso de catalogo insuficiente.", 403);
    }
    throw new StationScanError("SCAN_WRITE_FAILED", "No fue posible validar el codigo.", 500, true);
  }
  if (direct) return { product: direct as ProductoRow, stage: "products.codigo_id" };

  const { data: alias, error: aliasError } = await client
    .from("productos_codigos_alias")
    .select("productos(id,codigo_id,sku,cliente_marca,modelo,color,talla,estado)")
    .eq("codigo_id", barcode)
    .maybeSingle();

  if (aliasError && aliasError.code !== "42P01") {
    if (aliasError.code === "42501" || /permission|rls|policy/i.test(aliasError.message ?? "")) {
      throw new StationScanError("CATALOG_PERMISSION_DENIED", "Permiso de catalogo insuficiente.", 403);
    }
    throw new StationScanError("SCAN_WRITE_FAILED", "No fue posible validar el codigo.", 500, true);
  }

  const aliasProductRaw = (alias as { productos?: ProductoRow | ProductoRow[] | null } | null)?.productos ?? null;
  const aliasProduct = Array.isArray(aliasProductRaw) ? aliasProductRaw[0] ?? null : aliasProductRaw;
  return aliasProduct
    ? { product: aliasProduct, stage: "productos_codigos_alias.codigo_id" }
    : { product: null, stage: "not_found" };
}

export function normalizeScannedCode(value: string): string {
  return value
    .replace(/^[\s\u200b-\u200d\ufeff]+|[\s\u200b-\u200d\ufeff]+$/g, "")
    .replace(/[\r\n\t\u200b-\u200d\ufeff]+/g, "");
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
