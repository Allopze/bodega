"use client"

import * as React from "react"
import Link from "next/link"
import { UsersThree } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  COMMITTEE_MEETING_STATUS_LABELS,
  COMMITTEE_STATUS_LABELS,
  MANAGEMENT_REVIEW_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  committeeStatusBadgeVariant,
} from "@/lib/prevention/cphs"
import { formatDateTime } from "@/lib/utils"
import { CloseReviewDialog, NewCommitteeDialog, NewReviewDialog } from "./cphs-dialogs"

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

interface ReviewItem {
  id: string
  code: string
  periodLabel: string
  worksiteName: string | null
  heldAt: string
  status: string
  conclusions: string | null
  version: number
}

interface Props {
  committees: CommitteeItem[]
  meetings: MeetingItem[]
  reviews: ReviewItem[]
  worksites: { id: string; name: string }[]
  assignees: { id: string; name: string }[]
  canManage: boolean
  canReview: boolean
}

export function CommitteeList({ committees, meetings, reviews, worksites, assignees, canManage, canReview }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const [tab, setTab] = React.useState<"committees" | "meetings" | "reviews">("committees")

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filteredCommittees = committees.filter((item) =>
    !query || `${item.name} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))
  const filteredMeetings = meetings.filter((item) =>
    !query || `${item.code} ${item.committeeName} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))
  const filteredReviews = reviews.filter((item) =>
    !query || `${item.code} ${item.periodLabel} ${item.worksiteName ?? ""}`.toLocaleLowerCase("es-CL").includes(query))

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1 w-fit">
          <button type="button" onClick={() => setTab("committees")} aria-pressed={tab === "committees"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            Comités ({committees.length})
          </button>
          <button type="button" onClick={() => setTab("meetings")} aria-pressed={tab === "meetings"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            Sesiones ({meetings.length})
          </button>
          <button type="button" onClick={() => setTab("reviews")} aria-pressed={tab === "reviews"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]">
            Revisión por la dirección ({reviews.length})
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "committees" && canManage && worksites.length > 0 && <NewCommitteeDialog worksites={worksites} />}
          {tab === "reviews" && canReview && <NewReviewDialog worksites={worksites} />}
        </div>
      </div>

      {tab === "committees" && (filteredCommittees.length === 0 ? (
        <EmptyState
          icon={<UsersThree size={20} />}
          title={committees.length === 0 ? "Aún no hay comités constituidos" : "Ningún comité coincide con la búsqueda"}
          description={committees.length === 0
            ? "Un Comité Paritario se constituye por centro de trabajo, con igual número de representantes de la empresa y de las personas trabajadoras, más presidencia y secretaría."
            : "Ajusta el texto del buscador superior."}
          action={canManage && worksites.length > 0 ? <NewCommitteeDialog worksites={worksites} /> : undefined}
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
                    <Link href={`/prevencion/cphs/${item.id}`} className="hover:underline">
                      <span className="text-sm font-medium">{item.name}</span>
                    </Link>
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
      ))}

      {tab === "meetings" && (filteredMeetings.length === 0 ? (
        <EmptyState
          icon={<UsersThree size={20} />}
          title={meetings.length === 0 ? "Aún no hay sesiones convocadas" : "Ninguna sesión coincide con la búsqueda"}
          description={meetings.length === 0
            ? "Una sesión sólo cierra su acta si alcanzó quórum, y cada acuerdo se convierte en una acción CAPA con responsable y plazo. Convoca una desde el detalle del comité."
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
      ))}

      {tab === "reviews" && (filteredReviews.length === 0 ? (
        <EmptyState
          icon={<UsersThree size={20} />}
          title={reviews.length === 0 ? "Aún no hay revisiones por la dirección" : "Ninguna revisión coincide con la búsqueda"}
          description={reviews.length === 0
            ? "El art. 22 exige evaluar el sistema de gestión periódicamente. La revisión no cierra sin conclusiones."
            : "Ajusta el texto del buscador superior."}
          action={canReview ? <NewReviewDialog worksites={worksites} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / período</TableHead>
                <TableHead>Alcance</TableHead>
                <TableHead>Realizada</TableHead>
                <TableHead>Estado</TableHead>
                {canReview && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReviews.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.periodLabel}</span>
                  </TableCell>
                  <TableCell className="text-sm">{item.worksiteName ?? "Toda la organización"}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatDateTime(item.heldAt)}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "closed" ? "success" : "default"}>
                      {MANAGEMENT_REVIEW_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                    {item.conclusions && <span className="mt-1 block max-w-sm text-xs text-[var(--color-text-subtle)]">{item.conclusions}</span>}
                  </TableCell>
                  {canReview && (
                    <TableCell className="text-right">
                      {item.status === "draft" && <CloseReviewDialog review={item} worksites={worksites} assignees={assignees} />}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
