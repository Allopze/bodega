"use client"

import { useEffect } from "react"
import { BookOpen, WifiSlash } from "@phosphor-icons/react"
import { ReportErrorButton } from "@/components/report-error-button"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { isNetworkError } from "@/lib/network-error"

export default function BitacoraError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  const isNetwork = isNetworkError(error)
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <EmptyState
        as="h1"
        icon={isNetwork ? <WifiSlash size={24} /> : <BookOpen size={24} />}
        title={isNetwork ? "Error de conexión" : "Error al cargar la bitácora"}
        description={isNetwork
          ? "No se pudo conectar con el servidor. Verifica tu conexión a internet y que el servicio esté disponible."
          : "No se pudo consultar la bitácora general. Intenta nuevamente o reporta el error si persiste."
        }
        action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={unstable_retry}>Intentar de nuevo</Button><ReportErrorButton error={error} variant="secondary" /></div>}
      />
    </div>
  )
}
