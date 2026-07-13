"use client"

import { useState, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, CheckCircle, PencilSimple, WarningCircle, XCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { getCopecSyncPlanAction, runCopecSyncPeriodAction, getCopecSyncStatusAction, updateCopecSyncStartAction, type CopecSyncStartOptions, type CopecSyncStatus } from "./copec-sync-action"

const MONTH_FORMATTER = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" })

interface SyncProgress {
  current: number
  total: number
  from: string
  to: string
}

function formatMonth(value: string) {
  return MONTH_FORMATTER.format(new Date(`${value}T00:00:00.000Z`))
}

function firstDayOfMonth(value: string) {
  return value ? `${value.slice(0, 7)}-01` : value
}

export function CopecSyncStatus({ initialStatus, initialStartOptions }: { initialStatus: CopecSyncStatus; initialStartOptions: CopecSyncStartOptions }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<CopecSyncStatus>(initialStatus)
  const [startOptions, setStartOptions] = useState<CopecSyncStartOptions>(initialStartOptions)
  const [selectedStart, setSelectedStart] = useState(initialStartOptions.currentStart)
  const [isEditingStart, setIsEditingStart] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [syncInProgress, setSyncInProgress] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const sync = useCallback(() => {
    startTransition(async () => {
      setResult(null)
      setSyncInProgress(true)

      const plan = await getCopecSyncPlanAction()
      if (!plan.ok) { toast.error(plan.message); setSyncInProgress(false); return }
      if (plan.periods.length === 0) {
        setResult("No hay meses cerrados nuevos para sincronizar")
        setSyncInProgress(false)
        return
      }

      let imported = 0
      let pendingPlates = 0
      const unavailable: string[] = []
      let stoppedAt: SyncProgress | null = null

      for (const [index, period] of plan.periods.entries()) {
        const sp: SyncProgress = { current: index + 1, total: plan.periods.length, from: period.from, to: period.to }
        setProgress(sp)

        const r = await runCopecSyncPeriodAction(period)
        if (!r.ok) {
          toast.error(`${formatMonth(period.from)}: ${r.message}`)
          stoppedAt = sp
          break
        }
        imported += r.imported
        pendingPlates = r.pending
        unavailable.push(...r.unavailable.map((product) => `${formatMonth(period.from)} (${product})`))
        // Sin ninguna descarga = portal/credenciales rotos. Se detiene y avisa en
        // lugar de seguir barriendo el histórico sin traer nada.
        if (r.reports === 0) {
          toast.error(`Copec no entregó detalles para ${formatMonth(period.from)}. Revisa el portal, las credenciales o el primer mes configurado.`)
          stoppedAt = sp
          break
        }
      }

      setProgress(null)
      setSyncInProgress(false)

      const updated = await getCopecSyncStatusAction()
      if (updated.ok) setStatus(updated.data)
      router.refresh()

      if (stoppedAt) {
        setResult(`Se importaron ${imported} registros antes de detenerse. Reintenta desde ${formatMonth(stoppedAt.from)}.`)
        return
      }

      setResult(`${imported} registros importados${pendingPlates ? ` · ${pendingPlates} patentes pendientes` : ""}${unavailable.length ? ` · ${unavailable.length} reportes sin archivo` : ""}`)

      if (unavailable.length) toast.warning(`${unavailable.length} reporte(s) de Copec sin archivo`)
      else toast.success(`Copec sincronizado: ${imported} registros`)
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

      setStartOptions(response.data)
      setSelectedStart(response.data.currentStart)
      setStatus((current) => ({ ...current, cursor: response.data.currentStart }))
      setIsEditingStart(false)
      setResult(`La próxima sincronización comenzará el ${response.data.currentStart}.`)
      toast.success("Primer mes actualizado")
      router.refresh()
    })
  }, [router, selectedStart, startOptions.currentStart])

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" aria-label="Sincronización mensual Copec TCT">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ArrowsClockwise className="h-4 w-4 text-[var(--color-primary)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Copec TCT · detalle mensual automático</p>
              <p className="max-w-[75ch] text-xs text-muted-foreground">Cada corrida entra a Informes → Informes de Consumos, consulta un mes cerrado, busca Diésel y BlueMax por separado y descarga el Detalle en Excel. TAE se registra en el nuevo control manual.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border border-[var(--color-border)] bg-[var(--color-border)] text-xs">
            <div className="bg-[var(--color-surface-2)] px-3 py-2"><span className="font-medium text-[var(--color-text)]">Diésel</span><span className="ml-1 text-muted-foreground">TCT</span></div>
            <div className="bg-[var(--color-surface-2)] px-3 py-2"><span className="font-medium text-[var(--color-text)]">BlueMax</span><span className="ml-1 text-muted-foreground">AdBlue</span></div>
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {status.lastRunAt ? <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <XCircle className="h-3.5 w-3.5" />}
              {status.lastRunAt ? `Última sincronización: ${formatDateTime(status.lastRunAt)}` : "Aún no se ha sincronizado"}
            </span>
            {status.cursor && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <WarningCircle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
                Próximo mes pendiente: {formatMonth(status.cursor)}
              </span>
            )}
            {status.pending > 0 && <span className="text-[var(--color-warning)]">{status.pending} patente(s) sin vehículo registrado — su consumo no se importa hasta que las registres en la flota y vuelvas a sincronizar su período</span>}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-border)] pt-3 text-xs">
            <span className="text-muted-foreground">Primer mes pendiente: <span className="font-medium text-[var(--color-text)]">{formatMonth(startOptions.currentStart)}</span></span>
            {!isEditingStart && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditingStart(true)} disabled={isActiveSync || startOptions.minimumStart > startOptions.maximumStart}>
                <PencilSimple className="mr-1 h-3.5 w-3.5" />
                Ajustar mes
              </Button>
            )}
          </div>

          {isEditingStart && (
            <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end">
              <div className="grid gap-1.5">
                <label htmlFor="copec-sync-start" className="text-xs font-medium text-[var(--color-text)]">Comenzar desde el mes</label>
                <DatePicker id="copec-sync-start" value={selectedStart} onChange={(value) => setSelectedStart(firstDayOfMonth(value))} min={startOptions.minimumStart} max={startOptions.maximumStart} disabled={isActiveSync} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={saveStartDate} disabled={isActiveSync || selectedStart < startOptions.minimumStart || selectedStart > startOptions.maximumStart}>
                  {pending ? "Guardando…" : "Guardar mes"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedStart(startOptions.currentStart); setIsEditingStart(false) }} disabled={isActiveSync}>
                  Cancelar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Se consulta un mes completo por vez. Disponible desde {formatMonth(startOptions.minimumStart)} hasta el mes actual; solo los meses ya cerrados se descargan. No se superpone con importaciones activas{startOptions.latestImportedUntil ? `, la última termina el ${startOptions.latestImportedUntil}` : ""}.
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
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Mes {progress.current} de {progress.total}: {formatMonth(progress.from)}</span>
            <span className="font-mono tabular-nums">{Math.round((progress.current / progress.total) * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-300" style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} />
          </div>
        </div>
      )}
      {result && <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-muted-foreground">{result}</p>}
    </section>
  )
}
