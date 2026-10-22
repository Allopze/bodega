import Link from "next/link"
import { buildPaginationHref } from "@/lib/pagination"
import { cn } from "@/lib/utils"
import { REVIEW_TABS, type ReviewTabValue } from "@/lib/combustibles/control/review-queue"

type SearchParams = Record<string, string | string[] | undefined>

/**
 * Pestañas por estado de revisión. Son `<Link>` (navegan sin esperar
 * hidratación) y reinician la página (`pagina`), a diferencia de `StageTabs`,
 * que solo limpia `page`. Regla A5: el estado se representa una sola vez.
 */
export function ReviewTabs({
  active,
  counts,
  searchParams,
}: {
  active: ReviewTabValue
  counts: Record<ReviewTabValue, number>
  searchParams: SearchParams
}) {
  return (
    <nav aria-label="Estado de revisión" className="-mx-1 mb-4 flex items-end overflow-x-auto border-b border-[var(--color-border)] px-1">
      {REVIEW_TABS.map((tab) => {
        const isActive = tab.value === active
        const params = { ...searchParams, estado: tab.value === "en-revision" ? undefined : tab.value }
        return (
          <Link
            key={tab.value}
            href={buildPaginationHref("/combustibles/control/revision", params, 1, "pagina")}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-sm font-medium",
              "transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
              isActive
                ? "border-[var(--color-text)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
            )}
          >
            {tab.label}
            <span className={cn(
              "text-xs tabular-nums",
              tab.value === "en-revision" && counts[tab.value] > 0
                ? "rounded-full bg-[var(--color-signal-tint)] px-1.5 font-semibold text-[var(--color-signal-ink)]"
                : "text-[var(--color-text-faint)]",
            )}>
              {counts[tab.value]}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
