import { Skeleton } from "@/components/ui/skeleton"
import { VehicleFichaLoading } from "./_ficha/ficha-loading"

/** Esqueleto del Resumen: la tarjeta con sus cuatro líneas. */
export default function Loading() {
  return (
    <VehicleFichaLoading>
      <div className="rounded-2xl border border-[var(--color-border)] p-6" aria-hidden>
        <Skeleton className="mb-5 h-5 w-48" />
        <div className="grid gap-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
        </div>
      </div>
    </VehicleFichaLoading>
  )
}
