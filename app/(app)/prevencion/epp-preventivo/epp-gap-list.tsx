"use client"

import * as React from "react"
import Link from "next/link"
import { HardHat } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EPP_GAP_TYPE_LABELS, type EppCoverageGap } from "@/lib/prevention/epp"
import { escalateBlockingEppGapsAction, generateReplenishmentAction } from "./actions"

interface Props {
  gaps: EppCoverageGap[]
  canEscalate: boolean
}

function defaultTargetDate() {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + 30)
  return value.toISOString().slice(0, 10)
}

export function EppGapList({ gaps, canEscalate }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const [enforcement, setEnforcement] = React.useState("all")
  const [gapType, setGapType] = React.useState("all")
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState<string | null>(null)

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = gaps.filter((gap) => {
    if (enforcement !== "all" && gap.enforcement !== enforcement) return false
    if (gapType !== "all" && gap.gapType !== gapType) return false
    if (!query) return true
    return `${gap.workerName} ${gap.eppTypeLabel} ${gap.position ?? ""}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const blockingCount = gaps.filter((gap) => gap.enforcement === "blocking").length

  function escalate() {
    setMessage(null)
    startTransition(async () => {
      const result = await escalateBlockingEppGapsAction({ targetDate: defaultTargetDate() })
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
            Estas personas no deben ser asignadas a la tarea que exige el EPP hasta regularizar la entrega.
            Escalar crea una acción CAPA por persona y tipo de EPP; no cierra la brecha por sí mismo.
          </p>
          {canEscalate && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" disabled={pending} onClick={escalate}>
                Escalar brechas bloqueantes a CAPA
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => {
                setMessage(null)
                startTransition(async () => {
                  const res = await generateReplenishmentAction()
                  setMessage(res.ok ? "Borradores de solicitud de reposición creados en Solicitudes." : res.message ?? "Error")
                })
              }}>
                Generar Solicitud de Reposición
              </Button>
            </div>
          )}{message && <p role="status" className="mt-2 text-sm">{message}</p>}
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
            {Object.entries(EPP_GAP_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        {(enforcement !== "all" || gapType !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setEnforcement("all"); setGapType("all") }}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<HardHat size={20} />}
          title={gaps.length === 0 ? "Sin brechas de cobertura de EPP" : "No hay brechas con estos filtros"}
          description={gaps.length === 0
            ? "Toda la dotación activa alcanzada por un requisito vigente tiene el EPP entregado y vigente. Si esperabas ver brechas, revisa que existan requisitos declarados."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={gaps.length === 0
            ? undefined
            : <Button type="button" variant="secondary" onClick={() => { setEnforcement("all"); setGapType("all") }}>Ver todas</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trabajador</TableHead>
                <TableHead>EPP exigido</TableHead>
                <TableHead>Tipo de brecha</TableHead>
                <TableHead>Exigibilidad</TableHead>
                <TableHead>Última entrega</TableHead>
                <TableHead>Fundamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((gap) => (
                <TableRow key={`${gap.workerId}-${gap.requirementId}`}>
                  <TableCell>
                    <Link href={`/prevencion/trabajador/${gap.workerId}`} className="text-sm font-medium underline-offset-2 hover:underline">
                      {gap.workerName}
                    </Link>
                    <span className="block text-xs text-[var(--color-text-subtle)]">{gap.position ?? "Sin cargo"}</span>
                  </TableCell>
                  <TableCell className="text-sm">{gap.eppTypeLabel}</TableCell>
                  <TableCell className="text-sm">{EPP_GAP_TYPE_LABELS[gap.gapType]}</TableCell>
                  <TableCell>
                    <Badge variant={gap.enforcement === "blocking" ? "danger" : "warning"}>
                      {gap.enforcement === "blocking" ? "Bloqueante" : "Advertencia"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{gap.lastDeliveredAt ?? "—"}</TableCell>
                  <TableCell className="max-w-md text-xs text-[var(--color-text-subtle)]">{gap.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
