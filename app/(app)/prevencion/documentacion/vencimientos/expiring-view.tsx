"use client"

import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

interface ExpiringItem {
  id: string
  title: string
  internalCode: string | null
  status: string
  expiresAt: string | null
  daysRemaining: number | null
  categorySlug: string
  worksiteId: string | null
  worksiteName: string | null
  responsibleUserId: string | null
  responsibleName: string | null
}

const STATUS_LABELS: Record<string, string> = {
  vigente: "Vigente",
  vencido: "Vencido",
}

const STATUS_TONES: Record<string, "default" | "info" | "success" | "warning" | "danger" | "outline"> = {
  vigente: "success",
  vencido: "danger",
}

function bucket(days: number | null) {
  if (days === null) return { label: "Sin fecha", tone: "outline" as const }
  if (days < 0) return { label: "Vencido", tone: "danger" as const }
  if (days <= 7) return { label: "≤ 7 días", tone: "danger" as const }
  if (days <= 15) return { label: "≤ 15 días", tone: "warning" as const }
  if (days <= 30) return { label: "≤ 30 días", tone: "warning" as const }
  if (days <= 60) return { label: "≤ 60 días", tone: "info" as const }
  if (days <= 90) return { label: "≤ 90 días", tone: "info" as const }
  return { label: `${days} días`, tone: "outline" as const }
}

export function ExpiringView({ documents }: { documents: ExpiringItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos con vencimiento</CardTitle>
        <p className="text-sm text-[var(--color-text-subtle)]">
          {documents.length} documento{documents.length === 1 ? "" : "s"} con fecha de vencimiento.
        </p>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState
            title="Sin vencimientos próximos"
            description="No hay documentos con fecha de vencimiento en los próximos 90 días."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Urgencia</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => {
                const b = bucket(d.daysRemaining)
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/prevencion/documentacion/${d.id}`} className="font-medium hover:underline">
                        {d.title}
                      </Link>
                      <p className="text-xs text-[var(--color-text-subtle)]">{d.internalCode ?? "—"}</p>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_TONES[d.status] ?? "default"}>{STATUS_LABELS[d.status] ?? d.status}</Badge></TableCell>
                    <TableCell className="text-xs">{d.categorySlug}</TableCell>
                    <TableCell className="text-xs">{d.worksiteName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{d.responsibleName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{d.expiresAt ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={b.tone}>{b.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "text-xs",
                        d.daysRemaining !== null && d.daysRemaining < 0 && "font-semibold text-[var(--color-danger)]",
                        d.daysRemaining !== null && d.daysRemaining >= 0 && d.daysRemaining <= 7 && "text-[var(--color-warning)]",
                      )}>
                        {d.daysRemaining === null ? "—" : `${d.daysRemaining} día${Math.abs(d.daysRemaining) === 1 ? "" : "s"}`}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
