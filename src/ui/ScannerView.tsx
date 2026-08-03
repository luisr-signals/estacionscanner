import { FormEvent, KeyboardEvent, MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  getManualProducts,
  getRecent,
  getStatus,
  logout,
  lookupDefect,
  ManualProduct,
  MovementQuantity,
  RecentScan,
  StationStatus,
  submitAdjustment,
  submitDefect,
  submitScan
} from "../lib/api";
import { canConfirmAdjustment, RecentProduct } from "../lib/manual";
import { canSubmitScan, createScanId, normalizeBarcode, scannerTone, ScannerState } from "../lib/scanner";

type Props = {
  onLogout: () => void;
};

type Notice = {
  tone: "success" | "error" | "waiting" | "warning" | "offline";
  title: string;
  detail: string;
};

type ManualAction = "add" | "remove";

type Totals = {
  hourTotal: number;
  hourGoal: number | null;
};

type DefectoInfo = {
  codigo: string;
  nombre: string;
  categoria: string;
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
  const [manualProducts, setManualProducts] = useState<ManualProduct[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // ========== ESTADO PARA DEFECTOS ==========
  const [ultimoPar, setUltimoPar] = useState<string | null>(null);
  const [defectoPendiente, setDefectoPendiente] = useState<DefectoInfo | null>(null);

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
        if (result.scannerStatus !== "ready") {
          setScannerState("paused");
          setNotice({
            tone: "offline",
            title: result.statusTitle,
            detail: result.statusDetail
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

  // ========== FUNCIÓN: OBTENER DATOS DEL DEFECTO (vía endpoint serverless) ==========
  async function obtenerDefecto(codigo: string): Promise<DefectoInfo | null> {
    try {
      const result = await lookupDefect(codigo);
      if (!result.ok) return null;
      return { codigo: result.codigo, nombre: result.nombre, categoria: result.categoria };
    } catch (error) {
      console.error('Error al buscar defecto:', error);
      return null;
    }
  }

  // ========== FUNCIÓN: REGISTRAR DEFECTO (vía endpoint serverless) ==========
  // El servidor resuelve par + defecto en paralelo e inserta en registros_calidad
  // dentro de la misma red de Supabase: una sola petición desde el navegador.
  async function registrarDefecto(defectoInfo: DefectoInfo, parCodigo: string) {
    try {
      const result = await submitDefect(defectoInfo.codigo, parCodigo);
      if (!result.ok) {
        return { ok: false as const, message: result.message || 'No se pudo registrar el defecto' };
      }
      return { ok: true as const, nombre: result.nombre, categoria: result.categoria };
    } catch (error) {
      console.error('Error al registrar defecto:', error);
      return { ok: false as const, message: 'Sin conexion. No se confirmo el defecto.' };
    }
  }

  // ========== FUNCIÓN: PROCESAR ESCANEO (MODIFICADA) ==========
  function processScan(rawBarcode: string, triggerKey: string) {
    const capturedBarcode = rawBarcode.trim();

    // =============================================
    // 1. ¿ES UN CÓDIGO DE DEFECTO? (Empieza con DEF-)
    // =============================================
    if (capturedBarcode.startsWith('DEF-')) {
      // Verificar que haya un último par escaneado
      if (!ultimoPar) {
        showNotice({
          tone: "error",
          title: "❌ Error: No hay par escaneado",
          detail: "Escanea primero un par antes de registrar un defecto."
        }, false);
        playTone("error");
        focusInput();
        return;
      }

      // Buscar el defecto en Supabase para obtener su nombre
      obtenerDefecto(capturedBarcode).then((defectoInfo) => {
        if (!defectoInfo) {
          showNotice({
            tone: "error",
            title: "❌ Defecto no reconocido",
            detail: `El código "${capturedBarcode}" no existe en el catálogo.`
          }, false);
          playTone("error");
          focusInput();
          return;
        }

        // PRIMER ESCANEO: No hay defecto pendiente
        if (defectoPendiente === null) {
          setDefectoPendiente(defectoInfo);
          showNotice({
            tone: "waiting",
            title: `⏳ Defecto pendiente: ${defectoInfo.nombre}`,
            detail: `Categoría: ${defectoInfo.categoria} · Escanea de nuevo para confirmar`
          }, false);
          playTone("waiting");
          focusInput();
          return;
        }

        // SEGUNDO ESCANEO: Confirmación (mismo código)
        if (defectoPendiente.codigo === capturedBarcode) {
          registrarDefecto(defectoInfo, ultimoPar).then((result) => {
            if (result.ok) {
              showNotice({
                tone: "success",
                title: `✅ Defecto registrado: ${result.nombre}`,
                detail: `Categoría: ${result.categoria} · Par: ${ultimoPar}`
              }, true);
              playTone("success");
              setDefectoPendiente(null);
              refresh();
            } else {
              showNotice({
                tone: "error",
                title: "❌ Error al registrar defecto",
                detail: result.message || "Intenta nuevamente"
              }, false);
              playTone("error");
              setDefectoPendiente(null);
            }
          });
          focusInput();
          return;
        }

        // ESCANEO DE UN DEFECTO DIFERENTE AL PENDIENTE
        if (defectoPendiente !== null && defectoPendiente.codigo !== capturedBarcode) {
          setDefectoPendiente(defectoInfo);
          showNotice({
            tone: "waiting",
            title: `🔄 Defecto cambiado: ${defectoInfo.nombre}`,
            detail: `Categoría: ${defectoInfo.categoria} · Escanea de nuevo para confirmar.`
          }, false);
          playTone("waiting");
          focusInput();
          return;
        }
      });

      return;
    }

    // =============================================
    // 2. ES UN CÓDIGO DE PAR (PRODUCCIÓN)
    // =============================================
    
    // Resetear defecto pendiente al escanear un nuevo par
    if (defectoPendiente !== null) {
      setDefectoPendiente(null);
    }

    // Guardar el código como último par escaneado
    setUltimoPar(capturedBarcode);

    // --- FLUJO ORIGINAL DE PRODUCCIÓN ---
    if (busyRef.current) {
      logScanInput("blocked_duplicate", capturedBarcode, triggerKey);
      return;
    }
    if (!status || status.scannerStatus !== "ready") {
      logScanInput("blocked_not_ready", capturedBarcode, triggerKey);
      showNotice(
        {
          tone: "offline",
          title: status?.statusTitle ?? "Escaner no disponible",
          detail: status?.statusDetail ?? "Espera a que DinoCore habilite la jornada."
        },
        false
      );
      focusInput();
      return;
    }
    if (!canSubmitScan(capturedBarcode, busy, online)) {
      logScanInput("blocked_invalid", capturedBarcode, triggerKey);
      if (!online) showNotice({ tone: "offline", title: "Sin conexion", detail: "Reintenta cuando vuelva la red" }, false);
      focusInput();
      return;
    }

    const cleanBarcode = normalizeBarcode(capturedBarcode);
    logScanInput("accepted", cleanBarcode, triggerKey);
    const scanId = createScanId();
    busyRef.current = true;
    setBusy(true);
    setScannerState("waiting");
    setBarcode("");
    showNotice({ tone: "waiting", title: "Guardando registro...", detail: cleanBarcode }, false);

    submitScan(cleanBarcode, scanId)
      .then((result) => {
        if (result.ok) {
          setScannerState("success");
          setTotals({ hourTotal: result.hourTotal, hourGoal: result.hourGoal });
          showNotice(
            {
              tone: result.unidentified ? "warning" : "success",
              title: result.duplicate
                ? "Registro ya confirmado"
                : result.unidentified
                  ? "+1 par registrado - producto pendiente de identificar"
                  : "+1 par registrado",
              detail: result.unidentified ? "Codigo: " + result.code : result.product
            },
            true
          );
          playTone("success");
          refresh();
        } else {
          setScannerState("error");
          const friendly = scanErrorCopy(result.code, result.message);
          showNotice(
            {
              tone: "error",
              title: friendly.title,
              detail: friendly.detail
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

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    processScan(event.currentTarget.value, event.key);
  }

  function handleInput(event: FormEvent<HTMLInputElement>) {
    setBarcode(event.currentTarget.value);
  }

  function openManualPanel() {
    if (!status || status.scannerStatus !== "ready") {
      showNotice(
        {
          tone: "offline",
          title: status?.statusTitle ?? "Escaner no disponible",
          detail: status?.statusDetail ?? "Espera a que DinoCore habilite la jornada."
        },
        false
      );
      focusInput();
      return;
    }
    setManualOpen(true);
    setManualAction(null);
    setSelectedProduct(null);
    setManualError(null);
    setManualLoading(true);
    getManualProducts()
      .then((result) => {
        if (result.ok) {
          setManualProducts(result.products);
        } else {
          setManualProducts([]);
          setManualError(result.message);
        }
      })
      .catch(() => {
        setManualProducts([]);
        setManualError("No fue posible leer los modelos ajustables.");
      })
      .finally(() => setManualLoading(false));
  }

  function closeManualPanel() {
    setManualOpen(false);
    setManualAction(null);
    setSelectedProduct(null);
    setManualError(null);
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
              title: quantity > 0 ? "+1 par agregado manualmente" : "-1 par ajustado",
              detail: result.product
            },
            true
          );
          playTone(quantity > 0 ? "success" : "error");
          closeManualPanel();
          refresh();
        } else {
          setManualError(adjustmentErrorMessage(result.code, result.message));
          playTone("error");
        }
      })
      .catch(() => setManualError("Sin conexion. No se confirmo el ajuste."))
      .finally(() => {
        setManualBusy(false);
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
            disabled={busy || scannerState === "paused" || status?.scannerStatus !== "ready"}
            id="barcode"
            inputMode="none"
            onBlur={focusInput}
            onInput={handleInput}
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
          <button
            className="manual-button"
            disabled={!status || status.scannerStatus !== "ready"}
            onClick={openManualPanel}
            type="button"
            aria-label="Ajuste manual"
          >
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
              {manualLoading ? (
                <p className="empty-recent">Cargando modelos...</p>
              ) : manualError ? (
                <p className="manual-error">{manualError}</p>
              ) : manualProducts.length === 0 ? (
                <p className="empty-recent">
                  Aun no hay modelos registrados en esta jornada.
                  <br />
                  Escanea al menos un par para habilitar el ajuste manual.
                </p>
              ) : (
                manualProducts.map((product) => (
                  <button
                    className={selectedProduct && selectedProduct.productId === product.productId ? "selected-product" : ""}
                    disabled={manualAction === "remove" && !product.availableToRemove}
                    key={product.productId}
                    onClick={() => setSelectedProduct(product)}
                    type="button"
                  >
                    <strong>{product.product}</strong>
                    <span>Registrados hoy: {product.count} pares</span>
                  </button>
                ))
              )}
            </div>

            {manualAction && selectedProduct && (
              <div className={"manual-confirmation confirmation-" + manualAction}>
                <strong>{manualAction === "add" ? "Agregar 1 par" : "Quitar 1 par"}</strong>
                <span>{selectedProduct.product}</span>
                <p>
                  {manualAction === "add"
                    ? "Este movimiento se sumara a la jornada activa de " + (status?.bandName ?? "la banda") + "."
                    : "Este movimiento se descontara mediante la logica administrativa de produccion."}
                </p>
              </div>
            )}

            <div className="manual-actions">
              <button className="cancel-adjustment-button" onClick={closeManualPanel} type="button">
                Cancelar
              </button>
              <button
                className={"confirm-adjustment-button " + (manualAction === "remove" ? "confirm-remove" : "confirm-add")}
                disabled={!canConfirmAdjustment(manualAction, selectedProduct, manualBusy)}
                onClick={confirmAdjustment}
                type="button"
              >
                {manualBusy ? "Guardando..." : manualAction === "remove" ? "Confirmar -1" : "Confirmar +1"}
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default ScannerView;

// ========== FUNCIONES AUXILIARES (sin cambios) ==========

function logScanInput(status: "accepted" | "blocked_duplicate" | "blocked_invalid" | "blocked_not_ready", value: string, key: string) {
  console.info("[scanner-input]", {
    value,
    length: value.length,
    key,
    time: new Date().toISOString(),
    status
  });
}

function dotStatus(status: StationStatus | null, online: boolean) {
  if (!online) return "offline";
  if (!status || status.scannerStatus !== "ready") return "paused";
  return "active";
}

function labelShift(value: StationStatus["shiftStatus"]) {
  if (value === "active") return "Jornada activa";
  if (value === "closed") return "Sin jornada";
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

function scanErrorCopy(code: string, message: string) {
  if (code === "INVALID_SCAN_ID") {
    return { title: "No fue posible preparar el escaneo", detail: "Intenta nuevamente." };
  }
  if (code === "UNKNOWN_BARCODE" || code === "PRODUCT_NOT_FOUND") {
    return { title: "Codigo no reconocido", detail: "No se registro ningun par." };
  }
  if (code === "PRODUCT_INACTIVE") {
    return { title: "Producto inactivo", detail: "No se registro ningun par." };
  }
  if (code === "CATALOG_PERMISSION_DENIED") {
    return { title: "Catalogo no disponible", detail: "No se registro ningun par." };
  }
  if (code === "NO_ACTIVE_SHIFT" || code === "SHIFT_INACTIVE") {
    return { title: "No hay jornada activa", detail: "Espera a que DinoCore abra la jornada." };
  }
  if (code === "BREAK_TIME") {
    return { title: "Horario de descanso", detail: "El registro se reanudara al comenzar el siguiente bloque." };
  }
  if (code === "NO_ACTIVE_BLOCK" || code === "OUTSIDE_HOUR_BLOCK") {
    return { title: "Escaneo fuera del bloque productivo", detail: "No se registro ningun par." };
  }
  if (code === "OUTSIDE_SCHEDULE") {
    return { title: "Escaneo fuera del bloque productivo", detail: "No se registro ningun par." };
  }
  if (code === "SCAN_PERMISSION_DENIED") {
    return { title: "La estacion no tiene permiso para registrar", detail: "Contacta al administrador." };
  }
  if (code === "SCAN_RPC_NOT_FOUND" || code === "SCAN_RPC_SIGNATURE_MISMATCH") {
    return { title: "Registro no configurado", detail: "Contacta al administrador." };
  }
  if (code === "SCAN_CONSTRAINT_VIOLATION") {
    return { title: "La base rechazo el registro", detail: "Puedes reintentar sin duplicar el evento." };
  }
  if (code === "SCAN_CONFIRMATION_UNREADABLE" || code === "SCAN_WRITE_FAILED" || code === "SCAN_FAILED") {
    return { title: "No se pudo confirmar el registro", detail: "Puedes reintentar sin duplicar el evento." };
  }
  return { title: message, detail: "El registro no fue confirmado." };
}

function adjustmentErrorMessage(code: string, message: string) {
  if (code === "INVALID_ADJUSTMENT_ID") return "No fue posible preparar el ajuste. Intenta nuevamente.";
  if (code === "NO_ACTIVE_SHIFT" || code === "SHIFT_INACTIVE") return "No hay jornada activa.";
  if (code === "BREAK_TIME") return "Horario de descanso.";
  if (code === "NO_ACTIVE_BLOCK" || code === "OUTSIDE_HOUR_BLOCK") return "No existe un bloque habilitado para esta hora.";
  if (code === "OUTSIDE_SCHEDULE") return "Fuera del horario de produccion.";
  if (code === "REMOVE_NOT_AVAILABLE") return "No hay pares disponibles para quitar.";
  return message;
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