import { useEffect, useState } from "react";
import { getStatus, LoginResponse, login } from "../lib/api";
import { loginMessageForCode } from "../lib/loginErrors";
import { LoginView } from "./LoginView";
import { ScannerView } from "./ScannerView";

type SessionState = "checking" | "logged-out" | "logged-in";

export function App() {
  const [session, setSession] = useState<SessionState>("checking");
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    getStatus()
      .then((status) => {
        if (status.ok || status.code === "SCHEMA_MAPPING_REQUIRED") setSession("logged-in");
        else setSession("logged-out");
      })
      .catch(() => setSession("logged-out"));
  }, []);

  function handleLogin(email: string, password: string): Promise<LoginResponse> {
    setSessionError("");
    return login(email, password).then((result) => {
      if (result.ok) setSession("logged-in");
      else setSessionError(loginMessageForCode(result.code, result.message));
      return result;
    });
  }

  if (session === "checking") {
    return (
      <main className="shell shell-center">
        <section className="panel login-panel">
          <p className="eyebrow">Estacion de escaneo</p>
          <h1>Estacion 337</h1>
          <p className="muted">Verificando sesion...</p>
        </section>
      </main>
    );
  }

  if (session === "logged-out") {
    return <LoginView error={sessionError} onLogin={handleLogin} />;
  }

  return <ScannerView onLogout={() => setSession("logged-out")} />;
}
