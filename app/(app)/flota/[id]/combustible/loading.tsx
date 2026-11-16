import { Skeleton } from "@/components/ui/skeleton"
import { VehicleFichaLoading } from "../_ficha/ficha-loading"

/** Esqueleto de la pestaña Combustible: la tira de cifras, el gráfico carga a carga con lo pendiente, y las últimas cargas. */
export default function Loading() {
  return (
    <VehicleFichaLoading>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
      </div>
      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-hidden>
        <Skeleton className="h-80 w-full" />
        <div className="grid gap-6">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      </div>
    </VehicleFichaLoading>
  )
}
