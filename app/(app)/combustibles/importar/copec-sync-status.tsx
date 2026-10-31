"use client"

import { useReducer, useTransition, useCallback, useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, PencilSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { toast } from "@/lib/toast"
import { reportBoundaryError } from "@/lib/observability/sentry-client"
import type { FuelSourceStatus } from "@/lib/combustibles/sources-status"
import { fuelInboxHref } from "@/lib/combustibles/routes"
import { SourceRow } from "../fuentes/source-row"
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

/** Los canales de Copec con el nombre que usa la plataforma (los valores viajan como TCT/TAE). */
const CHANNEL_LABEL = { TCT: "Tarjeta de equipos", TAE: "Abastecimiento de estanques" } as const

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

/**
 * La fila de Copec en «Fuentes de datos»: estado y «Actualizar ahora» a la
 * vista; cobertura por mes, mes sin movimientos y primer mes pendiente, en el
 * detalle técnico plegado. `source` es el estado resuelto por
 * `getFuelSourceStatuses`; `qualityExport` es el botón de exportar pendientes y
 * rechazos (sólo con permiso de exportar).
 */
export function CopecSyncStatus({ source, initialStatus, initialStartOptions, qualityExport }: {
  source: FuelSourceStatus
  initialStatus: CopecSyncStatus
  initialStartOptions: CopecSyncStartOptions
  qualityExport?: ReactNode
}) {
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

  const unlinkedHref = fuelInboxHref({ tipo: "patente" })

  const actions = (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={sync} disabled={buttonDisabled}>
        <ArrowsClockwise className={`mr-1.5 h-3.5 w-3.5 ${isActiveSync ? "animate-spin" : ""}`} aria-hidden />
        {isActiveSync ? "Actualizando…" : "Actualizar ahora"}
      </Button>
      {status.pending > 0 ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={unlinkedHref}>Ver patentes sin vincular</Link>
        </Button>
      ) : null}
      {status.lastRunStatus === "running" ? <p role="status" className="basis-full text-xs text-[var(--color-warning-ink)]">Copec mantiene una corrida abierta. Espera a que cierre antes de intentar otra sincronización.</p> : null}
      {progress ? (
        <div className="basis-full" role="status">
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
      ) : null}
      {result ? <p className="basis-full text-xs text-[var(--color-text-muted)]">{result}</p> : null}
    </>
  )

  return (
    <SourceRow source={source} status={source} actions={actions}>
      <p className="max-w-[75ch] text-xs text-[var(--color-text-muted)]">{status.source === "ws"
        ? "Cada corrida consulta los web services de Copec y trae el detalle de Diésel y de BlueMax, carga por carga. Incluye el mes en curso, que se recalcula en cada corrida. El abastecimiento de estanques se consulta en el mismo ciclo y sus recepciones quedan listas para cuadrar con el estanque."
        : "Cada corrida entra a Informes → Informes de Consumos, busca Diésel y BlueMax por separado y descarga el Detalle en Excel. Incluye el mes en curso, que se recalcula en cada corrida. El abastecimiento de estanques se consulta en el mismo ciclo y sus recepciones quedan listas para cuadrar con el estanque."}</p>

      {status.cursor ? <p className="text-xs text-[var(--color-text-muted)]">Próximo mes pendiente: {formatMonth(status.cursor)}.</p> : null}
      {/* Son FILAS de la última corrida, no patentes: antes decía «566 patente(s)» por 566 cargas de un mes ya fuera del plan. */}
      {status.pending > 0 ? <p className="text-xs text-[var(--color-warning-ink)]">{status.pending} carga(s) de {status.lastRunMonth ? formatMonth(status.lastRunMonth) : "la última corrida"} quedaron pendientes: su patente no está en la flota o no tiene asignación para ese mes. No se importan hasta resolverlo y volver a sincronizar ese mes.</p> : null}

      <div aria-label={`Cobertura Copec para ${formatMonth(status.coverageMonth)}`}>
        <p className="mb-2 text-xs font-medium text-[var(--color-text)]">Cobertura de {formatMonth(status.coverageMonth)}</p>
        <div className="grid grid-cols-1 gap-x-4 text-xs sm:grid-cols-2">
          {status.coverage.map((item) => (
            <div key={`${item.channel}:${item.product}`} className="flex min-w-0 items-center justify-between gap-2 border-b border-[var(--color-border)] py-2">
              <p className="font-medium text-[var(--color-text)]">{CHANNEL_LABEL[item.channel]} · {item.product === "diesel" ? "Diésel" : "BlueMax"}</p>
              <p className="shrink-0 text-[var(--color-text-muted)]">{COVERAGE_STATUS_LABEL[item.status]}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Solo “Completo” y “Vacío confirmado” cierran un producto y canal. Un mes sin archivo sigue desconocido hasta verificarlo.</p>
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium text-[var(--color-text)]">Confirmar un producto y canal sin movimientos</summary>
        <form onSubmit={confirmEmptyPeriod} className="mt-3 grid gap-3">
          <p className="text-xs text-[var(--color-text-muted)]">Disponible para meses cerrados. Registra qué verificaste en el portal; la confirmación queda asociada a tu usuario.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-[var(--color-text)]">Canal</label>
              <Select value={emptyConfirmation.channel} onValueChange={(value) => setEmptyConfirmation((current) => ({ ...current, channel: value as "TCT" | "TAE" }))}>
                <SelectTrigger aria-label="Canal de Copec"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="TCT">{CHANNEL_LABEL.TCT}</SelectItem><SelectItem value="TAE">{CHANNEL_LABEL.TAE}</SelectItem></SelectContent>
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-[var(--color-text-muted)]">Primer mes pendiente: <span className="font-medium text-[var(--color-text)]">{formatMonth(startOptions.currentStart)}</span></span>
        {!isEditingStart && (
          <Button type="button" variant="ghost" size="sm" onClick={() => dispatchView({ type: "patch", patch: { isEditingStart: true } })} disabled={isActiveSync}>
            <PencilSimple className="mr-1 h-3.5 w-3.5" aria-hidden />
            Ajustar mes
          </Button>
        )}
        {qualityExport}
      </div>

      {isEditingStart && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end">
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
    </SourceRow>
  )
}
