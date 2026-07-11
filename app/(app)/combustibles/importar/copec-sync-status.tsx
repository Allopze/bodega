"use client"

import { useState, useTransition, useEffect, useCallback, useRef } from "react"
import { ArrowsClockwise, CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import { getCopecSyncPlanAction, runCopecSyncPeriodAction, getCopecSyncStatusAction, type CopecSyncStatus } from "./copec-sync-action"

const STORAGE_KEY = "copec-sync-progress"

interface SavedProgress {
  current: number
  total: number
  from: string
  to: string
  startedAt: string
}

function loadProgress(): SavedProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as SavedProgress
    if (Date.now() - new Date(p.startedAt).getTime() > 1000 * 60 * 60) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return p
  } catch { return null }
}

export function CopecSyncStatus({ initialStatus }: { initialStatus: CopecSyncStatus }) {
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<CopecSyncStatus>(initialStatus)
  const [progress, setProgress] = useState<SavedProgress | null>(null)
  const [syncInProgress, setSyncInProgress] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const startedAtRef = useRef<string | null>(null)

  const sync = useCallback(() => {
    startTransition(async () => {
      setResult(null)
      setSyncInProgress(true)
      const startedAt = new Date().toISOString()
      startedAtRef.current = startedAt

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

      for (const [index, period] of plan.periods.entries()) {
        const sp: SavedProgress = { current: index + 1, total: plan.periods.length, from: period.from, to: period.to, startedAt }
        setProgress(sp)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sp))

        const r = await runCopecSyncPeriodAction(period)
        if (!r.ok) {
          toast.error(`Período ${period.from} a ${period.to}: ${r.message}`)
          break
        }
        imported += r.imported
        pendingPlates = r.pending
        unavailable.push(...r.unavailable.map((ct) => `${period.from} a ${period.to} (${ct})`))
      }

      localStorage.removeItem(STORAGE_KEY)
      setProgress(null)
      setSyncInProgress(false)
      startedAtRef.current = null
      setResult(`${imported} registros importados${pendingPlates ? ` · ${pendingPlates} patentes pendientes` : ""}${unavailable.length ? ` · ${unavailable.length} reportes sin archivo` : ""}`)

      const updated = await getCopecSyncStatusAction()
      if (updated.ok) setStatus(updated.data)

      if (unavailable.length) toast.warning(`${unavailable.length} reporte(s) de Copec sin archivo`)
      else toast.success(`Copec sincronizado: ${imported} registros`)
    })
  }, [])

  useEffect(() => {
    const saved = loadProgress()
    if (saved) {
      setProgress(saved)
    }
  }, [])

  const isActiveSync = syncInProgress || (pending && !progress)
  const buttonDisabled = isActiveSync

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <ArrowsClockwise className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-[var(--color-text)]">Sincronización Copec</span>
          </div>

          {status.lastRunAt ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-[var(--color-success)]" />
                Última: {formatDateTime(status.lastRunAt)}
              </span>
              {status.pending > 0 && (
                <span className="flex items-center gap-1 text-[var(--color-warning)]">
                  <WarningCircle className="h-3 w-3" />
                  {status.pending} patentes pendientes
                </span>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <XCircle className="h-3 w-3" />
              Nunca sincronizado
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {progress && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {progress.current}/{progress.total}
              </span>
            </div>
          )}
          {result && <span className="text-xs text-muted-foreground">{result}</span>}
          <Button type="button" variant="secondary" size="sm" onClick={sync} disabled={buttonDisabled}>
            <ArrowsClockwise className={`mr-1.5 h-3.5 w-3.5 ${isActiveSync ? "animate-spin" : ""}`} />
            {isActiveSync ? "Sincronizando…" : "Sincronizar ahora"}
          </Button>
        </div>
      </div>
    </div>
  )
}
