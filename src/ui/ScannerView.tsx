import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { getRecent, getStatus, logout, RecentScan, StationStatus, submitScan } from "../lib/api";
import { canSubmitScan, createScanId, normalizeBarcode, scannerTone, ScannerState } from "../lib/scanner";

type Props = {
  onLogout: () => void;
};

type Totals = {
  hourTotal: number;
  hourGoal: number | null;
  dayTotal: number;
  pendingCount: number;
};

const emptyTotals: Totals = { hourTotal: 0, hourGoal: null, dayTotal: 0, pendingCount: 0 };

export function ScannerView({ onLogout }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [status, setStatus] = useState<StationStatus | null>(null);
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [scannerState, setScannerState] = useState<ScannerState>("ready");
  const [message, setMessage] = useState("Listo para escanear");
  const [lastProduct, setLastProduct] = useState("Sin registros todavia");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [clock, setClock] = useState(new Date());
  const [totals, setTotals] = useState<Totals>(emptyTotals);

  useEffect(() => {
    refresh();
    const statusTimer = window.setInterval(refresh, 15000);
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const onOnline = () => {
      setOnline(true);
      setScannerState("ready");
      setMessage("Conexion recuperada");
    };
    const onOffline = () => {
      setOnline(false);
      setScannerState("offline");
      setMessage("Sin conexion");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(clockTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    focusInput();
  }, [scannerState, busy]);

  function focusInput() {
    window.setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
  }

  function refresh() {
    getStatus()
      .then((result) => {
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        setStatus(result);
        setTotals({
          hourTotal: result.hourTotal,
          hourGoal: result.hourGoal,
          dayTotal: result.dayTotal,
          pendingCount: result.pendingCount
        });
        if (result.shiftStatus !== "active") setScannerState("paused");
      })
      .catch(() => {
        setScannerState("offline");
        setMessage("Sin conexion");
      });

    getRecent()
      .then((result) => {
        if (result.ok) setRecent(result.scans);
      })
      .catch(() => undefined);
  }

  function playTone(state: ScannerState) {
    const tone = scannerTone(state);
    if (!tone || typeof AudioContext === "undefined") return;
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = tone.frequency;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    window.setTimeout(() => {
      oscillator.stop();
      audio.close();
    }, tone.durationMs);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    processScan();
  }

  function processScan() {
    if (!canSubmitScan(barcode, busy, online)) {
      if (!online) setMessage("Sin conexion");
      focusInput();
      return;
    }

    const cleanBarcode = normalizeBarcode(barcode);
    const scanId = createScanId();
    setBusy(true);
    setScannerState("waiting");
    setMessage("Guardando registro...");

    submitScan(cleanBarcode, scanId)
      .then((result) => {
        if (result.ok) {
          setScannerState("success");
          setMessage(result.duplicate ? "Registro ya confirmado" : "Registro guardado");
          setLastProduct(result.product);
          setBarcode("");
          setTotals({
            hourTotal: result.hourTotal,
            hourGoal: result.hourGoal,
            dayTotal: result.dayTotal,
            pendingCount: totals.pendingCount
          });
          playTone("success");
          refresh();
        } else {
          setScannerState("error");
          setMessage(result.message);
          playTone("error");
        }
      })
      .catch(() => {
        setScannerState("offline");
        setMessage("Sin conexion. Reintenta cuando vuelva la red.");
      })
      .finally(() => {
        setBusy(false);
        focusInput();
      });
  }

  function reactivate() {
    if (!online) {
      setScannerState("offline");
      setMessage("Sin conexion");
      return;
    }
    setScannerState("ready");
    setMessage("Listo para escanear");
    focusInput();
  }

  function handleLogout() {
    logout().finally(onLogout);
  }

  const difference = totals.hourGoal == null ? null : totals.hourTotal - totals.hourGoal;

  return (
    <main className={"scanner-page scanner-" + scannerState}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Estacion 337</p>
          <h1>Escaneo en vivo</h1>
        </div>
        <button className="secondary-button" onClick={handleLogout} type="button">
          Cerrar sesion
        </button>
      </header>

      <section className="status-strip">
        <strong>{status ? status.bandName : "Banda sin cargar"}</strong>
        <span>{status ? labelShift(status.shiftStatus) : "Validando jornada"}</span>
        <span>{online ? message : "Sin conexion"}</span>
        <time>{clock.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
      </section>

      <section className="scan-workspace">
        <div className="capture-panel">
          <label htmlFor="barcode">Captura del lector</label>
          <input
            ref={inputRef}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            disabled={busy || scannerState === "paused"}
            id="barcode"
            inputMode="numeric"
            onBlur={focusInput}
            onChange={(event) => setBarcode(event.target.value)}
            onKeyDown={handleKeyDown}
            value={barcode}
          />
          <div className="scan-actions">
            <button className="secondary-button" onClick={reactivate} type="button">
              Reactivar escaner
            </button>
            <button className="primary-button" disabled={busy || !barcode} onClick={processScan} type="button">
              Registrar
            </button>
          </div>
          <p className="last-product">{lastProduct}</p>
        </div>

        <aside className="totals-panel">
          <Metric label="Total hora" value={totals.hourTotal} />
          <Metric label="Meta hora" value={totals.hourGoal == null ? "N/D" : totals.hourGoal} />
          <Metric label="Diferencia" value={difference == null ? "N/D" : difference} />
          <Metric label="Total dia" value={totals.dayTotal} />
          <Metric label="Pendientes" value={totals.pendingCount} />
        </aside>
      </section>

      <section className="recent-panel">
        <h2>Ultimos registros</h2>
        {recent.length === 0 ? (
          <p className="muted">Aun no hay registros recientes.</p>
        ) : (
          <ol>
            {recent.slice(0, 20).map((scan) => (
              <li key={scan.id}>
                <span>{scan.product}</span>
                <time>{formatTime(scan.scannedAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function labelShift(value: StationStatus["shiftStatus"]) {
  if (value === "active") return "Jornada activa";
  if (value === "paused") return "Scanner pausado";
  return "Sin jornada";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
