import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, Info } from "@phosphor-icons/react/dist/ssr"
import { Card, CardContent } from "@/components/ui/card"

export function KpiCard({
  icon,
  label,
  value,
  detail,
  trend,
  tone = "neutral",
  glossary,
  href,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  trend?: number | null
  tone?: "neutral" | "signal"
  glossary?: string
  href?: string
}) {
  const card = (
    <Card className={tone === "signal" ? "ring-1 ring-[var(--color-signal-line)]" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
            {icon}
          </span>
          {typeof trend === "number" && (
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${trend >= 0 ? "text-[var(--color-signal-ink)]" : "text-[var(--color-success)]"}`}>
              {trend >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {Math.abs(trend)}%
            </span>
          )}
          {glossary && (
            <span className="group relative">
              <Info size={14} className="text-[var(--color-text-subtle)] cursor-help" />
              <span className="pointer-events-none absolute bottom-full right-0 mb-1 w-56 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-5 text-[var(--color-text-muted)] shadow-[var(--shadow-card)] opacity-0 group-hover:opacity-100 transition-opacity z-10">
                {glossary}
              </span>
            </span>
          )}
        </div>
        <p className="mt-4 text-xs font-medium uppercase text-[var(--color-text-subtle)]">{label}</p>
        <p className="mt-1 truncate text-xl font-semibold tracking-normal text-[var(--color-text)]">{value}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{detail}</p>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href} className="block h-full">{card}</Link> : card
}
