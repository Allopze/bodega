"use client"

import { useEffect } from "react"
import { GasPump } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ReportErrorButton } from "@/components/report-error-button"

export default function CombustiblesError({
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
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <EmptyState
        as="h1"
        icon={<GasPump size={24} />}
        title="Error al cargar combustibles"
        description="No se pudieron cargar las cargas de combustible. Revisa la conexión e intenta nuevamente, o reporta el error."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reset}>
              Intentar de nuevo
            </Button>
            <ReportErrorButton error={error} variant="secondary" />
          </div>
        }
      />
    </div>
  )
}
