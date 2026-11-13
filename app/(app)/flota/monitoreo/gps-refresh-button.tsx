"use client"

import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import { runOnwaySyncAction, runWialonSyncAction } from "./actions"

/**
 * «Actualizar ahora» de la cabecera: consulta a la vez las fuentes que están
 * configuradas. La configuración de cada una vive sólo en la pestaña
 * «Configuración»; antes la cabecera repetía sus dos botones «Configurar» y
 * «Actualizar ahora» por proveedor (auditoría 2026-11-13, F7).
 */
export function GpsRefreshButton({ onway, wialon }: { onway: boolean; wialon: boolean }) {
  const router = useRouter()
  const sync = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  if (!onway && !wialon) return null
  return (
    <Button
      type="button"
      size="sm"
      loading={sync.pending}
      onClick={() => sync.run(async () => {
        const results = []
        if (onway) results.push(await runOnwaySyncAction())
        if (wialon) results.push(await runWialonSyncAction())
        const failed = results.filter((result) => !result.ok)
        if (failed.length > 0) return { ok: false, message: failed.map((result) => result.message).filter(Boolean).join(" ") }
        return { ok: true, message: results.map((result) => result.message).filter(Boolean).join(" ") }
      })}
    >
      <ArrowClockwise size={14} aria-hidden />
      Actualizar ahora
    </Button>
  )
}
