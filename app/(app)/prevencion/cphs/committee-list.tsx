"use client"

import * as React from "react"
import { UsersThree } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  COMMITTEE_MEETING_STATUS_LABELS,
  COMMITTEE_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  committeeStatusBadgeVariant,
} from "@/lib/prevention/cphs"
import { formatDateTime } from "@/lib/utils"

interface CommitteeItem {
  id: string
  name: string
  status: string
  worksiteName: string
  constitutedOn: string
  mandateEndsOn: string
  mandateExpired: boolean
  activeMembers: number
  closedMeetings: number
  cadenceOverdue: boolean
}

interface MeetingItem {
  id: string
  code: string
  committeeName: string
  worksiteName: string
  meetingType: string
  scheduledFor: string
  status: string
  quorumReached: boolean
  convened: number
  attended: number
  agreements: number
}

export function CommitteeList({ committees, meetings }: { committees: CommitteeItem[]; meetings: MeetingItem[] }) {
  const { searchQuery } = useSafeShellHeader()
  const [tab, setTab] = React.useState<"committees" | "meetings">("committees")

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filteredCommittees = committees.filter((item) =>
    !query || `${item.name} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))
  const filteredMeetings = meetings.filter((item) =>
    !query || `${item.code} ${item.committeeName} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))

  const metrics = [
    { id: "active", label: "Comités vigentes", value: committees.filter((item) => item.status === "active" && !item.mandateExpired).length, detail: "Con mandato al día" },
    { id: "expired", label: "Mandatos vencidos", value: committees.filter((item) => item.mandateExpired).length, detail: "Requieren nueva elección" },
    { id: "cadence", label: "Sin sesionar", value: committees.filter((item) => item.cadenceOverdue).length, detail: "Dos meses o más" },
    { id: "agreements", label: "Acuerdos registrados", value: meetings.reduce((total, item) => total + item.agreements, 0), detail: "Derivados a CAPA" },
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
        <button type="button" onClick={() => setTab("committees")} aria-pressed={tab === "committees"}
          className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
          Comités ({committees.length})
        </button>
        <button type="button" onClick={() => setTab("meetings")} aria-pressed={tab === "meetings"}
          className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
          Sesiones ({meetings.length})
        </button>
      </div>

      {tab === "committees" ? (
        filteredCommittees.length === 0 ? (
          <EmptyState
            icon={<UsersThree size={20} />}
            title={committees.length === 0 ? "Aún no hay comités constituidos" : "Ningún comité coincide con la búsqueda"}
            description={committees.length === 0
              ? "Un Comité Paritario se constituye por centro de trabajo, con igual número de representantes de la empresa y de las personas trabajadoras, más presidencia y secretaría."
              : "Ajusta el texto del buscador superior."}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comité / faena</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Mandato</TableHead>
                  <TableHead className="text-right">Integrantes</TableHead>
                  <TableHead className="text-right">Sesiones cerradas</TableHead>
                  <TableHead>Cadencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCommittees.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="block text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={committeeStatusBadgeVariant(item.mandateExpired ? "expired" : item.status)}>
                        {COMMITTEE_STATUS_LABELS[item.mandateExpired ? "expired" : item.status] ?? item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {item.constitutedOn}
                      <span className="block text-xs text-[var(--color-text-subtle)]">hasta {item.mandateEndsOn}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{item.activeMembers}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{item.closedMeetings}</TableCell>
                    <TableCell>
                      {item.cadenceOverdue
                        ? <Badge variant="warning">Sin sesionar</Badge>
                        : <span className="text-sm text-[var(--color-text-subtle)]">Al día</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : filteredMeetings.length === 0 ? (
        <EmptyState
          icon={<UsersThree size={20} />}
          title={meetings.length === 0 ? "Aún no hay sesiones convocadas" : "Ninguna sesión coincide con la búsqueda"}
          description={meetings.length === 0
            ? "Una sesión sólo cierra su acta si alcanzó quórum, y cada acuerdo se convierte en una acción CAPA con responsable y plazo."
            : "Ajusta el texto del buscador superior."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / comité</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Convocada</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right" title="Asistentes sobre convocados">Asistencia</TableHead>
                <TableHead className="text-right">Acuerdos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMeetings.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.committeeName}</span>
                    <span className="text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
                  </TableCell>
                  <TableCell className="text-sm">{MEETING_TYPE_LABELS[item.meetingType] ?? item.meetingType}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatDateTime(item.scheduledFor)}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "closed" ? "success" : item.status === "cancelled" ? "outline" : "default"}>
                      {COMMITTEE_MEETING_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                    {item.status === "closed" && !item.quorumReached && (
                      <span className="block text-xs text-[var(--color-text-subtle)]">Sin quórum</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.attended} / {item.convened}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{item.agreements}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
