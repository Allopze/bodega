"use client"

import * as React from "react"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableCell, TableRow } from "@/components/ui/table"
import type { CompetencyGap } from "@/lib/prevention/training"
import { escalateBlockingGapsAction } from "../actions"

interface Props {
  gaps: CompetencyGap[]
  canEscalate: boolean
}

const GAP_TYPE_LABELS: Record<CompetencyGap["gapType"], string> = {
  missing: "Nunca obtenida",
  expired: "Vencida",
  revoked: "Revocada",
}

function defaultTargetDate() {
  // Desde el día civil chileno: `new Date()` + `toISOString()` mide en UTC, así
  // que después de las 20:00 de Chile sugería hoy+31. Esquivaba la regla de
  // ESLint porque el `.toISOString()` va sobre un `Date` ya mutado.
  return addDaysToPlainDate(todayInChile(), 30)
}

const COLUMNS = [
  { key: "workerName", label: "Trabajador", sortable: true },
  { key: "courseName", label: "Curso exigido", sortable: true },
  { key: "gapType", label: "Tipo de brecha", sortable: true },
  { key: "enforcement", label: "Exigibilidad", sortable: true },
  { key: "expiredAt", label: "Venció", sortable: true },
  { key: "reason", label: "Fundamento" },
]

export function CompetencyGapList({ gaps, canEscalate }: Props) {
  const [enforcement, setEnforcement] = React.useState("all")
  const [gapType, setGapType] = React.useState("all")
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState<string | null>(null)

  const filtered = gaps.filter((gap) => {
    if (enforcement !== "all" && gap.enforcement !== enforcement) return false
    if (gapType !== "all" && gap.gapType !== gapType) return false
    return true
  })

  const rows = filtered
  const blockingCount = gaps.filter((gap) => gap.enforcement === "blocking").length

  function escalate() {
    setMessage(null)
    startTransition(async () => {
      const result = await escalateBlockingGapsAction({ targetDate: defaultTargetDate() })
      setMessage(result.ok
        ? "Brechas bloqueantes escaladas a CAPA. Las que ya tenían una acción abierta no se duplicaron."
        : result.message ?? "No se pudo escalar.")
    })
  }

  return (
    <div className="space-y-4">
      {blockingCount > 0 && (
        <div className="rounded-lg border border-[var(--color-danger-border,var(--color-border))] bg-[var(--color-surface-2)] p-4">
          <h2 className="text-sm font-semibold">{blockingCount} brecha(s) bloqueante(s)</h2>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            Estas personas no deben ser asignadas a la tarea que exige la competencia hasta regularizar.
            Escalar crea una acción CAPA por persona y curso; no cierra la brecha por sí mismo.
          </p>
          {canEscalate && (
            <Button type="button" size="sm" className="mt-3" disabled={pending} onClick={escalate}>
              Escalar brechas bloqueantes a CAPA
            </Button>
          )}
          {message && <p role="status" className="mt-2 text-sm">{message}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Select value={enforcement} onValueChange={setEnforcement}>
          <SelectTrigger className="w-52" aria-label="Exigibilidad"><SelectValue placeholder="Exigibilidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda exigibilidad</SelectItem>
            <SelectItem value="blocking">Bloqueante</SelectItem>
            <SelectItem value="warning">Advertencia</SelectItem>
          </SelectContent>
        </Select>
        <Select value={gapType} onValueChange={setGapType}>
          <SelectTrigger className="w-52" aria-label="Tipo de brecha"><SelectValue placeholder="Tipo de brecha" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo tipo</SelectItem>
            {Object.entries(GAP_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        {(enforcement !== "all" || gapType !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setEnforcement("all"); setGapType("all") }}>
            Limpiar filtros
          </Button>
        )}
      </div>

      <DataTable
        caption="Brechas de competencia"
        columns={COLUMNS}
        rows={rows}
        searchKeys={["workerName", "courseName", "position"]}
        emptyTitle={gaps.length === 0 ? "Sin brechas de competencia" : "No hay brechas con estos filtros"}
        emptyDescription={gaps.length === 0 ? "Toda la dotación activa alcanzada por un requisito vigente tiene su habilitación al día. Si esperabas ver brechas, revisa que existan requisitos de competencia declarados." : "Ajusta los filtros o el texto del buscador superior."}
        emptyAction={gaps.length === 0 ? <Button asChild variant="secondary"><Link href="/prevencion/capacitacion/competencias">Ver requisitos</Link></Button> : <Button type="button" variant="secondary" onClick={() => { setEnforcement("all"); setGapType("all") }}>Ver todas</Button>}
        renderMobileCard={(gap) => {
          const workerHref = `/prevencion/capacitacion/competencias?workerId=${gap.workerId}`
          return (
            <ResponsiveDataListCard
              title={<Link href={workerHref} className="hover:underline">{gap.workerName}</Link>}
              description={gap.position ?? "Sin cargo"}
              status={<Badge variant={gap.enforcement === "blocking" ? "danger" : "warning"}>{gap.enforcement === "blocking" ? "Bloqueante" : "Advertencia"}</Badge>}
              actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={workerHref}>Ver competencia</Link></Button>}
            >
              <ResponsiveDataListField label="Curso exigido">{gap.courseName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Tipo de brecha">{GAP_TYPE_LABELS[gap.gapType]}</ResponsiveDataListField>
              <ResponsiveDataListField label="Venció">{gap.expiredAt ?? "—"}</ResponsiveDataListField>
              <ResponsiveDataListField label="Fundamento">{gap.reason}</ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(gap) => {
          return (
            <TableRow key={`${gap.workerId}-${gap.requirementId}`}>
              <TableCell>
                <Link href={`/prevencion/capacitacion/competencias?workerId=${gap.workerId}`} className="text-sm font-medium underline-offset-2 hover:underline">
                  {gap.workerName}
                </Link>
                <span className="block text-xs text-[var(--color-text-subtle)]">{gap.position ?? "Sin cargo"}</span>
              </TableCell>
              <TableCell className="text-sm">{gap.courseName}</TableCell>
              <TableCell className="text-sm">{GAP_TYPE_LABELS[gap.gapType]}</TableCell>
              <TableCell>
                <Badge variant={gap.enforcement === "blocking" ? "danger" : "warning"}>
                  {gap.enforcement === "blocking" ? "Bloqueante" : "Advertencia"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm tabular-nums">{gap.expiredAt ?? "—"}</TableCell>
              <TableCell className="max-w-md text-xs text-[var(--color-text-subtle)]">{gap.reason}</TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
