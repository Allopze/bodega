"use client"

import * as React from "react"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { WarningDiamond, Plus } from "@phosphor-icons/react"
import type { IperMatrix } from "@/db/schema"
import { IperForm } from "./iper-form"
import { formatDateDisplay } from "@/lib/sst/date"
import { IPER_STATUS_LABELS, IPER_STATUS_VARIANTS } from "@/lib/prevention/badges"

interface Props {
  matrices: IperMatrix[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  showForm: boolean
  onShowFormChange: (show: boolean) => void
}

export function IperList({ matrices, worksites, canManage, showForm, onShowFormChange }: Props) {
  const worksiteName = React.useCallback(
    (id: string) => worksites.find((w) => w.id === id)?.name ?? id,
    [worksites],
  )

  if (matrices.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<WarningDiamond size={28} />}
          title="Sin matrices de riesgos"
          description="No hay matrices de identificación de peligros y evaluación de riesgos registradas para tu alcance."
          action={
            canManage ? (
              <Button onClick={() => onShowFormChange(true)}>
                <Plus size={16} className="mr-1" />
                Nueva matriz de riesgos
              </Button>
            ) : undefined
          }
        />
        {canManage && showForm ? (
          <IperForm worksites={worksites} onDone={() => onShowFormChange(false)} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && showForm ? (
        <IperForm worksites={worksites} onDone={() => onShowFormChange(false)} />
      ) : null}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Versión</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrices.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.code}</TableCell>
                <TableCell className="font-medium">{m.title}</TableCell>
                <TableCell>{worksiteName(m.worksiteId)}</TableCell>
                <TableCell className="font-mono">v{m.version}</TableCell>
                <TableCell>{formatDateDisplay(m.effectiveFrom.slice(0, 10))}</TableCell>
                <TableCell>
                  <Badge variant={IPER_STATUS_VARIANTS[m.status] ?? "default"}>
                    {IPER_STATUS_LABELS[m.status] ?? m.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}
