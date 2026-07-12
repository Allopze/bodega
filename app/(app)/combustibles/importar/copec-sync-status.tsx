"use client"

import { useState, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, CheckCircle, PencilSimple, WarningCircle, XCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { getCopecSyncPlanAction, runCopecSyncPeriodAction, getCopecSyncStatusAction, updateCopecSyncStartAction, type CopecSyncStartOptions, type CopecSyncStatus } from "./copec-sync-action"

interface SyncProgress {
  current: number
  total: number
  from: string
  to: string
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
        setResult("No hay períodos nuevos para sincronizar")
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
          toast.error(`Período ${period.from} a ${period.to}: ${r.message}`)
          stoppedAt = sp
          break
        }
        imported += r.imported
        pendingPlates = r.pending
        unavailable.push(...r.unavailable.map((ct) => `${period.from} a ${period.to} (${ct})`))
      }

      setProgress(null)
      setSyncInProgress(false)

      const updated = await getCopecSyncStatusAction()
      if (updated.ok) setStatus(updated.data)
      router.refresh()

      if (stoppedAt) {
        setResult(`Se importaron ${imported} registros antes de detenerse. Reintenta desde ${stoppedAt.from} a ${stoppedAt.to}.`)
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
      toast.success("Fecha de inicio actualizada")
      router.refresh()
    })
  }, [router, selectedStart, startOptions.currentStart])

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4" aria-label="Desde Copec (automático)">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ArrowsClockwise className="h-4 w-4 text-[var(--color-primary)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Desde Copec (automático)</p>
              <p className="text-xs text-muted-foreground">Se sincroniza sola todas las noches: entra al portal de Copec, descarga TCT y TAE, y asigna cada patente a su faena. &ldquo;Sincronizar ahora&rdquo; adelanta esa corrida y trae los consumos nuevos desde la última vez.</p>
            </div>
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {status.lastRunAt ? <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <XCircle className="h-3.5 w-3.5" />}
              {status.lastRunAt ? `Última sincronización: ${formatDateTime(status.lastRunAt)}` : "Aún no se ha sincronizado"}
            </span>
            {status.cursor && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <WarningCircle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
                Faltan por traer los consumos desde {status.cursor} hasta ayer
              </span>
            )}
            {status.pending > 0 && <span className="text-[var(--color-warning)]">{status.pending} patente(s) sin vehículo registrado — se importarán solas cuando las vincules</span>}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-border)] pt-3 text-xs">
            <span className="text-muted-foreground">Próximo inicio: <span className="font-mono text-[var(--color-text)]">{startOptions.currentStart}</span></span>
            {!isEditingStart && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditingStart(true)} disabled={isActiveSync || startOptions.minimumStart > startOptions.maximumStart}>
                <PencilSimple className="mr-1 h-3.5 w-3.5" />
                Ajustar fecha
              </Button>
            )}
          </div>

          {isEditingStart && (
            <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end">
              <div className="grid gap-1.5">
                <label htmlFor="copec-sync-start" className="text-xs font-medium text-[var(--color-text)]">Comenzar importación desde</label>
                <DatePicker id="copec-sync-start" value={selectedStart} onChange={setSelectedStart} min={startOptions.minimumStart} max={startOptions.maximumStart} disabled={isActiveSync} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={saveStartDate} disabled={isActiveSync || selectedStart < startOptions.minimumStart || selectedStart > startOptions.maximumStart}>
                  {pending ? "Guardando…" : "Guardar fecha"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedStart(startOptions.currentStart); setIsEditingStart(false) }} disabled={isActiveSync}>
                  Cancelar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Disponible desde {startOptions.minimumStart} hasta hoy. No se permiten períodos que se superpongan con importaciones activas{startOptions.latestImportedUntil ? `, la última termina el ${startOptions.latestImportedUntil}` : ""}. Esta opción no elimina consumos ya importados.
              </p>
            </div>
          )}
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={sync} disabled={buttonDisabled} className="lg:mt-1">
          <ArrowsClockwise className={`mr-1.5 h-3.5 w-3.5 ${isActiveSync ? "animate-spin" : ""}`} />
          {isActiveSync ? "Sincronizando…" : "Sincronizar ahora"}
        </Button>
      </div>

      {progress && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Período {progress.current} de {progress.total}: {progress.from} a {progress.to}</span>
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
