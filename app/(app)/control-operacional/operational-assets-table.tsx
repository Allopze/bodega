"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatCLP } from "@/lib/utils"
import type { OperationalAsset } from "@/lib/services/operational-control"

export function OperationalAssetsTable({ assets, canViewCosts }: { assets: OperationalAsset[]; canViewCosts: boolean }) {
  const columns = [
    { key: "code", label: "Código", sortable: true },
    { key: "name", label: "Activo", sortable: true },
    { key: "worksiteName", label: "Faena", sortable: true },
    { key: "operationalStatus", label: "Estado", sortable: true },
    { key: "openMaintenanceCount", label: "Backlog", sortable: true, numeric: true },
    { key: "inspectionCount", label: "Inspecciones", sortable: true, numeric: true },
    { key: "downtimeHours", label: "Downtime", sortable: true, numeric: true },
    ...(canViewCosts ? [{ key: "maintenanceCost", label: "Costo", sortable: true, numeric: true }] : []),
    { key: "_action", label: "", sortable: false, numeric: true },
  ]
  const href = (asset: OperationalAsset) => asset.kind === "vehicle" ? `/flota/${asset.id}` : `/admin/equipos/${asset.id}`
  return <DataTable caption="Activos operacionales" columns={columns} rows={assets} searchKeys={["code", "name", "worksiteName", "operationalStatus"]} pageSize={25} emptyTitle="No hay activos visibles" emptyDescription="El alcance de faena y los permisos determinan qué activos aparecen." renderMobileCard={(asset) => <article className="rounded-2xl border border-[var(--color-border)] bg-white p-4"><div className="flex justify-between gap-3"><div><p className="font-mono text-sm font-semibold">{asset.code}</p><p className="text-sm text-[var(--color-text-muted)]">{asset.name}</p></div><Badge variant={asset.operationalStatus === "operativo" ? "success" : asset.operationalStatus === "inactivo" ? "outline" : "warning"}>{asset.operationalStatus}</Badge></div><dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-[var(--color-text-subtle)]">Backlog</dt><dd>{asset.openMaintenanceCount}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Inspecciones</dt><dd>{asset.inspectionCount}</dd></div><div><dt className="text-[var(--color-text-subtle)]">Detención</dt><dd>{asset.downtimeHours.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h</dd></div></dl><Button asChild size="sm" variant="ghost" className="mt-3 w-full"><Link href={href(asset)}>Ver ficha</Link></Button></article>} renderRow={(asset) => <TableRow key={asset.key}><TableCell className="font-mono">{asset.code}</TableCell><TableCell>{asset.name}<span className="block text-xs text-[var(--color-text-subtle)]">{asset.kind === "vehicle" ? "Vehículo / equipo móvil" : "Instrumento de servicio"}</span></TableCell><TableCell>{asset.worksiteName}</TableCell><TableCell><Badge variant={asset.operationalStatus === "operativo" ? "success" : asset.operationalStatus === "inactivo" ? "outline" : "warning"}>{asset.operationalStatus}</Badge></TableCell><TableCell className="text-right font-mono">{asset.openMaintenanceCount}</TableCell><TableCell className="text-right font-mono">{asset.inspectionCount}</TableCell><TableCell className="text-right font-mono">{asset.downtimeHours.toLocaleString("es-CL", { maximumFractionDigits: 1 })} h</TableCell>{canViewCosts && <TableCell className="text-right font-mono">{formatCLP(asset.maintenanceCost ?? 0)}</TableCell>}<TableCell className="text-right"><Button asChild size="sm" variant="ghost"><Link href={href(asset)}>Ver</Link></Button></TableCell></TableRow>} />
}
