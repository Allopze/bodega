import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader
        title="Nuevo programa preventivo"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Programas PDTP", href: "/prevencion/pdtp" }, { label: "Nuevo" }]} />}
      />

      {/* E: Skeleton con preview animado */}
      <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        {/* Stepper skeleton */}
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className="h-6 w-6 animate-pulse rounded-full bg-[var(--color-surface)]" />
                <div className="hidden h-3 w-16 animate-pulse rounded bg-[var(--color-surface)] sm:block" />
                {i < 3 && <div className="h-px w-6 animate-pulse bg-[var(--color-border)]" />}
              </div>
            ))}
          </div>
          <div className="mt-3 h-3 w-64 animate-pulse rounded bg-[var(--color-surface)]" />
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          {/* Year picker skeleton */}
          <div className="space-y-2">
            <div className="h-3 w-36 animate-pulse rounded bg-[var(--color-surface-2)]" />
            <div className="flex gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 w-20 animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-2)]" />
              ))}
            </div>
          </div>

          {/* Title skeleton */}
          <div className="space-y-2">
            <div className="h-3 w-28 animate-pulse rounded bg-[var(--color-surface-2)]" />
            <div className="h-9 w-full animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-2)]" />
          </div>

          {/* Source cards skeleton */}
          <div className="space-y-2">
            <div className="h-3 w-44 animate-pulse rounded bg-[var(--color-surface-2)]" />
            <div className="h-14 animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-2)]" />
            <div className="h-20 animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-2)]" />
            <div className="h-20 animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-2)]" />
          </div>

          {/* Actions skeleton */}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-5">
            <div className="h-8 w-20 animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-2)]" />
            <div className="h-8 w-32 animate-pulse rounded-[var(--radius)] bg-[var(--color-primary-tint)]" />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
