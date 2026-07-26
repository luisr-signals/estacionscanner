import { FormEvent, useState } from "react";
import { LoginResponse } from "../lib/api";

type Props = {
  error: string;
  onLogin: (email: string, password: string) => Promise<LoginResponse>;
};

export function LoginView({ error, onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError("");

    if (!email.trim() || !password) {
      setLocalError("Ingresa correo y contrasena.");
      return;
    }

    setBusy(true);
    onLogin(email.trim(), password)
      .then((result) => {
        if (!result.ok) setLocalError(result.message);
      })
      .catch(() => setLocalError("No fue posible iniciar sesion. Revisa la conexion."))
      .finally(() => setBusy(false));
  }

  return (
    <main className="shell shell-center">
      <section className="panel login-panel" aria-labelledby="login-title">
        <p className="eyebrow">Estacion de escaneo</p>
        <h1 id="login-title">Estacion 337</h1>
        <form className="login-form" onSubmit={submit}>
          <label>
            Correo
            <input
              autoComplete="username"
              inputMode="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Contrasena
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {(localError || error) && <p className="error-text">{localError || error}</p>}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Iniciando..." : "Iniciar sesion"}
          </button>
        </form>
      </section>
    </main>
  );
}
