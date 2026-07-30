"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ReportErrorButton } from "@/components/report-error-button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <EmptyState
      as="h1"
      icon={<Warning size={24} />}
      title="Algo salió mal"
      description="Ocurrió un error inesperado. Intenta nuevamente o reporta el error para que el equipo lo revise."
      action={
        /* Con sólo "Intentar de nuevo" y "Reportar", un error que persiste deja al
           usuario encerrado: `reset()` vuelve a fallar y no hay por dónde salir.
           El enlace al inicio es la vía de escape (auditoría UI/UX 2026-07-29). */
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={reset}>
            Intentar de nuevo
          </Button>
          <ReportErrorButton error={error} variant="secondary" />
          <Button variant="ghost" asChild>
            <Link href="/dashboard">Volver al inicio</Link>
          </Button>
        </div>
      }
    />
  )
}
