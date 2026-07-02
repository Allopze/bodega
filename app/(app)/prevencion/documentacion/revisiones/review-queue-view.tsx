"use client"

import * as React from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface QueueItem {
  id: string
  title: string
  internalCode: string | null
  status: string
  categorySlug: string
  updatedAt: string
  worksiteName: string | null
  responsibleName: string | null
  uploaderName: string
}

const STATUS_TONES: Record<string, "default" | "info" | "success" | "warning" | "danger" | "outline"> = {
  borrador: "default",
  en_revision: "info",
  observado: "warning",
  aprobado: "info",
  vigente: "success",
  vencido: "danger",
  reemplazado: "outline",
  archivado: "outline",
}

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  observado: "Observado",
  aprobado: "Aprobado",
  vigente: "Vigente",
  vencido: "Vencido",
  reemplazado: "Reemplazado",
  archivado: "Archivado",
}

export function ReviewQueueView({ documents }: { documents: QueueItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pendientes</CardTitle>
        <p className="text-sm text-[var(--color-text-subtle)]">
          {documents.length} documento{documents.length === 1 ? "" : "s"} esperando decisión.
        </p>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState
            title="Bandeja vacía"
            description="No hay documentos esperando revisión. Buen trabajo."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Subido por</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Actualizado</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
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
                  <TableCell className="text-xs">{d.uploaderName}</TableCell>
                  <TableCell className="text-xs">{d.responsibleName ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.updatedAt.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Link href={`/prevencion/documentacion/${d.id}`} className="text-sm text-[var(--color-primary)] hover:underline">
                      Revisar
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
