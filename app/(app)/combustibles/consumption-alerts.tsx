"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Warning } from "@phosphor-icons/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SeverityBadge, EmptyText } from "@/app/(app)/analitica/analytics-ranking-table"
import type { ConsumptionAlert } from "@/lib/combustibles/consumption-dashboard"
import { buildConsumptionHref } from "./consumption-url"

export function ConsumptionAlerts({ alerts }: { alerts: ConsumptionAlert[] }) {
  const searchParams = useSearchParams()

  function alertHref(linkQuery: string) {
    const target = new URLSearchParams(linkQuery)
    return buildConsumptionHref(
      searchParams.toString(),
      Object.fromEntries(target.entries()),
    )
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Alertas e interpretación</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {alerts.slice(0, 12).map((alert, index) => {
              const content = (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SeverityBadge severity={alert.severity} />
                      <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">{alert.entityLabel}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{alert.reason}</p>
                    </div>
                    <Warning size={17} className="mt-1 shrink-0 text-[var(--color-signal-ink)]" />
                  </div>
                  <p className="mt-2 text-xs font-medium text-[var(--color-text)]">{alert.action}</p>
                </div>
              )
              return alert.linkQuery ? (
                <Link key={`${alert.type}-${alert.entityLabel}-${index}`} href={alertHref(alert.linkQuery)} className="block rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
                  {content}
                </Link>
              ) : (
                <div key={`${alert.type}-${alert.entityLabel}-${index}`}>{content}</div>
              )
            })}
          </div>
        ) : (
          <EmptyText text="No hay alertas para los filtros actuales." />
        )}
      </CardContent>
    </Card>
  )
}
