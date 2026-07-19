"use client"

import * as React from "react"
import { Heartbeat } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AGENT_TYPE_LABELS,
  MEASUREMENT_OUTCOME_LABELS,
  PROGRAM_STATUS_LABELS,
  measurementOutcomeBadgeVariant,
  type AnonymizedExposureSummary,
} from "@/lib/prevention/hygiene"

interface GroupItem {
  id: string
  code: string
  name: string
  worksiteName: string
  agentName: string
  agentType: string
  agentUnit: string
  surveillanceRequired: boolean
  surveillanceReason: string | null
  memberCount: number
  measurementCount: number
  latestOutcome: string | null
}

interface ProgramItem {
  id: string
  code: string
  name: string
  protocol: string
  worksiteName: string
  status: string
  periodicityMonths: number
  enrolled: number
  attended: number
  overdue: number
}

export function HygieneDashboard({ groups, programs, summary }: {
  groups: GroupItem[]
  programs: ProgramItem[]
  summary: AnonymizedExposureSummary[]
}) {
  const { searchQuery } = useSafeShellHeader()
  const [tab, setTab] = React.useState<"groups" | "programs" | "summary">("groups")

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filteredGroups = groups.filter((item) =>
    !query || `${item.code} ${item.name} ${item.agentName} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))
  const filteredPrograms = programs.filter((item) =>
    !query || `${item.code} ${item.name} ${item.protocol}`.toLocaleLowerCase("es-CL").includes(query))

  const metrics = [
    { id: "surveillance", label: "GES bajo vigilancia", value: groups.filter((item) => item.surveillanceRequired).length, detail: "Excedieron nivel de acción o límite" },
    { id: "above", label: "Sobre el límite", value: groups.filter((item) => item.latestOutcome === "above_limit").length, detail: "Última medición" },
    { id: "notcomparable", label: "Sin límite declarado", value: groups.filter((item) => item.latestOutcome === "not_comparable").length, detail: "No comparable, no conforme" },
    { id: "overdue", label: "Controles vencidos", value: programs.reduce((total, item) => total + item.overdue, 0), detail: "Vigilancia fuera de plazo" },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.id} className="border-r border-[var(--color-border)] px-4 py-3">
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1 w-fit">
        {([["groups", `Grupos (${groups.length})`], ["programs", `Vigilancia (${programs.length})`], ["summary", "Panel anonimizado"]] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            {label}
          </button>
        ))}
      </div>

      {tab === "groups" && (filteredGroups.length === 0 ? (
        <EmptyState
          icon={<Heartbeat size={20} />}
          title={groups.length === 0 ? "Aún no hay grupos de exposición" : "Ningún grupo coincide con la búsqueda"}
          description={groups.length === 0
            ? "Un grupo de exposición similar reúne a quienes comparten agente, proceso y condiciones, de modo que una medición represente a todas las personas del grupo."
            : "Ajusta el texto del buscador superior."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / grupo</TableHead>
                <TableHead>Agente</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead className="text-right">Expuestos</TableHead>
                <TableHead>Última medición</TableHead>
                <TableHead>Vigilancia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGroups.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.name}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.agentName}
                    <span className="block text-xs text-[var(--color-text-subtle)]">
                      {AGENT_TYPE_LABELS[item.agentType] ?? item.agentType} · {item.agentUnit}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.memberCount}</TableCell>
                  <TableCell>
                    {item.latestOutcome
                      ? <Badge variant={measurementOutcomeBadgeVariant(item.latestOutcome)}>
                          {MEASUREMENT_OUTCOME_LABELS[item.latestOutcome] ?? item.latestOutcome}
                        </Badge>
                      : <span className="text-sm text-[var(--color-text-subtle)]">Sin mediciones</span>}
                  </TableCell>
                  <TableCell>
                    {item.surveillanceRequired
                      ? <><Badge variant="danger">Requerida</Badge>
                          {item.surveillanceReason && <span className="mt-1 block max-w-xs text-xs text-[var(--color-text-subtle)]">{item.surveillanceReason}</span>}</>
                      : <span className="text-sm text-[var(--color-text-subtle)]">No requerida</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {tab === "programs" && (filteredPrograms.length === 0 ? (
        <EmptyState
          icon={<Heartbeat size={20} />}
          title={programs.length === 0 ? "Aún no hay programas de vigilancia" : "Ningún programa coincide con la búsqueda"}
          description={programs.length === 0
            ? "Un programa de vigilancia matricula al grupo completo: la nómina se deriva de la pertenencia al grupo de exposición, no se arma a mano."
            : "Ajusta el texto del buscador superior."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / programa</TableHead>
                <TableHead>Protocolo</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Periodicidad</TableHead>
                <TableHead className="text-right" title="Con control realizado sobre matriculados">Cobertura</TableHead>
                <TableHead className="text-right">Vencidos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPrograms.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.name}</span>
                  </TableCell>
                  <TableCell className="text-sm">{item.protocol}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "active" ? "success" : "outline"}>
                      {PROGRAM_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{item.periodicityMonths} meses</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.attended} / {item.enrolled}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.overdue > 0 ? item.overdue : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}

      {tab === "summary" && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-subtle)]">
            Vista agregada por grupo, sin identificar personas. Los grupos demasiado pequeños se suprimen:
            publicar su tasa permitiría reidentificar a alguien y su vínculo con un programa de vigilancia,
            que es dato de salud.
          </p>
          {summary.length === 0 ? (
            <EmptyState icon={<Heartbeat size={20} />} title="Sin grupos activos" description="Crea grupos de exposición para ver el panel agregado." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Grupo</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead className="text-right">Expuestos</TableHead>
                    <TableHead>Última medición</TableHead>
                    <TableHead className="text-right">Cobertura de control</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((item) => (
                    <TableRow key={item.groupId}>
                      <TableCell className="text-sm">{item.groupName}</TableCell>
                      <TableCell className="text-sm">{item.agentName}</TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">{item.exposedCount}</TableCell>
                      <TableCell>
                        {item.latestOutcome
                          ? <Badge variant={measurementOutcomeBadgeVariant(item.latestOutcome)}>
                              {MEASUREMENT_OUTCOME_LABELS[item.latestOutcome] ?? item.latestOutcome}
                            </Badge>
                          : <span className="text-sm text-[var(--color-text-subtle)]">Sin mediciones</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {item.attendanceRate === null
                          ? <span title="Grupo demasiado pequeño para publicar sin reidentificar">Suprimido</span>
                          : `${item.attendanceRate}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
