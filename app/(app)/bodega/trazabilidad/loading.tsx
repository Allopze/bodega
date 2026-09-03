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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <SkeletonPage rows={10} />
      </div>
    </>
  )
}
