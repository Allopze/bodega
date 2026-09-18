"use client"

import { useEffect } from "react"
import { ChartLineUp, WifiSlash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ReportErrorButton } from "@/components/report-error-button"
import { isNetworkError } from "@/lib/network-error"

export default function OperationalControlError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isNetwork = isNetworkError(error)

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <EmptyState
        as="h1"
        icon={isNetwork ? <WifiSlash size={24} /> : <ChartLineUp size={24} />}
        title={isNetwork ? "Error de conexión" : "Error al cargar el control operacional"}
        description={isNetwork
          ? "No se pudo conectar con el servidor. Verifica tu conexión a internet y que el servicio esté disponible, luego intenta nuevamente."
          : "No se pudieron cargar los indicadores y activos del control operacional. Revisa la conexión e intenta nuevamente, o reporta el error."
        }
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
