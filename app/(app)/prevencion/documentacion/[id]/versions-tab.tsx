"use client"

import { useRef, useTransition } from "react"
import { UploadSimple } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Field } from "@/components/ui/field"
import { FileInput } from "@/components/ui/file-input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import {
  approveSstDocumentVersionAction,
  markSstDocumentVersionReviewedAction,
  observeSstDocumentVersionAction,
  publishSstDocumentVersionAction,
  returnObservedSstDocumentVersionToDraftAction,
  submitSstDocumentVersionForReviewAction,
  uploadSstDocumentVersionAction,
} from "../actions"
import type { DocumentBundle } from "./document-detail.helpers"

interface Props {
  versions: DocumentBundle["versions"]
  userMap: Record<string, { id: string; name: string; email: string }>
  currentVersionId: string | null
  documentId: string
  permissions: {
    manage: boolean
    submitReview: boolean
    review: boolean
    approve: boolean
    publish: boolean
  }
  currentUserId: string
  isArchived: boolean
  onUploaded: () => void
}

export function VersionsTab({
  versions,
  userMap,
  currentVersionId,
  documentId,
  permissions,
  currentUserId,
  isArchived,
  onUploaded,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<File | null>(null)

  return (
    <div className="space-y-4">
      {permissions.manage && !isArchived ? (
        <Card>
          <CardHeader><CardTitle>Subir nueva versión</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Field label="Archivo" htmlFor="version-file" required>
                <FileInput
                  id="version-file"
                  accept="application/pdf,image/jpeg,image/png,application/xml"
                  onChange={(file) => { fileRef.current = file }}
                />
              </Field>
              <Button type="button" disabled={isPending} onClick={uploadSelectedFile}>
                <UploadSimple size={14} className="mr-1" /> {isPending ? "Subiendo..." : "Subir versión"}
              </Button>
            </div>
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
                  <TableHead>Tamaño</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <span className="font-mono">v{v.version}</span>
                      {v.id === currentVersionId ? <Badge variant="outline" className="ml-2">Actual</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(v.status)}>{statusLabel(v.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{v.fileName}</TableCell>
                    <TableCell className="text-xs">{userMap[v.uploadedBy]?.name ?? v.uploadedBy}</TableCell>
                    <TableCell className="text-xs">{v.createdAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-xs">{formatFileSize(v.fileSize)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button asChild size="sm" variant="secondary">
                          <a href={`/api/prevencion/documentacion/${documentId}/version/${v.id}`} download>Descargar</a>
                        </Button>
                        {!isArchived ? renderWorkflowActions(v) : null}
                      </div>
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

  function uploadSelectedFile() {
    if (!fileRef.current) {
      toast.error("Selecciona un archivo.")
      return
    }
    const fd = new FormData()
    fd.set("file", fileRef.current)
    fd.set("documentId", documentId)
    startTransition(async () => {
      const res = await uploadSstDocumentVersionAction(fd)
      if (res.ok) {
        toast.success(res.message ?? "Versión subida.")
        fileRef.current = null
        onUploaded()
      } else {
        toast.error(res.message ?? "Error al subir la versión.")
      }
    })
  }

  function renderWorkflowActions(version: Props["versions"][number]) {
    const input = { documentId, versionId: version.id }
    if (version.status === "borrador" && permissions.submitReview) {
      return (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => runWorkflow(() => submitSstDocumentVersionForReviewAction(input))}
        >
          Enviar a revisión
        </Button>
      )
    }
    if (version.status === "observado" && permissions.submitReview && version.uploadedBy === currentUserId) {
      return (
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={() => runWorkflow(() => returnObservedSstDocumentVersionToDraftAction(input))}
        >
          Volver a borrador
        </Button>
      )
    }
    if (version.status === "en_revision") {
      return (
        <>
          {permissions.review && !version.reviewedBy ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() => runWorkflow(() => markSstDocumentVersionReviewedAction(input))}
            >
              Registrar revisión
            </Button>
          ) : null}
          {permissions.review ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() => observeVersion(input)}
            >
              Observar
            </Button>
          ) : null}
          {permissions.approve && version.reviewedBy ? (
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => runWorkflow(() => approveSstDocumentVersionAction(input))}
            >
              Aprobar
            </Button>
          ) : null}
        </>
      )
    }
    if (version.status === "aprobado" && permissions.publish) {
      return (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => runWorkflow(() => publishSstDocumentVersionAction(input))}
        >
          Publicar
        </Button>
      )
    }
    return null
  }

  function observeVersion(input: { documentId: string; versionId: string }) {
    const comment = window.prompt("Describe la observación que debe corregirse:")?.trim()
    if (!comment) return
    runWorkflow(() => observeSstDocumentVersionAction({ ...input, comment }))
  }

  function runWorkflow(operation: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await operation()
      if (result.ok) {
        toast.success(result.message ?? "Estado documental actualizado.")
        onUploaded()
      } else {
        toast.error(result.message ?? "No se pudo actualizar el estado documental.")
      }
    })
  }
}

function statusLabel(status: string) {
  return ({
    borrador: "Borrador",
    en_revision: "En revisión",
    observado: "Observado",
    aprobado: "Aprobado",
    vigente: "Vigente",
    reemplazado: "Reemplazado",
    archivado: "Archivado",
  } as Record<string, string>)[status] ?? status
}

function statusBadgeVariant(status: string): "default" | "info" | "warning" | "success" | "outline" {
  if (status === "vigente" || status === "aprobado") return "success"
  if (status === "en_revision") return "info"
  if (status === "observado") return "warning"
  if (status === "reemplazado" || status === "archivado") return "outline"
  return "default"
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
