import { KeyboardEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getRecent,
  getStatus,
  logout,
  MovementQuantity,
  RecentScan,
  StationStatus,
  submitAdjustment,
  submitScan
} from "../lib/api";
import { canConfirmAdjustment, RecentProduct, recentProductsFromScans } from "../lib/manual";
import { canSubmitScan, createScanId, normalizeBarcode, scannerTone, ScannerState } from "../lib/scanner";

type Props = {
  onLogout: () => void;
};

type Notice = {
  tone: "success" | "error" | "waiting" | "offline";
  title: string;
  detail: string;
};

type ManualAction = "add" | "remove";

type Totals = {
  hourTotal: number;
  hourGoal: number | null;
};

const emptyTotals: Totals = { hourTotal: 0, hourGoal: null };

export function ScannerView({ onLogout }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const [barcode, setBarcode] = useState("");
  const [status, setStatus] = useState<StationStatus | null>(null);
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [scannerState, setScannerState] = useState<ScannerState>("ready");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [clock, setClock] = useState(new Date());
  const [totals, setTotals] = useState<Totals>(emptyTotals);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAction, setManualAction] = useState<ManualAction | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<RecentProduct | null>(null);

  const recentProducts = useMemo(() => recentProductsFromScans(recent), [recent]);

  const focusInput = useCallback(() => {
    if (manualOpen) return;
    window.setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 30);
  }, [manualOpen]);

  const showNotice = useCallback((nextNotice: Notice, autoHide: boolean) => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice(nextNotice);
    if (autoHide) {
      noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2000);
    }
  }, []);

  const refresh = useCallback(() => {
    getStatus()
      .then((result) => {
        if (!result.ok) {
          setNotice({ tone: result.code === "TOKEN_EXPIRED" ? "offline" : "error", title: statusTitle(result.code), detail: result.message });
          return;
        }
        setStatus(result);
        setTotals({ hourTotal: result.hourTotal, hourGoal: result.hourGoal });
        if (result.shiftStatus !== "active") {
          setScannerState("paused");
          setNotice({
            tone: "offline",
            title: result.shiftStatus === "missing" ? "Sin jornada activa" : "Escaner pausado",
            detail:
              result.shiftStatus === "missing"
                ? "Inicia la jornada en DinoCore para comenzar a escanear."
                : "La banda no esta disponible para escanear."
          });
        } else if (online && scannerState !== "waiting") {
          setScannerState("ready");
        }
      })
      .catch(() => {
        setScannerState("offline");
        setNotice({ tone: "offline", title: "Sin conexion", detail: "No se pudo consultar la estacion" });
      });

    getRecent()
      .then((result) => {
        if (result.ok) setRecent(result.scans.slice(0, 20));
      })
      .catch(() => undefined);
  }, [online, scannerState]);

  useEffect(() => {
    refresh();
    const statusTimer = window.setInterval(refresh, 15000);
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const onOnline = () => {
      setOnline(true);
      setScannerState("ready");
      setNotice({ tone: "success", title: "Conexion recuperada", detail: "Listo para escanear" });
    };
    const onOffline = () => {
      setOnline(false);
      setScannerState("offline");
      setNotice({ tone: "offline", title: "Sin conexion", detail: "No se confirmaran registros sin servidor" });
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(clockTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    focusInput();
  }, [scannerState, busy, manualOpen, focusInput]);

  function playTone(state: ScannerState) {
    const tone = scannerTone(state);
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!tone || !AudioCtor) return;
    const audio = new AudioCtor();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = tone.frequency;
    gain.gain.value = 0.06;
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
    if (busyRef.current) return;
    if (!canSubmitScan(barcode, busy, online)) {
      if (!online) showNotice({ tone: "offline", title: "Sin conexion", detail: "Reintenta cuando vuelva la red" }, false);
      focusInput();
      return;
    }

    const cleanBarcode = normalizeBarcode(barcode);
    const scanId = createScanId();
    busyRef.current = true;
    setBusy(true);
    setScannerState("waiting");
    showNotice({ tone: "waiting", title: "Guardando registro...", detail: cleanBarcode }, false);

    submitScan(cleanBarcode, scanId)
      .then((result) => {
        if (result.ok) {
          setScannerState("success");
          setBarcode("");
          setTotals({ hourTotal: result.hourTotal, hourGoal: result.hourGoal });
          showNotice(
            {
              tone: "success",
              title: result.duplicate ? "Registro ya confirmado" : "+1 par registrado",
              detail: result.product
            },
            true
          );
          playTone("success");
          refresh();
        } else {
          setScannerState("error");
          showNotice(
            {
              tone: "error",
              title: result.message,
              detail: result.code === "UNKNOWN_BARCODE" ? "Revisa la etiqueta e intenta nuevamente." : result.code
            },
            false
          );
          playTone("error");
        }
      })
      .catch(() => {
        setScannerState("offline");
        showNotice({ tone: "offline", title: "Sin conexion", detail: "No se confirmo el registro" }, false);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
        focusInput();
      });
  }

  function openManualPanel() {
    showNotice({ tone: "offline", title: "Ajustes manuales proximamente", detail: "Esta fase solo habilita escaneos." }, true);
    focusInput();
  }

  function closeManualPanel() {
    setManualOpen(false);
    setManualAction(null);
    setSelectedProduct(null);
    focusInput();
  }

  function confirmAdjustment() {
    if (!canConfirmAdjustment(manualAction, selectedProduct, manualBusy)) return;
    const product = selectedProduct as RecentProduct;
    const quantity: MovementQuantity = manualAction === "remove" ? -1 : 1;
    const adjustmentId = createScanId();
    setManualBusy(true);
    showNotice({ tone: "waiting", title: "Guardando ajuste...", detail: product.product }, false);

    submitAdjustment(product.productId, quantity, adjustmentId)
      .then((result) => {
        if (result.ok) {
          setTotals({ hourTotal: result.hourTotal, hourGoal: result.hourGoal });
          showNotice(
            {
              tone: quantity > 0 ? "success" : "error",
              title: quantity > 0 ? "+1 par registrado" : "-1 par registrado",
              detail: result.product
            },
            true
          );
          playTone(quantity > 0 ? "success" : "error");
          closeManualPanel();
          refresh();
        } else {
          showNotice({ tone: "error", title: result.message, detail: result.code }, false);
          playTone("error");
        }
      })
      .catch(() => showNotice({ tone: "offline", title: "Sin conexion", detail: "No se confirmo el ajuste" }, false))
      .finally(() => {
        setManualBusy(false);
        focusInput();
      });
  }

  function handlePageClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "LABEL") return;
    focusInput();
  }

  function handleLogout() {
    logout().finally(onLogout);
  }

  return (
    <main className="scanner-page" onClick={handlePageClick}>
      <header className="station-header">
        <div className="station-title">
          <div>
            <strong>ESTACION 337</strong>
            <span className={"activity-dot dot-" + dotStatus(status, online)} aria-hidden="true" />
          </div>
          <p>{status ? status.bandName + " · " + labelShift(status.shiftStatus) : "Cargando estacion"}</p>
        </div>
        <time className="station-clock">{formatClock(clock)}</time>
        <button className="logout-button" onClick={handleLogout} type="button">
          Cerrar sesion
        </button>
      </header>

      <section className="scan-row" aria-label="Captura principal">
        <div className="scan-input-card">
          <label htmlFor="barcode">Escanea el codigo</label>
          <input
            ref={inputRef}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            autoFocus
            disabled={busy || scannerState === "paused"}
            id="barcode"
            inputMode="none"
            onBlur={focusInput}
            onChange={(event) => setBarcode(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="El lector escribe aqui y envia Enter"
            type="text"
            value={barcode}
          />
        </div>
        <aside className="hour-total-card">
          <span>TOTAL ESTA HORA</span>
          <strong>{totals.hourTotal}</strong>
        </aside>
      </section>

      {notice && (
        <section className={"scan-notice notice-" + notice.tone} role="status">
          <strong>{notice.title}</strong>
          <span>{notice.detail}</span>
        </section>
      )}

      <section className="recent-card">
        <div className="recent-heading">
          <h2>Ultimos escaneos</h2>
          <button className="manual-button" onClick={openManualPanel} type="button" aria-label="Ajuste manual">
            ±
          </button>
        </div>
        <div className="recent-table" role="table" aria-label="Ultimos escaneos">
          <div className="recent-table-head" role="row">
            <span role="columnheader">REGISTRO</span>
            <span role="columnheader">PRODUCTO</span>
            <span role="columnheader">HORA</span>
          </div>
          {recent.length === 0 ? (
            <p className="empty-recent">Aun no hay movimientos recientes.</p>
          ) : (
            recent.slice(0, 3).map((scan) => (
              <div className="recent-table-row" role="row" key={scan.id}>
                <strong className={scan.quantity > 0 ? "qty-plus" : "qty-minus"} role="cell">
                  {scan.quantity > 0 ? "+1" : "-1"}
                </strong>
                <span role="cell">{scan.product}</span>
                <time role="cell">{formatMovementTime(scan.scannedAt)}</time>
              </div>
            ))
          )}
        </div>
      </section>

      {manualOpen && (
        <section className="manual-overlay" role="dialog" aria-modal="true" aria-labelledby="manual-title">
          <div className="manual-panel">
            <div className="manual-title-row">
              <h2 id="manual-title">Ajuste manual</h2>
              <button className="close-button" onClick={closeManualPanel} type="button">
                Cerrar
              </button>
            </div>

            <div className="manual-options" role="group" aria-label="Tipo de ajuste">
              <button
                className={manualAction === "add" ? "selected-option" : ""}
                onClick={() => setManualAction("add")}
                type="button"
              >
                Agregar
              </button>
              <button
                className={manualAction === "remove" ? "selected-option danger-option" : "danger-option"}
                onClick={() => setManualAction("remove")}
                type="button"
              >
                Quitar
              </button>
            </div>

            <h3>Modelos recientes</h3>
            <div className="manual-products">
              {recentProducts.length === 0 ? (
                <p className="empty-recent">No hay modelos recientes para ajustar.</p>
              ) : (
                recentProducts.map((product) => (
                  <button
                    className={selectedProduct && selectedProduct.productId === product.productId ? "selected-product" : ""}
                    disabled={manualAction === "remove" && !product.availableToRemove}
                    key={product.productId}
                    onClick={() => setSelectedProduct(product)}
                    type="button"
                  >
                    {product.product}
                  </button>
                ))
              )}
            </div>

            {manualAction && selectedProduct && (
              <div className="manual-confirmation">
                <strong>{manualAction === "add" ? "Agregar 1 par" : "Quitar 1 par"}</strong>
                <span>{selectedProduct.product}</span>
              </div>
            )}

            <button
              className="confirm-adjustment-button"
              disabled={!canConfirmAdjustment(manualAction, selectedProduct, manualBusy)}
              onClick={confirmAdjustment}
              type="button"
            >
              {manualBusy ? "Guardando..." : "Confirmar ajuste"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function dotStatus(status: StationStatus | null, online: boolean) {
  if (!online) return "offline";
  if (!status || status.shiftStatus !== "active") return "paused";
  return "active";
}

function labelShift(value: StationStatus["shiftStatus"]) {
  if (value === "active") return "Jornada activa";
  if (value === "paused") return "Escaner pausado";
  return "Sin jornada";
}

function statusTitle(code: string) {
  if (code === "TOKEN_EXPIRED") return "Tu sesion vencio";
  if (code === "PROFILE_NOT_FOUND") return "Perfil operativo no encontrado";
  if (code === "INVALID_ROLE") return "Cuenta sin permiso";
  if (code === "MISSING_BAND" || code === "MISSING_STATION") return "Perfil incompleto";
  if (code === "RLS_BLOCKED") return "Permiso de lectura insuficiente";
  return "Sesion o estacion no disponible";
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

function formatMovementTime(value: string) {
  return new Date(value).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Mexico_City"
  });
}
