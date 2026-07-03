"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowCounterClockwise, FileText, FolderOpen } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { restoreSstDocumentAction, restoreSstDocumentFolderAction } from "../actions"

interface ArchivedFolder {
  id: string
  name: string
  worksiteName: string | null
  archivedAt: string | null
}

interface ArchivedDocument {
  id: string
  title: string
  internalCode: string | null
  worksiteName: string | null
  updatedAt: string
}

interface Props {
  folders: ArchivedFolder[]
  documents: ArchivedDocument[]
  canRestore: boolean
}

export function PapeleraView({ folders, documents, canRestore }: Props) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  const restoreFolder = React.useCallback((id: string, name: string) => {
    startTransition(async () => {
      const res = await restoreSstDocumentFolderAction({ id })
      if (res.ok) {
        toast.success(`Carpeta "${name}" restaurada.`)
        router.refresh()
      } else {
        toast.error(res.message ?? "No se pudo restaurar la carpeta.")
      }
    })
  }, [router])

  const restoreDocument = React.useCallback((documentId: string, title: string) => {
    startTransition(async () => {
      const res = await restoreSstDocumentAction({ documentId })
      if (res.ok) {
        toast.success(`Documento "${title}" restaurado como borrador.`)
        router.refresh()
      } else {
        toast.error(res.message ?? "No se pudo restaurar el documento.")
      }
    })
  }, [router])

  const isEmpty = folders.length === 0 && documents.length === 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-(--color-text-subtle)">
          Elementos archivados. Restaurar una carpeta la devuelve a su ubicación; restaurar un documento lo deja como borrador.
        </p>
        <Button asChild size="sm" variant="secondary">
          <Link href="/prevencion/documentacion">Volver a documentación</Link>
        </Button>
      </div>

      {isEmpty ? (
        <EmptyState title="Papelera vacía" description="No hay carpetas ni documentos archivados." />
      ) : (
        <>
          {folders.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-(--color-text-subtle)">Carpetas archivadas ({folders.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Faena</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {folders.map((folder) => (
                      <TableRow key={folder.id}>
                        <TableCell>
                          <span className="inline-flex items-center gap-2 font-medium text-(--color-text)">
                            <FolderOpen size={18} weight="duotone" className="text-(--color-text-subtle)" />
                            {folder.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{folder.worksiteName ?? "Global"}</TableCell>
                        <TableCell className="text-right">
                          {canRestore && (
                            <Button type="button" size="sm" variant="secondary" onClick={() => restoreFolder(folder.id, folder.name)} disabled={pending}>
                              <ArrowCounterClockwise size={14} className="mr-1" />
                              Restaurar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {documents.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-(--color-text-subtle)">Documentos archivados ({documents.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Documento</TableHead>
                      <TableHead>Faena</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="inline-flex items-center gap-2 font-medium text-(--color-text)">
                              <FileText size={18} className="text-(--color-text-subtle)" />
                              {d.title}
                            </span>
                            {d.internalCode && <span className="text-xs text-(--color-text-subtle)">{d.internalCode}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{d.worksiteName ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">Archivado</Badge></TableCell>
                        <TableCell className="text-right">
                          {canRestore && (
                            <Button type="button" size="sm" variant="secondary" onClick={() => restoreDocument(d.id, d.title)} disabled={pending}>
                              <ArrowCounterClockwise size={14} className="mr-1" />
                              Restaurar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
