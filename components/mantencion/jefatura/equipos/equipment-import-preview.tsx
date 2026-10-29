import { MetaBadge } from "@/components/states/state-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { plural } from "@/lib/mantencion/format"
import type { ImportPreview, ImportRowKind } from "@/lib/services/mantencion/equipment-import"

const KIND: Record<ImportRowKind, { label: string; variant: "success" | "info" | "warning" | "neutral" | "danger" }> = {
  create: { label: "Nuevo", variant: "success" },
  incorporate: { label: "Se incorpora", variant: "info" },
  update: { label: "Se actualiza", variant: "warning" },
  unchanged: { label: "Sin cambios", variant: "neutral" },
  error: { label: "Con error", variant: "danger" },
}

/** Resumen de una importación, antes (vista previa) o después (resultado) de confirmarla. */
export function ImportSummaryLine({ summary, written }: { summary: ImportPreview["summary"]; written: boolean }) {
  const parts = [
    summary.created ? plural(summary.created, written ? "equipo creado" : "equipo nuevo", written ? "equipos creados" : "equipos nuevos") : "",
    summary.incorporated ? `${summary.incorporated} ${written ? "incorporados" : "por incorporar"} desde la flota` : "",
    summary.updated ? plural(summary.updated, written ? "actualizado" : "por actualizar", written ? "actualizados" : "por actualizar") : "",
    summary.unchanged ? `${summary.unchanged} sin cambios` : "",
    summary.errors ? plural(summary.errors, "fila con error", "filas con error") : "",
  ].filter(Boolean)
  return <p className="text-sm text-[var(--color-text)]">{parts.length ? parts.join(" · ") : "La planilla no trae filas."}</p>
}

/**
 * Vista previa fila por fila: qué se crearía, qué cambiaría en un equipo
 * existente y qué filas traen error con su motivo. Las filas «sin cambios» se
 * cuentan pero no se listan: no hay nada que decidir sobre ellas.
 */
export function ImportPreviewTable({ rows }: { rows: ImportPreview["rows"] }) {
  const listed = rows.filter((row) => row.kind !== "unchanged")
  if (listed.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">Ninguna fila cambia nada: la planilla ya está al día con la plataforma.</p>
  return (
    <TableRoot aria-label="Vista previa de la importación">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Fila</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Qué pasa</TableHead>
            <TableHead>Detalle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listed.map((row) => (
            <TableRow key={row.row} className={row.kind === "error" ? "bg-[var(--color-danger-tint)]/50" : undefined}>
              <TableCell className="font-mono text-xs tabular-nums">{row.row}</TableCell>
              <TableCell className="font-mono text-[13px] font-semibold">{row.code || "—"}</TableCell>
              <TableCell><MetaBadge meta={KIND[row.kind]} size="sm" /></TableCell>
              <TableCell className="text-sm">
                {row.kind === "error" ? (
                  <ul className="list-inside list-disc text-[var(--color-danger-ink)]">
                    {row.messages.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                ) : row.kind === "update" ? (
                  <ul className="text-[var(--color-text-muted)]">{row.messages.map((message) => <li key={message}>{message}</li>)}</ul>
                ) : <span className="text-[var(--color-text-muted)]">{row.label}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
