import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Cargas por equipo" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Consumo y rendimiento", href: "/combustibles" }, { label: "Cargas por equipo" }]} />
      <div className="mb-5 flex gap-2" aria-hidden>
        {[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} className="h-9 w-32" />)}
      </div>
      <div className="mb-6 flex flex-wrap gap-2.5" aria-hidden>
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-56" />
      </div>
      <Skeleton className="mb-10 h-24 w-full" aria-hidden />
      <div role="status" aria-label="Cargando control de combustible" className="space-y-8">
        <span className="sr-only">Cargando control de combustible</span>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </PageContainer>
  )
}
