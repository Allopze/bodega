"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldCheck } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AccreditationGap } from "@/lib/prevention/contractors"

const GAP_TYPE_LABELS: Record<AccreditationGap["gapType"], string> = {
  missing: "Nunca presentada",
  submitted_not_approved: "Presentada sin aprobar",
  observed: "Observada",
  expired: "Vencida",
}

export function AccreditationGapList({ gaps }: { gaps: AccreditationGap[] }) {
  const { searchQuery } = useSafeShellHeader()
  const [enforcement, setEnforcement] = React.useState("all")
  const [gapType, setGapType] = React.useState("all")

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = gaps.filter((gap) => {
    if (enforcement !== "all" && gap.enforcement !== enforcement) return false
    if (gapType !== "all" && gap.gapType !== gapType) return false
    if (!query) return true
    return `${gap.contractCode} ${gap.subjectLabel} ${gap.requirementCode} ${gap.requirementName}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const blockingCount = gaps.filter((gap) => gap.enforcement === "blocking").length

  function clearFilters() {
    setEnforcement("all"); setGapType("all")
  }

  return (
    <div className="space-y-4">
      {blockingCount > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <h2 className="text-sm font-semibold">{blockingCount} brecha(s) bloqueante(s)</h2>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            Mientras existan, el contrato o la persona no pueden ingresar a faena. El acceso se libera desde el
            contrato una vez aprobada toda la evidencia exigida; no se puede autorizar por excepción.
          </p>
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
          <SelectTrigger className="w-56" aria-label="Tipo de brecha"><SelectValue placeholder="Tipo de brecha" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo tipo</SelectItem>
            {Object.entries(GAP_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        {(enforcement !== "all" || gapType !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={20} />}
          title={gaps.length === 0 ? "Sin brechas de acreditación" : "No hay brechas con estos filtros"}
          description={gaps.length === 0
            ? "Todo contrato vigente alcanzado por un requisito activo tiene su evidencia aprobada y al día. Si esperabas ver brechas, revisa que existan requisitos de acreditación declarados."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={gaps.length === 0
            ? <Button asChild variant="secondary"><Link href="/prevencion/contratistas">Ver contratos</Link></Button>
            : <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato</TableHead>
                <TableHead>Sujeto</TableHead>
                <TableHead>Requisito</TableHead>
                <TableHead>Tipo de brecha</TableHead>
                <TableHead>Exigibilidad</TableHead>
                <TableHead>Vence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((gap) => (
                <TableRow key={`${gap.contractId}-${gap.requirementId}-${gap.contractorWorkerId ?? "contract"}`}>
                  <TableCell className="font-mono text-xs">{gap.contractCode}</TableCell>
                  <TableCell className="text-sm">
                    {gap.subjectLabel}
                    <span className="block text-xs text-[var(--color-text-subtle)]">
                      {gap.contractorWorkerId ? "Persona" : "Empresa / contrato"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-mono text-xs">{gap.requirementCode}</span>
                    <span className="block">{gap.requirementName}</span>
                  </TableCell>
                  <TableCell className="text-sm">{GAP_TYPE_LABELS[gap.gapType]}</TableCell>
                  <TableCell>
                    <Badge variant={gap.enforcement === "blocking" ? "danger" : "warning"}>
                      {gap.enforcement === "blocking" ? "Bloqueante" : "Advertencia"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{gap.expiresOn ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
