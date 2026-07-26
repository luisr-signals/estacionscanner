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
  const blockEndsAt = status?.blockEndsAt ?? null;
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
    if (!blockEndsAt) return;
    if (remainingSeconds(blockEndsAt, clock) <= 0) refresh();
  }, [blockEndsAt, clock, refresh]);

  function handleLogout() {
    logout().finally(onLogout);
  }

  const blockCountdown = status?.blockEndsAt ? formatDuration(remainingSeconds(status.blockEndsAt, clock)) : null;
  const progress = status && status.hourGoal && status.hourGoal > 0 ? Math.min(status.hourTotal / status.hourGoal, 1) : 0;

  return (
    <main className="display-page">
      <header className="display-header">
        <div>
          <strong>{status?.bandName.toUpperCase() ?? "BANDA"}</strong>
          <span className={"activity-dot " + (status?.shiftStatus === "active" && !offline ? "dot-active" : "dot-paused")} />
          <p>{status?.shiftStatus === "active" ? "Jornada activa" : "Sin jornada activa"}</p>
        </div>
        <time>{formatClock(clock)}</time>
        <button className="logout-button" onClick={handleLogout} type="button">
          Cerrar sesion
        </button>
      </header>

      {offline && (
        <section className="display-alert">
          <strong>Conexion interrumpida</strong>
          <span>Mostrando ultima actualizacion: {lastUpdate ? formatClock(new Date(lastUpdate)) : "sin datos"}</span>
        </section>
      )}

      {!status ? (
        <section className="display-empty">
          <strong>Cargando tablero</strong>
          <span>Consultando estado de la banda.</span>
        </section>
      ) : status.shiftStatus !== "active" ? (
        <section className="display-empty">
          <strong>{status.bandName.toUpperCase()}</strong>
          <span>Sin jornada activa</span>
        </section>
      ) : (
        <>
          <section className="display-status">
            <strong>{displayTitle(status)}</strong>
            <span>{displayDetail(status)}</span>
          </section>

          <section className="display-grid">
            <Metric title="PARES ESTA HORA" value={status.blockStatus === "active" ? status.hourTotal : "-"} />
            <Metric title="META DE LA HORA" value={status.hourGoal ?? "-"} />
            <Metric title="FALTAN" value={status.hourRemaining ?? "-"} tone={status.hourRemaining === 0 ? "good" : "warn"}/>
            <Metric title="TERMINA EN" value={blockCountdown ?? "--:--:--"} compact />
          </section>

          <section className="progress-band">
            <progress max={1} value={progress} />
            <span>
              {status.blockStatus === "active" && status.hourGoal != null
                ? status.hourTotal + " / " + status.hourGoal
                : "Sin bloque activo"}
            </span>
          </section>

          <section className="display-footer">
            <Metric title="TOTAL DEL DIA" value={status.dayTotal} />
            <Metric title="META DEL DIA" value={status.dayGoal} />
            <Metric title="FALTAN DEL DIA" value={status.dayRemaining} />
            <Metric title="RETRASO ACUMULADO" value={status.delay} tone={status.delay > 0 ? "bad" : "good"} />
          </section>

          <section className={"pace-strip pace-" + status.paceStatus}>
            {status.paceLabel}
          </section>
        </>
      )}
    </main>
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

function displayTitle(status: DisplayStatus) {
  if (status.blockStatus === "active") return "BLOQUE ACTIVO";
  if (status.blockStatus === "break") return "HORARIO DE DESCANSO";
  if (status.blockStatus === "outside_schedule") return "JORNADA ABIERTA";
  return status.statusTitle.toUpperCase();
}

function displayDetail(status: DisplayStatus) {
  if (status.blockStatus === "break" && status.nextBlockStartsAt) {
    return "Proximo bloque: " + formatClock(new Date(status.nextBlockStartsAt));
  }
  if (status.blockStatus === "outside_schedule") return "Fuera del horario de produccion";
  return status.statusDetail;
}

function remainingSeconds(target: string, now: Date) {
  return Math.max(Math.floor((new Date(target).getTime() - now.getTime()) / 1000), 0);
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

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export default DisplayView;
