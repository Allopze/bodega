"use client"

import * as React from "react"
import Link from "next/link"
import { MapPin } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  PREVENTIVE_ORGANIZATION_LABELS,
  type PreventiveOrganization,
} from "@/lib/prevention/cphs-organization"
import { formatDate } from "@/lib/utils"

interface WorksiteRow {
  worksiteId: string
  worksiteName: string
  worksiteCode: string | null
  headcount: number
  committeeId: string | null
  committeeName: string | null
  mandateEndsOn: string | null
  mandateExpired: boolean
  delegateName: string | null
  compliance: { required: PreventiveOrganization; compliant: boolean; detail: string }
}

export function WorksiteOrganizationList({ worksites }: { worksites: WorksiteRow[] }) {
  const { searchQuery, setSearchQuery } = useSafeShellHeader()
  const [organizationFilter, setOrganizationFilter] = React.useState<"all" | "cphs" | "delegate" | "gaps" | "expired">("all")
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = worksites.filter((item) => {
    const matchesQuery = !query || `${item.worksiteName} ${item.worksiteCode ?? ""}`.toLocaleLowerCase("es-CL").includes(query)
    const matchesMetric = organizationFilter === "all"
      || (organizationFilter === "cphs" && item.compliance.required === "cphs")
      || (organizationFilter === "delegate" && item.compliance.required === "delegate")
      || (organizationFilter === "gaps" && !item.compliance.compliant)
      || (organizationFilter === "expired" && item.mandateExpired)
    return matchesQuery && matchesMetric
  })

  const cphsCount = worksites.filter((item) => item.compliance.required === "cphs").length
  const delegateCount = worksites.filter((item) => item.compliance.required === "delegate").length
  const gapCount = worksites.filter((item) => !item.compliance.compliant).length
  const expiredCount = worksites.filter((item) => item.mandateExpired).length

  const metrics = [
    { id: "cphs" as const, label: "Exigen comité", value: cphsCount === 0 ? "Ninguna" : cphsCount, detail: "Más de 25 trabajadores" },
    { id: "delegate" as const, label: "Exigen delegado", value: delegateCount === 0 ? "Ninguna" : delegateCount, detail: "Entre 10 y 25" },
    { id: "gaps" as const, label: "Con brecha", value: gapCount === 0 ? "Sin brechas" : gapCount, detail: gapCount === 0 ? "Todas cumplen" : "Sin el órgano exigible" },
    { id: "expired" as const, label: "Mandatos vencidos", value: expiredCount === 0 ? "Vigentes" : expiredCount, detail: expiredCount === 0 ? "Sin renovaciones pendientes" : "Requieren nueva elección" },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            aria-pressed={organizationFilter === metric.id}
            onClick={() => setOrganizationFilter((current) => current === metric.id ? "all" : metric.id)}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-surface-2)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MapPin size={24} />}
          title={worksites.length === 0 ? "Sin faenas en tu alcance" : "Ninguna faena coincide"}
          description={worksites.length === 0
            ? "Cuando tengas faenas asignadas aparecerán acá con su dotación y el órgano preventivo que les corresponde."
            : "Quita el filtro activo o limpia la búsqueda del encabezado para volver a ver la organización preventiva."}
          action={worksites.length === 0
            ? <Button asChild size="sm" variant="secondary"><Link href="/dashboard">Volver al inicio</Link></Button>
            : <Button size="sm" variant="secondary" onClick={() => { setOrganizationFilter("all"); setSearchQuery("") }}>Mostrar todas</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Faena</TableHead>
                <TableHead className="text-right">Dotación</TableHead>
                <TableHead>Órgano exigible</TableHead>
                <TableHead>Constituido</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.worksiteId}>
                  <TableCell>
                    <Link href={`/prevencion/faenas/${item.worksiteId}`} className="text-sm font-medium hover:underline">
                      {item.worksiteName}
                    </Link>
                    {item.worksiteCode && (
                      <span className="block font-mono text-xs text-[var(--color-text-subtle)]">{item.worksiteCode}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.headcount}</TableCell>
                  <TableCell className="text-sm">{PREVENTIVE_ORGANIZATION_LABELS[item.compliance.required]}</TableCell>
                  <TableCell className="text-sm">
                    {item.committeeName ? (
                      <Link href={`/prevencion/cphs/${item.committeeId}`} className="hover:underline">{item.committeeName}</Link>
                    ) : item.delegateName ? (
                      item.delegateName
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">Sin constituir</span>
                    )}
                    {item.mandateExpired && item.mandateEndsOn && (
                      <span className="block text-xs text-[var(--color-warning-ink)]">Mandato vencido el {formatDate(item.mandateEndsOn)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.compliance.compliant ? "success" : "danger"}>
                      {item.compliance.compliant ? "Al día" : "Brecha"}
                    </Badge>
                    <span className="mt-1 block max-w-md text-xs text-[var(--color-text-subtle)]">{item.compliance.detail}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
