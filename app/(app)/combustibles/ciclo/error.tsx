"use client"

import { useEffect } from "react"
import { ArrowsClockwise } from "@phosphor-icons/react"
import { ReportErrorButton } from "@/components/report-error-button"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

export default function FuelCycleError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <EmptyState
        as="h1"
        icon={<ArrowsClockwise size={24} />}
        title="Error al cargar la conciliación"
        description="No se pudo consultar el ciclo físico. Intenta nuevamente o reporta el error si persiste."
        action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={unstable_retry}>Intentar de nuevo</Button><ReportErrorButton error={error} variant="secondary" /></div>}
      />
    </div>
  )
}
