import { lazy, Suspense, useEffect, useState } from "react";
import { getProfile, LoginResponse, login, refreshSession, StationMode } from "../lib/api";
import { loginMessageForCode } from "../lib/loginErrors";
import { LoginView } from "./LoginView";

const ScannerView = lazy(() => import("./ScannerView"));
const DisplayView = lazy(() => import("./DisplayView"));

type SessionState = "checking" | "logged-out" | "logged-in";
type RoutePath = "/scanner" | "/display";

export function App() {
  const [session, setSession] = useState<SessionState>("checking");
  const [sessionError, setSessionError] = useState("");
  const [stationMode, setStationMode] = useState<StationMode>("scanner");

  useEffect(() => {
    loadProfile()
      .then((profile) => {
        if (!profile.ok) {
          setSession("logged-out");
          return;
        }
        setStationMode(profile.stationMode);
        const nextRoute = routeForMode(profile.stationMode);
        replaceRoute(nextRoute);
        setSession("logged-in");
      })
      .catch(() => setSession("logged-out"));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshSession().catch(() => undefined);
    }, 45 * 60 * 1000);
    const onFocus = () => refreshSession().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (session !== "logged-in") return;
    replaceRoute(routeForMode(stationMode));
  }, [session, stationMode]);

  function handleLogin(email: string, password: string): Promise<LoginResponse> {
    setSessionError("");
    return login(email, password).then((result) => {
      if (result.ok) {
        setStationMode(result.stationMode);
        const nextRoute = routeForMode(result.stationMode);
        replaceRoute(nextRoute);
        setSession("logged-in");
      } else {
        setSessionError(loginMessageForCode(result.code, result.message));
      }
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

  return (
    <Suspense fallback={<LoadingPanel />}>
      {stationMode === "band_display" ? (
        <DisplayView onLogout={() => setSession("logged-out")} />
      ) : (
        <ScannerView onLogout={() => setSession("logged-out")} />
      )}
    </Suspense>
  );
}

function LoadingPanel() {
  return (
    <main className="shell shell-center">
      <section className="panel login-panel">
        <p className="eyebrow">Estacion 337</p>
        <h1>Cargando</h1>
        <p className="muted">Preparando vista...</p>
      </section>
    </main>
  );
}

function routeForMode(mode: StationMode): RoutePath {
  return mode === "band_display" ? "/display" : "/scanner";
}

function replaceRoute(path: RoutePath) {
  if (window.location.pathname !== path) window.history.replaceState(null, "", path);
}

async function loadProfile() {
  const profile = await getProfile();
  if (profile.ok || profile.code !== "TOKEN_EXPIRED") return profile;
  const refreshed = await refreshSession();
  if (!refreshed.ok) return profile;
  return getProfile();
}
