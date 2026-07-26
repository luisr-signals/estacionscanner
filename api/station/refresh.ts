import { createClient } from "@supabase/supabase-js";
import {
  ApiRequest,
  ApiResponse,
  clearSessionCookies,
  getRefreshToken,
  jsonError,
  methodNotAllowed,
  setSessionCookies
} from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const refreshToken = getRefreshToken(req);
  if (!refreshToken) return jsonError(res, 401, "NOT_AUTHENTICATED", "Inicia sesion.");

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return jsonError(res, 503, "SUPABASE_NOT_CONFIGURED", "Configura Supabase.", true);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    clearSessionCookies(res);
    return jsonError(res, 401, "TOKEN_EXPIRED", "Tu sesion vencio. Inicia sesion nuevamente.");
  }

  setSessionCookies(res, data.session.access_token, data.session.refresh_token, data.session.expires_in ?? 3300);
  return res.status(200).json({ ok: true });
}
