import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Trazabilidad y Seguimiento por Faena"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Bodega", href: "/bodega" },
              { label: "Trazabilidad" },
            ]}
          />
        }
      />
      <div className="space-y-4">
        {/* Los KPIs son 4 accionables desde la migración (A1/UI-01): el skeleton
            tiene que dibujar 4 bloques, no los 7 de la matriz vieja, o la grilla
            salta de 7 a 4 al llegar los datos. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        {/* Fila secundaria compacta de los KPIs informativos. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
          ))}
        </div>
        <SkeletonPage rows={10} />
      </div>
    </>
  )
}
