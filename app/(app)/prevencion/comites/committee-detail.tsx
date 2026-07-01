"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react"
import type { Committee, CommitteeMember, CommitteeMeeting, CommitteeAgreement } from "@/db/schema"
import { AGREEMENT_STATUS_LABELS, AGREEMENT_STATUS_VARIANTS } from "@/lib/prevention/badges"
import { MemberForm } from "./member-form"
import { MeetingForm } from "./meeting-form"
import { AgreementForm } from "./agreement-form"

interface Props {
  committee: Committee
  users: { id: string; name: string }[]
  members: CommitteeMember[]
  meetings: CommitteeMeeting[]
  agreements: CommitteeAgreement[]
  canManage: boolean
}

export function CommitteeDetail({ committee, users, members, meetings, agreements, canManage }: Props) {
  const [activeForm, setActiveForm] = React.useState<"member" | "meeting" | null>(null)

  const userName = React.useCallback(
    (id: string) => users.find((u) => u.id === id)?.name ?? id,
    [users],
  )

  const meetingIds = React.useMemo(() => new Set(meetings.map((m) => m.id)), [meetings])
  const committeeAgreements = React.useMemo(
    () => agreements.filter((a) => meetingIds.has(a.meetingId)),
    [agreements, meetingIds],
  )

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Integrantes</h3>
          {canManage ? (
            <Button
              size="sm"
              variant={activeForm === "member" ? "ghost" : "secondary"}
              onClick={() => setActiveForm((f) => (f === "member" ? null : "member"))}
            >
              <Plus size={14} className="mr-1" />
              {activeForm === "member" ? "Cancelar" : "Agregar integrante"}
            </Button>
          ) : null}
        </div>
        {activeForm === "member" ? (
          <MemberForm
            committeeId={committee.id}
            users={users}
            onDone={() => setActiveForm(null)}
          />
        ) : null}
        {members.length === 0 ? (
          <p className="text-sm text-[var(--color-text-subtle)]">Sin integrantes registrados.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <span className="font-medium">{userName(m.userId)}</span>
                <span className="text-[var(--color-text-subtle)]">— {m.role}</span>
                {m.endDate ? <Badge variant="default">Finalizado</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Reuniones</h3>
          {canManage ? (
            <Button
              size="sm"
              variant={activeForm === "meeting" ? "ghost" : "secondary"}
              onClick={() => setActiveForm((f) => (f === "meeting" ? null : "meeting"))}
            >
              <Plus size={14} className="mr-1" />
              {activeForm === "meeting" ? "Cancelar" : "Agendar reunión"}
            </Button>
          ) : null}
        </div>
        {activeForm === "meeting" ? (
          <MeetingForm
            committeeId={committee.id}
            members={members}
            users={users}
            onDone={() => setActiveForm(null)}
          />
        ) : null}
        {meetings.length === 0 ? (
          <p className="text-sm text-[var(--color-text-subtle)]">Sin reuniones agendadas.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {meetings.map((meeting) => (
              <li key={meeting.id} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">
                      {new Date(meeting.scheduledAt).toLocaleString("es-CL")}
                    </p>
                    <p className="text-xs text-[var(--color-text-subtle)]">{meeting.agenda}</p>
                  </div>
                  <Badge variant={meeting.heldAt ? "success" : "warning"}>
                    {meeting.heldAt ? "Realizada" : "Agendada"}
                  </Badge>
                </div>
                <MeetingAgreements
                  meetingId={meeting.id}
                  agreements={committeeAgreements.filter((a) => a.meetingId === meeting.id)}
                  users={users}
                  canManage={canManage}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MeetingAgreements({
  meetingId,
  agreements,
  users,
  canManage,
}: {
  meetingId: string
  agreements: CommitteeAgreement[]
  users: { id: string; name: string }[]
  canManage: boolean
}) {
  const [showForm, setShowForm] = React.useState(false)

  const userName = React.useCallback(
    (id: string) => users.find((u) => u.id === id)?.name ?? id,
    [users],
  )

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Acuerdos</p>
        {canManage ? (
          <Button size="sm" variant="ghost" onClick={() => setShowForm((s) => !s)}>
            <Plus size={12} className="mr-1" />
            {showForm ? "Cancelar" : "Agregar acuerdo"}
          </Button>
        ) : null}
      </div>
      {showForm ? (
        <AgreementForm meetingId={meetingId} users={users} onDone={() => setShowForm(false)} />
      ) : null}
      {agreements.length === 0 ? (
        <p className="text-xs text-[var(--color-text-subtle)]">Sin acuerdos registrados.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {agreements.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-xs text-[var(--color-text)]">
              <span>
                {a.description} — <span className="text-[var(--color-text-subtle)]">{userName(a.responsibleId)}, vence {a.dueDate}</span>
              </span>
              <Badge variant={AGREEMENT_STATUS_VARIANTS[a.status] ?? "default"} size="sm">
                {AGREEMENT_STATUS_LABELS[a.status] ?? a.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
