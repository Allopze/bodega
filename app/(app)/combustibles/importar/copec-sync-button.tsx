"use client"

import { useState, useTransition } from "react"
import { ArrowsClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { getCopecSyncPlanAction, runCopecSyncPeriodAction } from "./copec-sync-action"

interface Progress {
  current: number
  total: number
  from: string
  to: string
}

export function CopecSyncButton() {
  const [pending, startTransition] = useTransition()
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)

  function sync() {
    startTransition(async () => {
      setLastRun(null)
      const plan = await getCopecSyncPlanAction()
      if (!plan.ok) { toast.error(plan.message); return }
      if (plan.periods.length === 0) {
        setLastRun("No hay períodos nuevos para sincronizar")
        return
      }

      let imported = 0
      let pendingPlates = 0
      const unavailable: string[] = []
      for (const [index, period] of plan.periods.entries()) {
        setProgress({ current: index + 1, total: plan.periods.length, ...period })
        const result = await runCopecSyncPeriodAction(period)
        if (!result.ok) {
          toast.error(`Período ${period.from} a ${period.to}: ${result.message}`)
          break
        }
        imported += result.imported
        pendingPlates = result.pending
        unavailable.push(...result.unavailable.map((cardType) => `${period.from} a ${period.to} (${cardType})`))
      }
      setProgress(null)
      setLastRun(`${imported} registros importados${pendingPlates ? ` · ${pendingPlates} patentes pendientes` : ""}${unavailable.length ? ` · ${unavailable.length} reportes sin archivo` : ""}`)
      if (unavailable.length) toast.warning(`${unavailable.length} reporte(s) de Copec no tenían archivo descargable`)
      else toast.success(`Copec sincronizado: ${imported} registros`)
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button type="button" variant="secondary" onClick={sync} disabled={pending}>
        <ArrowsClockwise className={`mr-2 h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Sincronizando Copec…" : "Sincronizar Copec ahora"}
      </Button>
      {progress && (
        <span className="text-xs text-muted-foreground" aria-live="polite">
          Período {progress.current} de {progress.total}: {progress.from} a {progress.to}
        </span>
      )}
      {lastRun && <span className="text-xs text-muted-foreground">{lastRun}</span>}
    </div>
  )
}
