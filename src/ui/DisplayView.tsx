import { useCallback, useEffect, useRef, useState } from "react";
import { DisplayStatus, getDisplayStatus, logout } from "../lib/api";

type Props = {
  onLogout: () => void;
};

type DisplayState = DisplayStatus | null;

export function DisplayView({ onLogout }: Props) {
  const inFlightRef = useRef(false);
  const serverBaseRef = useRef<number | null>(null);
  const localBaseRef = useRef<number | null>(null);
  const [status, setStatus] = useState<DisplayState>(null);
  const [clock, setClock] = useState(new Date());
  const [offline, setOffline] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const blockStatus = status?.blockStatus ?? null;

  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    getDisplayStatus()
      .then((result) => {
        if (!result.ok) {
          setOffline(true);
          return;
        }
        serverBaseRef.current = new Date(result.serverTime).getTime();
        localBaseRef.current = Date.now();
        setClock(new Date(result.serverTime));
        setStatus(result);
        setLastUpdate(result.serverTime);
        setOffline(false);
      })
      .catch(() => {
        setOffline(true);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (serverBaseRef.current != null && localBaseRef.current != null) {
        setClock(new Date(serverBaseRef.current + Date.now() - localBaseRef.current));
      } else {
        setClock(new Date());
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const delay = blockStatus === "active" ? 7000 : 20000;
    const timer = window.setInterval(refresh, delay);
    const onFocus = () => refresh();
    const onOnline = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [blockStatus, refresh]);

  useEffect(() => {
    if (!status) return;
    if (status.productiveSecondsRemaining > 0 && productiveSecondsLeft(status, clock) <= 0 && status.shiftStatus === "active") {
      refresh();
    }
  }, [clock, refresh, status]);

  function handleLogout() {
    if (!window.confirm("Cerrar sesion?")) return;
    logout().finally(onLogout);
  }

  const progress = status && status.hourGoal && status.hourGoal > 0 ? Math.min(status.hourTotal / status.hourGoal, 1) : 0;
  const shiftCountdown = status ? formatDuration(productiveSecondsLeft(status, clock)) : "--:--:--";

  return (
    <main className="display-page">
      <header className="display-header">
        <button className="display-band-button" onClick={handleLogout} type="button">
          <strong>{status?.bandName.toUpperCase() ?? "BANDA"}</strong>
          <span className={"activity-dot " + (status?.shiftStatus === "active" && !offline ? "dot-active" : "dot-paused")} />
          <p>{status?.shiftStatus === "active" ? "Jornada activa" : "Sin jornada activa"}</p>
        </button>
      </header>

      {offline && (
        <section className="display-alert">
          <strong>Conexion interrumpida</strong>
          <span>Mostrando ultima actualizacion: {lastUpdate ? formatClock(new Date(lastUpdate)) : "sin datos"}</span>
        </section>
      )}

      {!status ? (
        <section className="display-empty display-empty-loading">
          <div className="empty-orbit" aria-hidden="true" />
          <strong>Cargando tablero</strong>
          <span>Consultando estado de la banda.</span>
        </section>
      ) : status.shiftStatus !== "active" ? (
        <section className="display-empty">
          <div className="display-empty-kicker">{status.bandName.toUpperCase()}</div>
          <strong>Sin jornada activa</strong>
          <span>El tablero se encendera cuando DinoCore abra la jornada.</span>
          <div className="display-empty-summary">
            <Metric title="TOTAL DEL DIA" value={status.dayTotal} />
            <Metric title="META DEL DIA" value={status.dayGoal} />
            <Metric title="ESTADO" value="En espera" compact />
          </div>
        </section>
      ) : (
        <>
          <section className="display-hero-grid">
            <article className="display-hero-card">
              <span>TIEMPO RESTANTE DE LA JORNADA</span>
              <strong>{shiftCountdown}</strong>
            </article>
            <article className="display-hero-card">
              <span>PARES ESTA HORA</span>
              <strong>{status.blockStatus === "active" ? status.hourTotal : "-"}</strong>
              <progress max={1} value={progress} />
              <p>
                {status.blockStatus === "active" && status.hourGoal != null
                  ? status.hourTotal + " / " + status.hourGoal + " · META DE LA HORA"
                  : displayDetail(status)}
              </p>
            </article>
          </section>

          <section className="display-secondary-grid">
            <Metric title="PARES FALTANTES" value={status.hourRemaining ?? 0} tone="warn" />
            <Metric title="PARES DE ATRASO" value={status.delay} tone="bad" />
            <Metric title="PARES ADELANTADOS" value={status.ahead} tone="good" />
          </section>

          <section className="display-bottom-bar">
            <BottomMetric title="TOTAL DEL DIA" value={status.dayTotal} />
            <BottomMetric title="META DEL DIA" value={status.dayGoal} />
            <BottomMetric
              title="PROM. ACTUAL / MIN"
              value={formatRate(status.currentAveragePerMinute)}
              subvalue={"IDEAL: " + formatRate(status.idealAveragePerMinute) + " / MIN"}
              subtleDanger
            />
            <BottomMetric title="RESULTADO PROYECTADO" value={status.projectedResult} />
            <BottomMetric title="CUMPLIMIENTO" value={status.projectedCompliance == null ? "-" : status.projectedCompliance + "%"} />
          </section>
        </>
      )}
    </main>
  );
}

function BottomMetric({
  title,
  value,
  subvalue,
  subtleDanger
}: {
  title: string;
  value: number | string;
  subvalue?: string;
  subtleDanger?: boolean;
}) {
  return (
    <article className="display-bottom-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      {subvalue && <small className={subtleDanger ? "subtle-danger" : ""}>{subvalue}</small>}
    </article>
  );
}

function Metric({
  title,
  value,
  tone,
  compact
}: {
  title: string;
  value: number | string;
  tone?: "good" | "warn" | "bad";
  compact?: boolean;
}) {
  return (
    <article className={"display-metric " + (tone ? "metric-" + tone : "") + (compact ? " metric-compact" : "")}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function displayDetail(status: DisplayStatus) {
  if (status.blockStatus === "break" && status.nextBlockStartsAt) {
    return "Proximo bloque: " + formatClock(new Date(status.nextBlockStartsAt));
  }
  if (status.blockStatus === "outside_schedule") return "Fuera del horario de produccion";
  return status.statusDetail;
}

function productiveSecondsLeft(status: DisplayStatus, now: Date) {
  const serverTime = new Date(status.serverTime).getTime();
  const elapsed = Math.max(Math.floor((now.getTime() - serverTime) / 1000), 0);
  return Math.max(status.productiveSecondsRemaining - elapsed, 0);
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return pad2(hours) + ":" + pad2(minutes) + ":" + pad2(seconds);
}

function formatClock(value: Date) {
  return value.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "America/Mexico_City"
  });
}

function formatRate(value: number) {
  return value.toFixed(2);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export default DisplayView;
