"use client"

import * as React from "react"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { HardHat, CaretDown, CaretUp } from "@phosphor-icons/react"
import type { PermitRequest, PermitSignoff, PermitTemplate } from "@/db/schema"
import { PERMIT_STATUS_LABELS, PERMIT_STATUS_VARIANTS } from "@/lib/prevention/badges"
import { PermisoDetail } from "./permiso-detail"

interface Props {
  permits: PermitRequest[]
  templates: PermitTemplate[]
  worksites: { id: string; name: string }[]
  signoffs: PermitSignoff[]
  canManage: boolean
}

export function PermisosList({ permits, templates, worksites, signoffs, canManage }: Props) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  const templateById = React.useCallback(
    (id: string) => templates.find((t) => t.id === id),
    [templates],
  )
  const worksiteName = React.useCallback(
    (id: string) => worksites.find((w) => w.id === id)?.name ?? id,
    [worksites],
  )

  if (permits.length === 0) {
    return (
      <EmptyState
        icon={<HardHat size={28} />}
        title="Sin solicitudes de permiso"
        description="Solicita un permiso de trabajo (AST) para empezar el flujo de aprobación y firmas."
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
            <TableHead>Plantilla</TableHead>
            <TableHead>Tarea</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {permits.map((p) => {
            const isOpen = expandedId === p.id
            const template = templateById(p.templateId)
            return (
              <React.Fragment key={p.id}>
                <TableRow className="cursor-pointer" onClick={() => setExpandedId(isOpen ? null : p.id)} aria-expanded={isOpen}>
                  <TableCell>
                    <Button variant="ghost" size="icon-sm" aria-label={isOpen ? "Contraer" : "Expandir"}>
                      {isOpen ? <CaretUp size={14} /> : <CaretDown size={14} />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{worksiteName(p.worksiteId)}</TableCell>
                  <TableCell>{template?.title ?? p.templateId}</TableCell>
                  <TableCell className="max-w-xs truncate">{p.task}</TableCell>
                  <TableCell>
                    <Badge variant={PERMIT_STATUS_VARIANTS[p.status] ?? "default"}>
                      {PERMIT_STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-[var(--color-surface-2)] p-0">
                      <PermisoDetail
                        permit={p}
                        template={template}
                        signoffs={signoffs.filter((s) => s.permitId === p.id)}
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
