import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Análisis de rendimiento por equipo"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Análisis de rendimiento" }]} />}
      />
      {/* Preset tabs skeleton */}
      <div className="mb-4 flex flex-wrap gap-2 pb-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-44 animate-pulse rounded bg-(--color-surface-2)" />
        ))}
      </div>

      {/* Filter bar skeleton */}
      <div className="mb-4 grid gap-3 pb-4 md:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-(--color-surface-2)" />
        ))}
      </div>

      {/* Chart cards skeleton */}
      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded border border-(--color-border) bg-(--color-surface)" />
        ))}
      </div>

      {/* Histogram skeleton */}
      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded border border-(--color-border) bg-(--color-surface)" />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-(--color-surface-2)" />
        ))}
      </div>
    </>
  )
}
