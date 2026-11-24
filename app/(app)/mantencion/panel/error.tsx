"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ReportErrorButton } from "@/components/report-error-button"
import { reportBoundaryError } from "@/lib/observability/sentry-client"

export default function MantencionPanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
    reportBoundaryError(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <EmptyState
        as="h1"
        title="No se pudo cargar el Panel de mantención"
        description="Intenta de nuevo o repórtalo al equipo."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reset}>
              Intentar de nuevo
            </Button>
            <ReportErrorButton error={error} variant="secondary" />
            <Button variant="ghost" asChild>
              <Link href="/mantencion/equipos">Ir a Equipos</Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}
