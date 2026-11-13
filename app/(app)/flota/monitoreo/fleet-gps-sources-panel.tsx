"use client"

import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateTime } from "@/lib/utils"
import type { SourceStatusRow } from "./fleet-gps-source-status"

/**
 * «Estado de las fuentes»: una fila por proveedor con su insignia, lo que pasó
 * en lenguaje de usuario y su acción. Sustituye a los avisos apilados (atraso,
 * falla, parcial, sin vincular) de Monitoreo; el código técnico de una falla,
 * si hay, queda en un `<details>` para quien administra.
 */
export function FleetGpsSourcesPanel({ rows, onOpenSettings }: {
  rows: SourceStatusRow[]
  /** Abre la pestaña «Configuración»; sin ella (quien no administra) no hay acciones de ese tipo. */
  onOpenSettings?: () => void
}) {
  if (rows.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" id="estado-fuentes-gps" className="text-base">Estado de las fuentes</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-[var(--color-border)]">
        {rows.map((row) => (
          <li key={row.provider} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-6 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[var(--color-text)]">{row.name}</p>
                <MetaBadge meta={{ label: row.badge, variant: row.tone }} dot />
                {row.latestAt ? (
                  <span className="text-xs text-[var(--color-text-subtle)]">
                    Última posición <span className="tabular-nums">{formatDateTime(row.latestAt)}</span>
                  </span>
                ) : null}
              </div>
              {row.messages.map((message) => (
                <p key={message} className="text-sm text-[var(--color-text-muted)]">{message}</p>
              ))}
              {row.technicalDetail ? (
                <details className="text-xs text-[var(--color-text-subtle)]">
                  <summary className="cursor-pointer">Detalle técnico</summary>
                  <p className="mt-1 font-mono">{row.technicalDetail}</p>
                </details>
              ) : null}
            </div>
            {row.actions.length > 0 ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {row.actions.map((action) => action.kind === "link" && action.href ? (
                  <Button key={action.label} asChild variant="secondary" size="sm">
                    <Link href={action.href}>{action.label}</Link>
                  </Button>
                ) : onOpenSettings ? (
                  <Button key={action.label} type="button" variant="secondary" size="sm" onClick={onOpenSettings}>
                    {action.label}
                  </Button>
                ) : null)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
