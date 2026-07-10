"use client"

import { useState, useTransition } from "react"
import { ArrowsClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { runCopecSyncAction } from "./copec-sync-action"

export function CopecSyncButton() {
  const [pending, startTransition] = useTransition()
  const [lastRun, setLastRun] = useState<string | null>(null)

  function sync() {
    startTransition(async () => {
      const result = await runCopecSyncAction()
      if (!result.ok) { toast.error(result.message); return }
      setLastRun(`${result.imported} registros importados${result.pending ? ` · ${result.pending} patentes pendientes` : ""}`)
      toast.success(`Copec sincronizado: ${result.imported} registros`)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" onClick={sync} disabled={pending}>
        <ArrowsClockwise className={`mr-2 h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Sincronizando Copec…" : "Sincronizar Copec ahora"}
      </Button>
      {lastRun && <span className="text-xs text-muted-foreground">{lastRun}</span>}
    </div>
  )
}
