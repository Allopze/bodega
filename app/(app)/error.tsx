"use client"

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
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={reset}>
            Intentar de nuevo
          </Button>
          <ReportErrorButton error={error} variant="secondary" />
        </div>
      }
    />
  )
}
