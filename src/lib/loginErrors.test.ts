import { describe, expect, it } from "vitest";
import { loginMessageForCode } from "./loginErrors";

describe("login error messages", () => {
  it("maps configuration, credential, and permission errors", () => {
    expect(loginMessageForCode("SUPABASE_NOT_CONFIGURED", "")).toBe(
      "Falta configurar la conexion de Estacion 337."
    );
    expect(loginMessageForCode("INVALID_LOGIN", "")).toBe("Correo o contrasena incorrectos.");
    expect(loginMessageForCode("PROFILE_NOT_FOUND", "")).toBe(
      "No encontramos el perfil operativo de esta cuenta."
    );
    expect(loginMessageForCode("INVALID_ROLE", "")).toBe("Esta cuenta no tiene permiso para usar la estacion.");
    expect(loginMessageForCode("MISSING_BAND", "")).toBe("La cuenta no tiene una banda asignada.");
  });

  it("keeps a safe fallback for unknown server codes", () => {
    expect(loginMessageForCode("OTHER", "Mensaje seguro")).toBe("Mensaje seguro");
  });
});
