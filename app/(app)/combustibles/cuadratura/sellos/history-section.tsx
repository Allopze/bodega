import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { SEAL_HISTORY_MAX_ROWS, type SealMovement } from "@/lib/combustibles/seal-history"
import { fuelEquipmentHref, fuelLoadHref } from "@/lib/combustibles/routes"
import type { PaginationState } from "@/lib/pagination"
import { formatQty } from "@/lib/utils"
import { plainChileDateTime } from "../_components/format"

/** Lo que dice la columna «Lo retiró después» de un movimiento: quién lo retiró, que sigue vigente o que nadie lo retiró. */
export type SealFollowUp =
  | { kind: "removed"; by: string; at: string }
  | { kind: "current" }
  | { kind: "missing" }
  | { kind: "none" }

/**
 * El último sello de cada equipo no es un problema: todavía no hay una carga
 * siguiente que lo retire, y se dice «Vigente». Sólo es «sin retiro posterior» si
 * el equipo volvió a cargar y esa carga no lo retiró.
 */
export function sealFollowUp(movement: Pick<SealMovement, "installedSeal" | "nextRemovedBy" | "nextRemovedAt" | "isLatestForEquipment" | "continuityBroken">): SealFollowUp {
  if (!movement.installedSeal) return { kind: "none" }
  if (movement.nextRemovedBy && movement.nextRemovedAt) return { kind: "removed", by: movement.nextRemovedBy, at: movement.nextRemovedAt }
  if (movement.isLatestForEquipment) return { kind: "current" }
  if (movement.continuityBroken) return { kind: "missing" }
  return { kind: "none" }
}

function FollowUp({ movement }: { movement: SealMovement }) {
  const followUp = sealFollowUp(movement)
  switch (followUp.kind) {
    case "removed": return <>{followUp.by} · {plainChileDateTime(followUp.at)}</>
    case "current": return <Badge variant="neutral" title="Es el último sello del equipo: todavía no hay una carga siguiente que lo retire.">Vigente</Badge>
    case "missing": return <Badge variant="warning" title="El equipo volvió a cargar y ninguna carga retiró este sello.">Sin retiro posterior</Badge>
    case "none": return <>—</>
  }
}

interface Props {
  rows: SealMovement[]
  total: number
  pagination: PaginationState
  hrefForPage: (page: number) => string
  clearHref: string
}

/** Historial de movimientos de sellos: cada carga validada que retiró o instaló un sello. */
export function SealHistorySection({ rows, total, pagination, hrefForPage, clearHref }: Props) {
  if (total === 0) {
    return (
      <EmptyState
        compact
        title="Sin movimientos de sello para estos filtros"
        description="Sólo aparecen las cargas ya validadas que retiraron o instalaron un sello. Prueba con otro período, faena, patente o número de sello."
        action={<Button asChild variant="secondary" size="sm"><Link href={clearHref}>Quitar filtros</Link></Button>}
      />
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-text-muted)]">
        {formatQty(total)} {total === 1 ? "movimiento" : "movimientos"}. Los sellos repetidos y los que ninguna carga retiró después se marcan en ámbar; el último sello de cada equipo figura como «Vigente».
        {/* Los avisos se calculan sobre las filas traídas: con el tope alcanzado el «siguiente» de un sello puede quedar fuera del corte. */}
        {total >= SEAL_HISTORY_MAX_ROWS ? ` Se alcanzó el tope de ${formatQty(SEAL_HISTORY_MAX_ROWS)} movimientos: acota el período o la faena para que los avisos de continuidad sean completos.` : ""}
      </p>
      <TableRoot aria-label="Historial de sellos de cargas de combustible">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead><TableHead>Faena</TableHead><TableHead>Punto de carga</TableHead><TableHead>Equipo</TableHead>
              <TableHead>Producto</TableHead><TableHead className="text-right">Litros</TableHead><TableHead>Sello retirado</TableHead><TableHead>Sello instalado</TableHead>
              <TableHead title="La carga que retiró el sello instalado en ésta">Lo retiró después</TableHead><TableHead>Carga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.submissionId}>
                <TableCell className="whitespace-nowrap font-mono text-xs">{plainChileDateTime(m.loadedAt)}</TableCell>
                <TableCell>{m.worksiteName ?? "—"}</TableCell>
                <TableCell className="text-xs">{m.loadingPointName ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">
                  {m.vehicleId ? <Link href={fuelEquipmentHref(m.vehicleId)} className="underline-offset-4 hover:underline">{m.equipmentCode}</Link> : m.equipmentCode}
                  {m.plate ? <span className="text-[var(--color-text-muted)]"> ({m.plate})</span> : null}
                </TableCell>
                <TableCell>{m.productName ?? "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatQty(m.liters)}</TableCell>
                <TableCell className="font-mono">{m.removedSeal ?? "—"}</TableCell>
                <TableCell className="font-mono">
                  {m.installedSeal ?? "—"}
                  {m.installedRepeated ? <Badge variant="warning" className="ml-1">repetido</Badge> : null}
                </TableCell>
                <TableCell className="text-xs"><FollowUp movement={m} /></TableCell>
                <TableCell><Link href={fuelLoadHref({ origen: "terreno", id: m.submissionId })} className="text-xs text-[var(--color-primary-ink)] hover:underline">Ver carga</Link></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
      </TableRoot>
    </div>
  )
}
