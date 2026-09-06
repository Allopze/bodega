"use client"
import Link from "next/link"
import { Heartbeat } from "@phosphor-icons/react"
import { ProtocolsPanel, type ApplicabilityRow } from "./protocols-panel"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import {
  AGENT_TYPE_LABELS,
  MEASUREMENT_OUTCOME_LABELS,
  PROGRAM_STATUS_LABELS,
  measurementOutcomeBadgeVariant,
  type AnonymizedExposureSummary,
} from "@/lib/prevention/hygiene"
import {
  HYGIENE_QUICK_FILTER_LABELS,
  isHygieneDashboardTab,
  isHygieneQuickFilter,
  matchesHygieneGroupQuickFilter,
  matchesHygieneProgramQuickFilter,
  type HygieneDashboardTab,
  type HygieneQuickFilter,
} from "@/lib/prevention/hygiene-dashboard-filters"
import { NewAgentDialog, NewGroupDialog, NewProgramDialog } from "./hygiene-dialogs"

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

interface AgentOption {
  id: string
  code: string
  name: string
  unit: string
}

export function HygieneDashboard({ groups, programs, summary, agents, worksites, protocolWorksites, applicabilities, today, canManage }: {
  groups: GroupItem[]
  programs: ProgramItem[]
  summary: AnonymizedExposureSummary[]
  agents: AgentOption[]
  worksites: { id: string; name: string }[]
  protocolWorksites: { id: string; name: string }[]
  applicabilities: ApplicabilityRow[]
  today: string
  canManage: boolean
}) {
  const { searchQuery } = useSafeShellHeader()
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const tabValue = getFilter("tab")
  const quickFilterValue = getFilter("vista")
  const tab: HygieneDashboardTab = isHygieneDashboardTab(tabValue) ? tabValue : "groups"
  const parsedQuickFilter: HygieneQuickFilter = isHygieneQuickFilter(quickFilterValue) ? quickFilterValue : "all"
  const quickFilter: HygieneQuickFilter = tab === "groups"
    ? parsedQuickFilter === "overdue" ? "all" : parsedQuickFilter
    : tab === "programs" && (parsedQuickFilter === "all" || parsedQuickFilter === "overdue")
      ? parsedQuickFilter
      : "all"

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filteredGroups = groups.filter((item) =>
    matchesHygieneGroupQuickFilter(item, quickFilter)
    && (!query || `${item.code} ${item.name} ${item.agentName} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query)))
  const filteredPrograms = programs.filter((item) =>
    matchesHygieneProgramQuickFilter(item, quickFilter)
    && (!query || `${item.code} ${item.name} ${item.protocol}`.toLocaleLowerCase("es-CL").includes(query)))

  const metrics = [
    { id: "surveillance", key: "surveillance" as const, tab: "groups" as const, label: "GES bajo vigilancia", value: groups.filter((item) => item.surveillanceRequired).length, detail: "Excedieron nivel de acción o límite" },
    { id: "above", key: "above_limit" as const, tab: "groups" as const, label: "Sobre el límite", value: groups.filter((item) => item.latestOutcome === "above_limit").length, detail: "Última medición" },
    { id: "notcomparable", key: "not_comparable" as const, tab: "groups" as const, label: "Sin límite declarado", value: groups.filter((item) => item.latestOutcome === "not_comparable").length, detail: "No comparable, no conforme" },
    { id: "overdue", key: "overdue" as const, tab: "programs" as const, label: "Programas con vencidos", value: programs.filter((item) => item.overdue > 0).length, detail: "Vigilancia con control fuera de plazo" },
  ]
  const activeChips: ActiveFilterChip[] = quickFilter === "all" ? [] : [{
    key: "vista",
    label: "Vista",
    value: quickFilter,
    displayValue: HYGIENE_QUICK_FILTER_LABELS[quickFilter],
  }]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setFilters({ tab: metric.tab, vista: tab === metric.tab && quickFilter === metric.key ? null : metric.key })}
            aria-pressed={tab === metric.tab && quickFilter === metric.key}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={() => setFilters({ vista: null })}
        onClearAll={() => clearUrlFilters(["tab"])}
        hasActiveFilters={quickFilter !== "all"}
        actions={canManage && (
          <div className="flex flex-wrap gap-2">
            <NewAgentDialog />
            {agents.length > 0 && worksites.length > 0 && tab === "groups" && <NewGroupDialog agents={agents} worksites={worksites} />}
            {worksites.length > 0 && tab === "programs" && <NewProgramDialog agents={agents} worksites={worksites} />}
          </div>
        )}
      >
        <div role="tablist" aria-label="Vista de higiene" className="flex gap-1 rounded-md border border-[var(--color-border)] p-1 w-fit">
          {([["groups", `Grupos (${groups.length})`], ["programs", `Vigilancia (${programs.length})`], ["protocols", "Protocolos MINSAL"], ["summary", "Panel anonimizado"]] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" onClick={() => setFilters({ tab: value, vista: null })} aria-selected={tab === value}
              className="rounded px-3 py-1 text-sm aria-selected:bg-[var(--color-primary-tint)]">
              {label}
            </button>
          ))}
        </div>
      </FilterToolbar>

      {tab === "protocols" && (
        <ProtocolsPanel
          worksites={protocolWorksites}
          applicabilities={applicabilities}
          today={today}
          canManage={canManage}
        />
      )}

      {tab === "groups" && (filteredGroups.length === 0 ? (
        <EmptyState
          icon={<Heartbeat size={20} />}
          title={groups.length === 0 ? "Aún no hay grupos de exposición" : "Ningún grupo coincide con la búsqueda"}
          description={groups.length === 0
            ? "Un grupo de exposición similar reúne a quienes comparten agente, proceso y condiciones, de modo que una medición represente a todas las personas del grupo."
            : "Ajusta el texto del buscador superior."}
          action={canManage && groups.length === 0 && agents.length > 0 && worksites.length > 0 ? <NewGroupDialog agents={agents} worksites={worksites} /> : undefined}
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
                    <Link href={`/prevencion/higiene/grupos/${item.id}`} className="hover:underline">
                      <span className="font-mono text-xs">{item.code}</span>
                      <span className="block text-sm font-medium">{item.name}</span>
                    </Link>
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
                      ? <MetaBadge meta={{ label: MEASUREMENT_OUTCOME_LABELS[item.latestOutcome] ?? item.latestOutcome, variant: measurementOutcomeBadgeVariant(item.latestOutcome) }} />
                      : <span className="text-sm text-[var(--color-text-subtle)]">Sin mediciones</span>}
                  </TableCell>
                  <TableCell>
                    {item.surveillanceRequired
                      ? <><MetaBadge meta={{ label: "Requerida", variant: "danger" }} />
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
          action={canManage && programs.length === 0 && worksites.length > 0 ? <NewProgramDialog agents={agents} worksites={worksites} /> : undefined}
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
                    <Link href={`/prevencion/higiene/programas/${item.id}`} className="hover:underline">
                      <span className="font-mono text-xs">{item.code}</span>
                      <span className="block text-sm font-medium">{item.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{item.protocol}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: PROGRAM_STATUS_LABELS[item.status] ?? item.status, variant: item.status === "active" ? "success" : "outline" }} />
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
                          ? <MetaBadge meta={{ label: MEASUREMENT_OUTCOME_LABELS[item.latestOutcome] ?? item.latestOutcome, variant: measurementOutcomeBadgeVariant(item.latestOutcome) }} />
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
