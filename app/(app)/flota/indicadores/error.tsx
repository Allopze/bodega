"use client"

import Link from "next/link"
import { useEffect } from "react"
import { ChartBar } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ReportErrorButton } from "@/components/report-error-button"
import { reportBoundaryError } from "@/lib/observability/sentry-client"

export default function GpsIndicatorsError({
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
        icon={<ChartBar size={24} />}
        title="No se pudieron cargar los indicadores GPS"
        description="Ocurrió un error al armar los gráficos del período. Intenta nuevamente o reporta el error para que el equipo lo revise."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reset}>
              Intentar de nuevo
            </Button>
            <ReportErrorButton error={error} variant="secondary" />
            <Button variant="ghost" asChild>
              <Link href="/flota/monitoreo">Ir a Monitoreo GPS</Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}
