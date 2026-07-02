"use client"

import { useState, useTransition } from "react"
import { UploadSimple } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { uploadSstDocumentVersionAction } from "../actions"
import type { DocumentBundle } from "./document-detail.helpers"
import { STATUS_LABELS, STATUS_TONES } from "./document-detail.helpers"

interface Props {
  versions: DocumentBundle["versions"]
  userMap: Record<string, { id: string; name: string; email: string }>
  currentVersionId: string | null
  documentId: string
  canManage: boolean
  isArchived: boolean
  onUploaded: () => void
}

export function VersionsTab({ versions, userMap, currentVersionId, documentId, canManage, isArchived, onUploaded }: Props) {
  const [isPending, startTransition] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const [changelog, setChangelog] = useState("")

  return (
    <div className="space-y-4">
      {canManage && !isArchived ? (
        <Card>
          <CardHeader><CardTitle>Subir nueva versión</CardTitle></CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!file) {
                  toast.error("Selecciona un archivo.")
                  return
                }
                const fd = new FormData()
                fd.set("file", file)
                fd.set("documentId", documentId)
                fd.set("changelog", changelog)
                startTransition(async () => {
                  const res = await uploadSstDocumentVersionAction(fd)
                  if (res.ok) {
                    toast.success(res.message ?? "Versión subida.")
                    setFile(null)
                    setChangelog("")
                    onUploaded()
                  } else {
                    toast.error(res.message ?? "Error al subir la versión.")
                  }
                })
              }}
            >
              <Field label="Archivo" htmlFor="version-file" required>
                <Input
                  id="version-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,application/xml"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              <Field label="Motivo del cambio" htmlFor="version-changelog">
                <Textarea
                  id="version-changelog"
                  rows={2}
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  placeholder="Qué cambió respecto a la versión anterior"
                />
              </Field>
              <Button type="submit" disabled={isPending}>
                <UploadSimple size={14} className="mr-1" /> {isPending ? "Subiendo..." : "Subir versión"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Historial de versiones</CardTitle></CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <EmptyState title="Sin versiones" description="Sube la primera versión del documento." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Subido por</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Changelog</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <span className="font-mono">v{v.version}</span>
                      {v.id === currentVersionId ? <Badge variant="success" className="ml-2">Vigente</Badge> : null}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_TONES[v.status] ?? "default"}>{STATUS_LABELS[v.status] ?? v.status}</Badge></TableCell>
                    <TableCell className="text-xs">{v.fileName}</TableCell>
                    <TableCell className="text-xs">{userMap[v.uploadedBy]?.name ?? v.uploadedBy}</TableCell>
                    <TableCell className="text-xs">{v.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-xs">{v.changelog ?? "—"}</TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="secondary">
                        <a href={`/api/prevencion/documentacion/${documentId}/version/${v.id}`} download>Descargar</a>
                      </Button>
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
