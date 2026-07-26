const loginErrorMessages: Record<string, string> = {
  SUPABASE_NOT_CONFIGURED: "Falta configurar la conexion de Estacion 337.",
  INVALID_LOGIN: "Correo o contrasena incorrectos.",
  MISSING_CREDENTIALS: "Ingresa correo y contrasena.",
  PROFILE_NOT_FOUND: "No encontramos el perfil operativo de esta cuenta.",
  INVALID_ROLE: "Esta cuenta no tiene permiso para usar la estacion.",
  MISSING_BAND: "La cuenta no tiene una banda asignada.",
  SESSION_INCOMPATIBLE: "No fue posible guardar la sesion en este dispositivo.",
  LOGIN_NETWORK_ERROR: "No fue posible conectar con el servidor."
};

export function loginMessageForCode(code: string, fallback: string): string {
  return loginErrorMessages[code] || fallback || "No fue posible iniciar sesion.";
}
