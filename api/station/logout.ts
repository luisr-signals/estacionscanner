import { ApiRequest, ApiResponse, clearSessionCookie, methodNotAllowed } from "../_lib/http.js";

export default async function handler(req: ApiRequest, res: ApiResponse<any>) {
  if (req.method !== "POST") return methodNotAllowed(res);
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}
