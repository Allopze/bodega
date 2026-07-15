"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { DataTable } from "@/components/admin/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import type { listActionsByProgram } from "@/lib/services/prevention-pdtp"

type ActionRow = Awaited<ReturnType<typeof listActionsByProgram>>[number]

const ESTADO_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado",
  verificado: "Verificado",
  reabierto: "Reabierto",
}

function estadoVariant(estado: string, vencida: boolean): BadgeProps["variant"] {
  if (vencida) return "danger"
  switch (estado) {
    case "verificado": return "success"
    case "completado": return "info"
    case "en_proceso": return "warning"
    case "reabierto":  return "danger"
    default:           return "default"
  }
}

const COLUMNS = [
  { key: "n", label: "N°", width: "w-12" },
  { key: "hallazgo", label: "Hallazgo" },
  { key: "activity", label: "Actividad" },
  { key: "worksite", label: "Faena" },
  { key: "responsable", label: "Responsable" },
  { key: "plazo", label: "Plazo" },
  { key: "prioridad", label: "Prioridad" },
  { key: "estado", label: "Estado" },
]

export function AccionesTable({ items, activityLabelById, worksiteNameById, worksites, filters, programId }: {
  items: ActionRow[]
  activityLabelById: Record<string, string>
  worksiteNameById: Record<string, string>
  worksites: Array<{ id: string; name: string }>
  filters: { estado?: string; prioridad?: string; worksiteId?: string; soloVencidas: boolean }
  canManage: boolean
  canVerify: boolean
  programId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function updateFilter(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }

  const rows = items.map((item) => ({
    ...item,
    activity: activityLabelById[item.activityId] ?? item.activityId,
    worksite: worksiteNameById[item.worksiteId] ?? item.worksiteId,
  })) as unknown as Record<string, unknown>[]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.estado ?? "__all"} onValueChange={(v) => updateFilter("estado", v === "__all" ? null : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos los estados</SelectItem>
            {Object.entries(ESTADO_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.prioridad ?? "__all"} onValueChange={(v) => updateFilter("prioridad", v === "__all" ? null : v)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Prioridad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Toda prioridad</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="media">Media</SelectItem>
            <SelectItem value="baja">Baja</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.worksiteId ?? "__all"} onValueChange={(v) => updateFilter("faena", v === "__all" ? null : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todas las faenas</SelectItem>
            {worksites.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.soloVencidas ? "1" : "0"} onValueChange={(v) => updateFilter("vencidas", v === "1" ? "1" : null)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Todas</SelectItem>
            <SelectItem value="1">Solo vencidas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={rows}
        searchKeys={["hallazgo", "accion", "responsable", "activity", "worksite"]}
        emptyTitle="Sin acciones"
        emptyDescription="No hay acciones correctivas que coincidan con los filtros."
        renderRow={(row) => {
          const item = row as unknown as ActionRow & { activity: string; worksite: string }
          return (
            <TableRow key={item.id}>
              <TableCell className="text-(--color-text-muted)">{item.n}</TableCell>
              <TableCell>
                <Link
                  href={`/prevencion/pdtp/${programId}/ejecucion/${item.executionId}`}
                  className="font-medium text-(--color-text) hover:underline"
                >
                  {item.hallazgo}
                </Link>
              </TableCell>
              <TableCell className="text-xs text-(--color-text-muted)">{item.activity}</TableCell>
              <TableCell className="text-xs text-(--color-text-muted)">{item.worksite}</TableCell>
              <TableCell>{item.responsable}</TableCell>
              <TableCell className="tabular-nums">{item.plazo}</TableCell>
              <TableCell><Badge variant="outline">{item.prioridad}</Badge></TableCell>
              <TableCell>
                <Badge variant={estadoVariant(item.estado, item.vencida)}>
                  {item.vencida ? "Vencida" : ESTADO_LABELS[item.estado] ?? item.estado}
                </Badge>
              </TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
