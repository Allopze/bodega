"use client"

import { useReducer, useTransition, useCallback, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, CheckCircle, PencilSimple, WarningCircle, XCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { toast } from "@/lib/toast"
import { reportBoundaryError } from "@/lib/observability/sentry-client"
import { formatDateTime, formatQty } from "@/lib/utils"
import { confirmCopecPeriodEmptyAction, getCopecSyncProgressAction, getCopecSyncStatusAction, startCopecSyncAction, updateCopecSyncStartAction, type CopecSweepRunView, type CopecSyncStartOptions, type CopecSyncStatus } from "./copec-sync-action"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const MONTH_FORMATTER = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" })
const COVERAGE_STATUS_LABEL: Record<CopecSyncStatus["coverage"][number]["status"], string> = {
  unknown: "Desconocido",
  incomplete: "Incompleto",
  failed: "Fallido",
  complete: "Completo",
  legitimate_empty: "Vacío confirmado",
}

const STATUS_TIMEOUT_MS = 10_000
/** Cada cuánto se pregunta por el avance de una corrida en segundo plano. */
const PROGRESS_POLL_MS = 4_000
/**
 * Hasta cuándo se espera en pantalla. Una corrida recorre hasta cinco meses de
 * 1–2 minutos cada uno; pasado esto la corrida puede seguir, pero la pantalla
 * deja de esperar y lo dice.
 */
const PROGRESS_MAX_WAIT_MS = 15 * 60_000

async function withStatusDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Se agotó la espera del estado de Copec")), STATUS_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function getCopecStatusWithDeadline() {
  return withStatusDeadline(getCopecSyncStatusAction())
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface SyncProgress {
  /** Meses que la corrida planeaba recorrer al iniciarse. */
  planned: Array<{ from: string; to: string }>
  /** Meses ya cerrados por la corrida. */
  done: number
  /** Mes que está procesando ahora, si se sabe. */
  current: string | null
}

interface CopecSyncViewState {
  status: CopecSyncStatus
  startOptions: CopecSyncStartOptions
  selectedStart: string
  isEditingStart: boolean
  progress: SyncProgress | null
  syncInProgress: boolean
  result: string | null
}

type CopecSyncViewAction =
  | { type: "patch"; patch: Partial<CopecSyncViewState> }
  | { type: "set-cursor"; cursor: string }

function copecSyncViewReducer(state: CopecSyncViewState, action: CopecSyncViewAction): CopecSyncViewState {
  if (action.type === "set-cursor") return { ...state, status: { ...state.status, cursor: action.cursor } }
  return { ...state, ...action.patch }
}

function formatMonth(value: string) {
  return MONTH_FORMATTER.format(new Date(`${value}T00:00:00.000Z`))
}

/** Resumen de lo que dejó una corrida, mes por mes, con el motivo de cada observación. */
function summarizeSweep(runs: CopecSweepRunView[], stopReason: string | null): string {
  if (runs.length === 0) return stopReason ? `La sincronización de Copec no procesó ningún mes: ${stopReason}` : "No hubo meses que sincronizar."
  const total = (key: "rowsReceived" | "rowsAccepted" | "rowsRejected" | "rowsPending") => runs.reduce((sum, item) => sum + item[key], 0)
  const months = runs.map((item) => formatMonth(item.from)).join(", ")
  const observations = runs.filter((item) => item.error).map((item) => `${formatMonth(item.from)}: ${item.error}`)
  return [
    `Meses sincronizados: ${months}. ${total("rowsReceived")} filas recibidas · ${total("rowsAccepted")} aceptadas · ${total("rowsPending")} pendientes · ${total("rowsRejected")} rechazadas.`,
    ...observations,
    ...(stopReason ? [`Se detuvo: ${stopReason}`] : []),
  ].join(" ")
}

function firstDayOfMonth(value: string) {
  return value ? `${value.slice(0, 7)}-01` : value
}

export function CopecSyncStatus({ initialStatus, initialStartOptions }: { initialStatus: CopecSyncStatus; initialStartOptions: CopecSyncStartOptions }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [view, dispatchView] = useReducer(copecSyncViewReducer, {
    status: initialStatus,
    startOptions: initialStartOptions,
    selectedStart: initialStartOptions.currentStart,
    isEditingStart: false,
    progress: null,
    syncInProgress: false,
    result: null,
  })
  const [emptyConfirmation, setEmptyConfirmation] = useState<{
    channel: "TCT" | "TAE"
    product: "diesel" | "bluemax"
    evidence: string
  }>({ channel: "TCT", product: "diesel", evidence: "" })
  const { status, startOptions, selectedStart, isEditingStart, progress, syncInProgress, result } = view

  const sync = useCallback(() => {
    const run = async () => {
      dispatchView({ type: "patch", patch: { result: null, progress: null, syncInProgress: true } })

      // La acción sólo INICIA la corrida y vuelve: la corrida completa tarda
      // minutos, y detrás de Cloudflare una petición de más de ~100 s se corta.
      let started: Awaited<ReturnType<typeof startCopecSyncAction>>
      try {
        started = await startCopecSyncAction()
      } catch (error) {
        reportBoundaryError(error instanceof Error ? error : new Error("No fue posible iniciar la sincronización Copec"))
        const message = "No se pudo confirmar el inicio de la sincronización de Copec. Podría estar en curso; revisa su estado antes de volver a intentarlo."
        dispatchView({ type: "patch", patch: { result: message, syncInProgress: false } })
        toast.error(message)
        return
      }
      if (!started.ok) {
        dispatchView({ type: "patch", patch: { result: started.message, syncInProgress: false } })
        toast.error(started.message)
        return
      }
      dispatchView({ type: "patch", patch: { progress: { planned: started.periods, done: 0, current: started.periods[0]?.from ?? null } } })

      // Una consulta que falla no corta la espera: la corrida sigue en el
      // servidor aunque se pierda una respuesta.
      const deadline = Date.now() + PROGRESS_MAX_WAIT_MS
      let latest: Extract<Awaited<ReturnType<typeof getCopecSyncProgressAction>>, { ok: true }> | null = null
      while (Date.now() < deadline) {
        await wait(PROGRESS_POLL_MS)
        try {
          const response = await withStatusDeadline(getCopecSyncProgressAction({ since: started.since }))
          if (!response.ok) continue
          latest = response
          dispatchView({ type: "patch", patch: { progress: {
            planned: started.periods,
            done: response.runs.filter((item) => item.status !== "running").length,
            current: response.runs.find((item) => item.status === "running")?.from ?? null,
          } } })
          if (!response.running) break
        } catch (error) {
          reportBoundaryError(error instanceof Error ? error : new Error("No fue posible leer el avance de Copec"))
        }
      }

      const finished = latest && !latest.running ? latest : null
      const result = finished
        ? summarizeSweep(finished.runs, finished.outcome === "failed" ? finished.detail : null)
        : "La sincronización de Copec sigue en curso en el servidor. Revisa el estado en unos minutos; no hace falta volver a iniciarla."
      dispatchView({ type: "patch", patch: { progress: null, syncInProgress: false, result } })

      let statusRefreshFailed = false
      try {
        const updated = await getCopecStatusWithDeadline()
        if (updated.ok) dispatchView({ type: "patch", patch: { status: updated.data } })
        else statusRefreshFailed = true
      } catch (error) {
        reportBoundaryError(error instanceof Error ? error : new Error("No fue posible actualizar el estado de Copec"))
        statusRefreshFailed = true
      }
      if (statusRefreshFailed) {
        const statusWarning = "No se pudo actualizar el estado de Copec; recarga la página para revisarlo."
        dispatchView({ type: "patch", patch: { result: `${result} ${statusWarning}` } })
        toast.warning(statusWarning)
      }

      // `router.refresh()` AL FINAL, después de fijar el resultado en el estado
      // local: antes corría primero y el resumen dispatchado justo después se
      // perdía, porque hasta 2026-09-24 el refresh volvía a montar la
      // plataforma entera (AppShell exportado como objeto memo; ver
      // `confirmOperationsImportAction` en actions-operaciones.ts). Ya no
      // ocurre; el orden se conserva.
      router.refresh()

      if (!finished) toast.warning(result)
      else if (finished.outcome === "failed" || finished.runs.some((item) => item.status !== "success")) toast.warning("Copec sincronizado con observaciones: revisa el detalle de cada mes")
      else toast.success("Copec sincronizado")
    }

    startTransition(async () => {
      try {
        await run()
      } catch (error) {
        reportBoundaryError(error instanceof Error ? error : new Error("No fue posible completar la sincronización Copec"))
        const message = "No se pudo completar la sincronización de Copec. La corrida podría seguir en curso; revisa su estado antes de volver a intentarlo."
        dispatchView({ type: "patch", patch: { progress: null, syncInProgress: false, result: message } })
        toast.error(message)
      }
    })
  }, [router])

  const isActiveSync = syncInProgress || pending
  const buttonDisabled = isActiveSync

  const saveStartDate = useCallback(() => {
    startTransition(async () => {
      const response = await updateCopecSyncStartAction({
        startDate: selectedStart,
        expectedStart: startOptions.currentStart,
      })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      dispatchView({ type: "patch", patch: { startOptions: response.data, selectedStart: response.data.currentStart, isEditingStart: false, result: `La próxima sincronización comenzará el ${response.data.currentStart}.` } })
      dispatchView({ type: "set-cursor", cursor: response.data.currentStart })
      toast.success("Primer mes actualizado")
      router.refresh()
    })
  }, [router, selectedStart, startOptions.currentStart])

  const confirmEmptyPeriod = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    startTransition(async () => {
      const response = await confirmCopecPeriodEmptyAction({ month: status.coverageMonth, ...emptyConfirmation })
      if (!response.ok) {
        toast.error(response.message)
        return
      }
      dispatchView({ type: "patch", patch: { status: response.data } })
      setEmptyConfirmation((current) => ({ ...current, evidence: "" }))
      toast.success("Cobertura vacía registrada con evidencia")
      router.refresh()
    })
  }, [emptyConfirmation, router, status.coverageMonth])

  const selectedCoverage = status.coverage.find((item) => item.channel === emptyConfirmation.channel && item.product === emptyConfirmation.product)
  const canConfirmEmpty = selectedCoverage?.canConfirmEmpty ?? false

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" aria-label="Sincronización mensual Copec TCT y TAE">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ArrowsClockwise className="h-4 w-4 text-[var(--color-primary)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Copec TCT · detalle mensual automático</p>
              <p className="max-w-[75ch] text-xs text-[var(--color-text-muted)]">Cada corrida entra a Informes → Informes de Consumos, busca Diésel y BlueMax por separado y descarga el Detalle en Excel. Incluye el mes en curso, que se recalcula en cada corrida. TAE se consulta en el mismo ciclo y sus recepciones quedan conciliables con el estanque.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border border-[var(--color-border)] bg-[var(--color-border)] text-xs">
            <div className="bg-[var(--color-surface-2)] px-3 py-2"><span className="font-medium text-[var(--color-text)]">Diésel</span><span className="ml-1 text-[var(--color-text-muted)]">TCT</span></div>
            <div className="bg-[var(--color-surface-2)] px-3 py-2"><span className="font-medium text-[var(--color-text)]">BlueMax</span><span className="ml-1 text-[var(--color-text-muted)]">AdBlue</span></div>
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
              {status.lastRunAt ? <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <XCircle className="h-3.5 w-3.5" />}
              {status.lastRunAt ? `Última sincronización: ${formatDateTime(status.lastRunAt)}` : "Aún no se ha sincronizado"}
            </span>
            {status.cursor && (
              <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                <WarningCircle className="h-3.5 w-3.5 text-[var(--color-warning-ink)]" />
                Próximo mes pendiente: {formatMonth(status.cursor)}
              </span>
            )}
            {status.pending > 0 && <span className="text-[var(--color-warning-ink)]">{status.pending} patente(s) sin vehículo registrado: su consumo no se importa hasta que las registres en la flota y vuelvas a sincronizar su período</span>}
            {status.lastRunStatus && <span className="text-[var(--color-text-muted)]">Calidad última corrida: {status.rowsReceived} recibidas · {status.rowsAccepted} aceptadas · {status.rowsRejected} rechazadas · {status.rowsPending} pendientes · impacto {formatQty(status.affectedQuantity, undefined, { maximumFractionDigits: 2 })} L / ${formatQty(status.affectedAmount, undefined, { maximumFractionDigits: 2 })} ({status.lastRunStatus})</span>}
          </div>
          {status.lastRunStatus === "running" && <p role="status" className="text-xs text-[var(--color-warning-ink)]">Copec mantiene una corrida abierta. Espera a que cierre o revisa la bitácora de cron antes de intentar otra sincronización.</p>}

          <div className="border-t border-[var(--color-border)] pt-3" aria-label={`Cobertura Copec para ${formatMonth(status.coverageMonth)}`}>
            <p className="mb-2 text-xs font-medium text-[var(--color-text)]">Cobertura de {formatMonth(status.coverageMonth)}</p>
            <div className="grid grid-cols-2 gap-x-4 text-xs sm:grid-cols-4">
              {status.coverage.map((item) => (
                <div key={`${item.channel}:${item.product}`} className="flex min-w-0 items-center justify-between gap-2 border-b border-[var(--color-border)] py-2">
                  <p className="font-medium text-[var(--color-text)]">{item.channel} · {item.product === "diesel" ? "Diésel" : "BlueMax"}</p>
                  <p className="shrink-0 text-[var(--color-text-muted)]">{COVERAGE_STATUS_LABEL[item.status]}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">Solo “Completo” y “Vacío confirmado” cierran un producto y canal. Un mes sin archivo sigue desconocido hasta verificarlo.</p>
          </div>

          <details className="border-t border-[var(--color-border)] pt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--color-text)]">Confirmar un producto y canal sin movimientos</summary>
            <form onSubmit={confirmEmptyPeriod} className="mt-3 grid gap-3">
              <p className="text-xs text-[var(--color-text-muted)]">Disponible para meses cerrados. Registra qué verificaste en el portal; la confirmación queda asociada a tu usuario.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text)]">Canal</label>
                  <Select value={emptyConfirmation.channel} onValueChange={(value) => setEmptyConfirmation((current) => ({ ...current, channel: value as "TCT" | "TAE" }))}>
                    <SelectTrigger aria-label="Canal de Copec"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="TCT">TCT</SelectItem><SelectItem value="TAE">TAE</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-medium text-[var(--color-text)]">Producto</label>
                  <Select value={emptyConfirmation.product} onValueChange={(value) => setEmptyConfirmation((current) => ({ ...current, product: value as "diesel" | "bluemax" }))}>
                    <SelectTrigger aria-label="Producto Copec"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="diesel">Diésel</SelectItem><SelectItem value="bluemax">BlueMax</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea
                aria-label="Evidencia de período sin movimientos"
                value={emptyConfirmation.evidence}
                onChange={(event) => setEmptyConfirmation((current) => ({ ...current, evidence: event.target.value }))}
                placeholder="Describe el resultado que revisaste en Copec"
                rows={2}
              />
              <div>
                <Button type="submit" variant="secondary" size="sm" disabled={pending || !canConfirmEmpty || emptyConfirmation.evidence.trim().length < 20}>
                  {pending ? "Registrando…" : "Registrar período vacío"}
                </Button>
              </div>
            </form>
          </details>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-border)] pt-3 text-xs">
            <span className="text-[var(--color-text-muted)]">Primer mes pendiente: <span className="font-medium text-[var(--color-text)]">{formatMonth(startOptions.currentStart)}</span></span>
            {!isEditingStart && (
              <Button type="button" variant="ghost" size="sm" onClick={() => dispatchView({ type: "patch", patch: { isEditingStart: true } })} disabled={isActiveSync}>
                <PencilSimple className="mr-1 h-3.5 w-3.5" />
                Ajustar mes
              </Button>
            )}
          </div>

          {isEditingStart && (
            <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end">
              <div className="grid gap-1.5">
                <label htmlFor="copec-sync-start" className="text-xs font-medium text-[var(--color-text)]">Comenzar desde el mes</label>
                <DatePicker id="copec-sync-start" value={selectedStart} onChange={(value) => dispatchView({ type: "patch", patch: { selectedStart: firstDayOfMonth(value) } })} max={startOptions.maximumStart} disabled={isActiveSync} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={saveStartDate} disabled={isActiveSync || selectedStart > startOptions.maximumStart}>
                  {pending ? "Guardando…" : "Guardar mes"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => dispatchView({ type: "patch", patch: { selectedStart: startOptions.currentStart, isEditingStart: false } })} disabled={isActiveSync}>
                  Cancelar
                </Button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] sm:col-span-2">
                Se consulta un mes por vez, hasta el mes actual incluido. El mes en curso se recalcula en cada corrida; los meses cerrados también se comparan y sólo se reconstruyen si cambia su composición. Puedes retroceder para recuperar meses pendientes{startOptions.latestImportedUntil ? `: la última importación activa termina el ${startOptions.latestImportedUntil}, y las faenas que ya tengan una importación manual de esos meses se saltan para no duplicar consumo` : ""}.
              </p>
            </div>
          )}
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={sync} disabled={buttonDisabled} className="lg:mt-1">
          <ArrowsClockwise className={`mr-1.5 h-3.5 w-3.5 ${isActiveSync ? "animate-spin" : ""}`} />
          {isActiveSync ? "Sincronizando meses…" : "Sincronizar meses TCT"}
        </Button>
      </div>

      {progress && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3" role="status">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-[var(--color-text-muted)]">
            <span>
              {progress.current ? `Sincronizando ${formatMonth(progress.current)}` : "Preparando la sesión en Copec"}
              {progress.planned.length > 0 ? ` · ${Math.min(progress.done, progress.planned.length)} de ${progress.planned.length} mes(es) listos` : ""}
            </span>
            <span className="font-mono tabular-nums">{progress.planned.length ? Math.round((Math.min(progress.done, progress.planned.length) / progress.planned.length) * 100) : 0}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-300" style={{ width: `${progress.planned.length ? Math.round((Math.min(progress.done, progress.planned.length) / progress.planned.length) * 100) : 0}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">La corrida sigue en el servidor aunque cierres esta página.</p>
        </div>
      )}
      {result && <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">{result}</p>}
    </section>
  )
}
