import { ApiRequest, ApiResponse, getSessionToken, jsonError, methodNotAllowed, readString } from "../_lib/http.js";
import {
  assertStationMode,
  getStationProfile,
  getSupabaseForToken,
  registerQualityDefect,
  resolveQualityDefect,
  schemaMappingMessage,
  StationDataError,
  StationScanError
} from "../_lib/supabase.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const token = getSessionToken(req);
  if (!token) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  const body = (req.body || {}) as Record<string, unknown>;
  const mode = readString(body.mode) || "register";
  const defectoCodigo = readString(body.defectoCodigo);
  const parCodigo = readString(body.parCodigo);
  const clienteUuid = readString(body.clienteUuid);

  if (!defectoCodigo) {
    return jsonError(res, 400, "INVALID_DEFECT", "El codigo de defecto es obligatorio.");
  }
  if (mode === "register" && !parCodigo) {
    return jsonError(res, 400, "PAIR_REQUIRED", "Escanea primero un par antes de registrar un defecto.");
  }
  if (mode === "register" && !clienteUuid) {
    return jsonError(res, 400, "INVALID_DEFECT", "Falta el identificador de registro.");
  }

  try {
    const client = getSupabaseForToken(token);
    const profile = await getStationProfile(client);
    assertStationMode(profile, "scanner");

    if (mode === "lookup") {
      const defecto = await resolveQualityDefect(client, defectoCodigo);
      return res.status(200).json({ ok: true, ...defecto });
    }

    const registered = await registerQualityDefect(client, { defectoCodigo, parCodigo, clienteUuid, profile });
    return res.status(200).json({ ok: true, registered: true, ...registered });
  } catch (error) {
    if (error instanceof StationDataError) {
      const statusCode = error.code === "TOKEN_EXPIRED" ? 401 : error.code === "INVALID_ROLE" ? 403 : 409;
      return jsonError(res, statusCode, error.code, error.message, error.code === "SUPABASE_QUERY_FAILED");
    }
    if (error instanceof StationScanError) {
      return jsonError(res, error.status, error.code, error.message, error.retryable);
    }
    if ((error as Error).message === "SCHEMA_MAPPING_REQUIRED") {
      return jsonError(res, 501, "SCHEMA_MAPPING_REQUIRED", schemaMappingMessage());
    }
    return jsonError(res, 500, "DEFECT_FAILED", "No fue posible registrar el defecto.", true);
  }
}
