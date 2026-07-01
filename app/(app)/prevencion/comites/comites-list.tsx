"use client"

import * as React from "react"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { UsersThree, CaretDown, CaretUp } from "@phosphor-icons/react"
import type { Committee, CommitteeMember, CommitteeMeeting, CommitteeAgreement } from "@/db/schema"
import { COMMITTEE_STATUS_LABELS, COMMITTEE_STATUS_VARIANTS } from "@/lib/prevention/badges"
import { CommitteeDetail } from "./committee-detail"

interface Props {
  committees: Committee[]
  worksites: { id: string; name: string }[]
  users: { id: string; name: string }[]
  members: CommitteeMember[]
  meetings: CommitteeMeeting[]
  agreements: CommitteeAgreement[]
  canManage: boolean
}

export function ComitesList({ committees, worksites, users, members, meetings, agreements, canManage }: Props) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  const worksiteName = React.useCallback(
    (id: string) => worksites.find((w) => w.id === id)?.name ?? id,
    [worksites],
  )

  if (committees.length === 0) {
    return (
      <EmptyState
        icon={<UsersThree size={28} />}
        title="Sin comités registrados"
        description="Crea un comité (CPHS, bipartito de capacitación, etc.) para empezar a agendar reuniones y registrar acuerdos."
      />
    )
  }

  return (
    <TableRoot>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead aria-hidden className="w-8" />
            <TableHead>Faena</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {committees.map((c) => {
            const isOpen = expandedId === c.id
            return (
              <React.Fragment key={c.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setExpandedId(isOpen ? null : c.id)}
                  aria-expanded={isOpen}
                >
                  <TableCell>
                    <Button variant="ghost" size="icon-sm" aria-label={isOpen ? "Contraer" : "Expandir"}>
                      {isOpen ? <CaretUp size={14} /> : <CaretDown size={14} />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{worksiteName(c.worksiteId)}</TableCell>
                  <TableCell>{c.type}</TableCell>
                  <TableCell>
                    <Badge variant={COMMITTEE_STATUS_VARIANTS[c.status] ?? "default"}>
                      {COMMITTEE_STATUS_LABELS[c.status] ?? c.status}
                    </Badge>
                  </TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="bg-[var(--color-surface-2)] p-0">
                      <CommitteeDetail
                        committee={c}
                        users={users}
                        members={members.filter((m) => m.committeeId === c.id)}
                        meetings={meetings.filter((m) => m.committeeId === c.id)}
                        agreements={agreements}
                        canManage={canManage}
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
