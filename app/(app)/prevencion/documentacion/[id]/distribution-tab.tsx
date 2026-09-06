"use client"

import { useMemo, useState, useTransition } from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import {
  acknowledgeSstDocumentVersionAction,
  assignSstDocumentRecipientsAction,
  exemptSstDocumentRecipientAction,
} from "../actions"
import type { DocumentBundle, DetailViewProps } from "./document-detail.helpers"

interface Props {
  documentId: string
  currentVersionId: string | null
  distribution: DocumentBundle["distribution"]
  acks: DocumentBundle["acks"]
  userMap: DetailViewProps["userMap"]
  recipientOptions: DetailViewProps["recipientOptions"]
  currentUserId: string
  canDistribute: boolean
  canAck: boolean
  isArchived: boolean
  onChanged: () => void
}

export function DistributionTab(props: Props) {
  const {
    documentId,
    currentVersionId,
    distribution,
    acks,
    userMap,
    recipientOptions,
    currentUserId,
    canDistribute,
    canAck,
    isArchived,
    onChanged,
  } = props
  const [recipientId, setRecipientId] = useState("")
  const [reason, setReason] = useState("")
  const [isPending, startTransition] = useTransition()
  const currentTargets = useMemo(
    () => distribution.filter((target) => target.versionId === currentVersionId),
    [currentVersionId, distribution],
  )
  const currentUserWorkerId = recipientOptions.find((option) => option.id === currentUserId)?.workerId ?? null
  const myTarget = currentTargets.find((target) =>
    target.userId === currentUserId
    || Boolean(currentUserWorkerId && target.workerId === currentUserWorkerId),
  )
  const alreadyAcknowledged = currentVersionId
    ? acks.some((ack) => ack.versionId === currentVersionId && ack.userId === currentUserId)
    : false

  return (
    <div className="space-y-4">
      {canAck && myTarget?.status === "pendiente" && !alreadyAcknowledged && currentVersionId ? (
        <Card>
          <CardHeader><CardTitle>Tu acuse está pendiente</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-[var(--color-text-muted)]">
              Al acusar recibo se firma esta versión exacta y su checksum; el acuse no se traslada a versiones futuras.
            </p>
            <Button
              disabled={isPending}
              onClick={() => runAction(() => acknowledgeSstDocumentVersionAction({ documentId, versionId: currentVersionId }))}
            >
              Acusar recibo
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canDistribute && currentVersionId && !isArchived ? (
        <Card>
          <CardHeader><CardTitle>Asignar destinatario</CardTitle></CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_minmax(18rem,2fr)_auto] md:items-end"
              onSubmit={(event) => {
                event.preventDefault()
                if (!recipientId || reason.trim().length < 3) {
                  toast.error("Selecciona un destinatario y registra el motivo de asignación.")
                  return
                }
                runAction(async () => {
                  const result = await assignSstDocumentRecipientsAction({
                    documentId,
                    versionId: currentVersionId,
                    userIds: [recipientId],
                    assignmentReason: reason.trim(),
                  })
                  if (result.ok) {
                    setRecipientId("")
                    setReason("")
                  }
                  return result
                })
              }}
            >
              <Field label="Destinatario" htmlFor="document-recipient" required>
                <Select value={recipientId} onValueChange={setRecipientId} searchable>
                  <SelectTrigger id="document-recipient">
                    <SelectValue placeholder="Seleccionar persona" />
                  </SelectTrigger>
                  <SelectContent>
                    {recipientOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id} textValue={`${option.name} ${option.email}`}>
                        {option.name} · {option.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Motivo de asignación" htmlFor="document-assignment-reason" required>
                <Input
                  id="document-assignment-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ej.: procedimiento aplicable a su cargo"
                />
              </Field>
              <Button type="submit" disabled={isPending}>Asignar</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            Distribución nominativa · {currentTargets.filter((target) => target.status === "pendiente").length} pendiente(s)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {currentTargets.length === 0 ? (
            <EmptyState
              title="Sin destinatarios asignados"
              description="Asigna individualmente a quienes deban conocer y acusar esta versión vigente."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destinatario</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Asignado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentTargets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell>
                      <p className="text-sm font-medium">
                        {target.userId ? userMap[target.userId]?.name ?? target.userId : `Trabajador ${target.workerId}`}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">{target.assignmentReason}</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {[target.positionSnapshot, target.companySnapshot].filter(Boolean).join(" · ") || "Sin snapshot"}
                    </TableCell>
                    <TableCell className="text-xs">{target.assignedAt.slice(0, 10)}</TableCell>
                    <TableCell><DistributionStatus status={target.status} /></TableCell>
                    <TableCell>
                      {canDistribute && target.status === "pendiente" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => exemptTarget(target.id)}
                        >
                          Eximir
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )

  function exemptTarget(targetId: string) {
    const exemptionReason = window.prompt("Motivo de la exención:")?.trim()
    if (!exemptionReason) return
    runAction(() => exemptSstDocumentRecipientAction({ documentId, targetId, reason: exemptionReason }))
  }

  function runAction(operation: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await operation()
      if (result.ok) {
        toast.success(result.message ?? "Distribución actualizada.")
        onChanged()
      } else {
        toast.error(result.message ?? "No se pudo actualizar la distribución.")
      }
    })
  }
}

function DistributionStatus({ status }: { status: string }) {
  if (status === "acusado") return <MetaBadge meta={{ label: "Acusado", variant: "success" }} />
  if (status === "exento") return <MetaBadge meta={{ label: "Exento", variant: "outline" }} />
  return <MetaBadge meta={{ label: "Pendiente", variant: "warning" }} />
}
