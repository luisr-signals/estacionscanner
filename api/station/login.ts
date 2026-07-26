import { createClient } from "@supabase/supabase-js";
import { ApiRequest, ApiResponse, jsonError, methodNotAllowed, readString, setSessionCookie } from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return jsonError(res, 503, "SUPABASE_NOT_CONFIGURED", "Falta configurar la conexion de Estacion 337.", true);
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const email = readString(body.email);
  const password = readString(body.password);
  if (!email || !password) {
    return jsonError(res, 400, "MISSING_CREDENTIALS", "Ingresa correo y contrasena.");
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return jsonError(res, 401, "INVALID_LOGIN", "Correo o contrasena incorrectos.");
  }
  if (!data.session) {
    return jsonError(res, 500, "SESSION_INCOMPATIBLE", "No fue posible guardar la sesion en este dispositivo.", true);
  }

  setSessionCookie(res, data.session.access_token);
  res.status(200).json({
    ok: true,
    operatorName: data.user.email || "Operador",
    bandName: "Banda pendiente",
    shiftStatus: "missing"
  });
}
