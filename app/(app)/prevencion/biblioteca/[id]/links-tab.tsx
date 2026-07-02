"use client"

import { useState, useTransition } from "react"
import { X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { linkSstDocumentAction, unlinkSstDocumentAction } from "../actions"
import type { DocumentBundle } from "./document-detail.helpers"
import { LINK_TYPE_LABELS } from "./document-detail.helpers"

interface Props {
  documentId: string
  links: DocumentBundle["links"]
  linkEnrichment: Record<string, Record<string, string>>
  worksiteMap: Record<string, { id: string; name: string }>
  canLink: boolean
  onChanged: () => void
}

export function LinksTab({ documentId, links, linkEnrichment, worksiteMap, canLink, onChanged }: Props) {
  const [isPending, startTransition] = useTransition()
  const [entityType, setEntityType] = useState("worker")
  const [entityId, setEntityId] = useState("")
  const [notes, setNotes] = useState("")

  function labelFor(entityType: string, entityId: string) {
    if (entityType === "worksite") return worksiteMap[entityId]?.name ?? entityId
    return linkEnrichment[entityType]?.[entityId] ?? entityId
  }

  return (
    <div className="space-y-4">
      {canLink ? (
        <Card>
          <CardHeader><CardTitle>Asociar a una entidad</CardTitle></CardHeader>
          <CardContent>
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (!entityId) {
                  toast.error("Indica el id de la entidad.")
                  return
                }
                startTransition(async () => {
                  const res = await linkSstDocumentAction({
                    documentId,
                    entityType: entityType as "worker" | "worksite" | "vehicle" | "equipment" | "incident" | "training" | "committee" | "epp_delivery" | "corrective_action" | "emergency_plan",
                    entityId,
                    notes,
                  })
                  if (res.ok) {
                    toast.success("Asociación creada.")
                    setEntityId("")
                    setNotes("")
                    onChanged()
                  } else {
                    toast.error(res.message ?? "Error al asociar.")
                  }
                })
              }}
            >
              <Field label="Tipo de entidad">
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LINK_TYPE_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ID de la entidad">
                <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="id interno" />
              </Field>
              <Field label="Notas" className="md:col-span-2">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="md:col-span-4 flex justify-end">
                <Button type="submit" disabled={isPending}>Asociar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Entidades asociadas</CardTitle></CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <EmptyState title="Sin asociaciones" description="Asocia este documento a trabajadores, vehículos, faenas, etc." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Entidad</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{LINK_TYPE_LABELS[l.entityType] ?? l.entityType}</TableCell>
                    <TableCell className="text-xs">{labelFor(l.entityType, l.entityId)}</TableCell>
                    <TableCell className="text-xs">{l.notes ?? "—"}</TableCell>
                    <TableCell>
                      {canLink ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => startTransition(async () => {
                            const res = await unlinkSstDocumentAction({ linkId: l.id })
                            if (res.ok) { toast.success("Asociación eliminada."); onChanged() }
                            else { toast.error(res.message ?? "Error") }
                          })}
                        >
                          <X size={12} className="mr-1" /> Quitar
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
}
