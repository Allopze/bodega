"use client"

import { useEffect } from "react"
import { GasPump, WifiSlash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ReportErrorButton } from "@/components/report-error-button"
import { reportBoundaryError } from "@/lib/observability/sentry-client"
import { isNetworkError } from "@/lib/network-error"

export default function CombustiblesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isNetwork = isNetworkError(error)

  useEffect(() => {
    console.error(error)
    reportBoundaryError(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <EmptyState
        as="h1"
        icon={isNetwork ? <WifiSlash size={24} /> : <GasPump size={24} />}
        title={isNetwork ? "Error de conexión" : "No se pudo cargar esta pantalla de combustible"}
        description={isNetwork
          ? "No se pudo conectar con el servidor. Verifica tu conexión a internet y que el servicio esté disponible, luego intenta nuevamente."
          : "Algo falló al leer los datos de combustible. Intenta de nuevo; si sigue pasando, reporta el error y dinos qué estabas mirando."
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
