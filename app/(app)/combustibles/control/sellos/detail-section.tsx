import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { LOADING_POINT_TYPE_LABELS, SEAL_CHAIN_STATUS_LABELS } from "@/lib/combustibles/control/contracts"
import type { SealDetailRow } from "@/lib/combustibles/control/queries/seals"
import type { PaginationState } from "@/lib/pagination"
import { formatDateTime } from "@/lib/utils"
import { litersText, numberText } from "./format"

const LOADED_AT_SOURCE_LABELS: Record<string, string> = {
  server: "Hora del servidor",
  device: "Hora del dispositivo",
  device_offline: "Hora del dispositivo (sin conexión)",
  import: "Hora de la planilla",
}

interface Props {
  rows: SealDetailRow[]
  pagination: PaginationState
  hrefForPage: (page: number) => string
  /** Solo con `combustibles:view_personal`: las fotos son datos personales. */
  canViewPhotos: boolean
}

export function DetailSection({ rows, pagination, hrefForPage, canViewPhotos }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No hay cargas en terreno con estos filtros. Prueba con otro mes, quita el equipo elegido o revisa el mandante.</p>
  }
  return (
    <TableRoot aria-label="Cargas en terreno por equipo">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha y hora</TableHead>
            <TableHead>Equipo</TableHead>
            <TableHead>Lugar de carga</TableHead>
            <TableHead>Medio</TableHead>
            <TableHead className="text-right">Litros</TableHead>
            <TableHead className="text-right" title="Lectura del odómetro (km) u horómetro (h)">Medidor</TableHead>
            <TableHead>Conductor</TableHead>
            <TableHead>Supervisor</TableHead>
            <TableHead>Sello retirado</TableHead>
            <TableHead>Sello nuevo</TableHead>
            <TableHead>Cadena de sellos</TableHead>
            <TableHead>Observaciones</TableHead>
            {canViewPhotos ? <TableHead>Fotos</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap">
                <span className="tabular-nums">{formatDateTime(row.loadedAt)}</span>
                <span className="block text-xs text-[var(--color-text-muted)]">{LOADED_AT_SOURCE_LABELS[row.loadedAtSource] ?? row.loadedAtSource}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="font-medium">{row.equipment}</span>
                {row.plate ? <span className="block text-xs text-[var(--color-text-muted)]">{row.plate}</span> : null}
              </TableCell>
              <TableCell>{row.loadingPointType ? LOADING_POINT_TYPE_LABELS[row.loadingPointType] : "—"}</TableCell>
              <TableCell>{row.mediumName ?? "—"}</TableCell>
              <TableCellNum>{litersText(row.liters)}</TableCellNum>
              <TableCellNum>{row.meterReading === null ? "—" : `${numberText(row.meterReading, 0)} ${row.meterType === "hour_meter" ? "h" : "km"}`}</TableCellNum>
              <TableCell>{row.driver}</TableCell>
              <TableCell>{row.supervisor}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.removedSeal?.trim() || "—"}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.installedSeal?.trim() || "—"}</TableCell>
              <TableCell className="min-w-44">
                {row.sealChainStatus === "mismatch"
                  ? <Badge variant="danger" className="whitespace-normal">Cadena rota</Badge>
                  : <span className="text-[var(--color-text-muted)]">{SEAL_CHAIN_STATUS_LABELS[row.sealChainStatus]}</span>}
                {row.sealChainStatus === "mismatch" && row.sealChainExpected ? <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Se esperaba el sello {row.sealChainExpected}</span> : null}
              </TableCell>
              <TableCell className="min-w-48 max-w-72 whitespace-normal text-[var(--color-text-muted)]">
                {row.noSealReason ? <span className="block">Sin sello: {row.noSealReason}</span> : null}
                {row.notes ? <span className="block">{row.notes}</span> : null}
                {!row.noSealReason && !row.notes ? "—" : null}
              </TableCell>
              {canViewPhotos ? (
                <TableCell className="whitespace-nowrap">
                  {row.evidenceCount > 0
                    ? <Link href={`/combustibles/tae/${row.id}#evidencia`} className="text-[var(--color-primary-ink)] underline-offset-4 hover:underline">Ver fotos</Link>
                    : <span className="text-[var(--color-text-muted)]">Sin fotos</span>}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ServerPagination pagination={pagination} hrefForPage={hrefForPage} />
    </TableRoot>
  )
}
