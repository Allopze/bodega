"use client"

import { useEffect } from "react"
import { CheckSquare } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ReportErrorButton } from "@/components/report-error-button"

export default function PendingWorkError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <EmptyState
        as="h1"
        icon={<CheckSquare size={24} />}
        title="No se pudo cargar la cola de pendientes"
        description="Intenta actualizar la vista. Si el problema continúa, reporta el error para revisar la fuente afectada."
        action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={reset}>Intentar de nuevo</Button><ReportErrorButton error={error} variant="secondary" /></div>}
      />
    </div>
  )
}
