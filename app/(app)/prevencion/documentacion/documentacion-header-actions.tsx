"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileArrowUp, FolderPlus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createAndUploadSstDocumentAction, createSstDocumentFolderAction } from "./actions"

interface Props {
  currentFolderId: string | null
}

/**
 * Sube archivos (o una carpeta completa) creando un documento por archivo con
 * metadata por defecto — la categoría la resuelve el server action. En subida
 * de carpeta se recrea la estructura usando `webkitRelativePath`.
 */
async function uploadFilesAsDocuments(
  files: File[],
  currentFolderId: string | null,
  onProgress: (done: number, failed: number) => void,
): Promise<void> {
  const folderCache = new Map<string, string | null>()
  folderCache.set("", currentFolderId ?? null)

  const ensureFolder = async (dirPath: string): Promise<string | null> => {
    if (folderCache.has(dirPath)) return folderCache.get(dirPath) ?? null
    const parts = dirPath.split("/")
    const name = parts[parts.length - 1] ?? ""
    const parentId = await ensureFolder(parts.slice(0, -1).join("/"))
    const res = await createSstDocumentFolderAction({ name, parentId })
    const id = res.ok && res.data ? res.data.id : parentId
    folderCache.set(dirPath, id)
    return id
  }

  let done = 0
  let failed = 0
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ""
    const dirPath = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : ""
    try {
      const folderId = await ensureFolder(dirPath)
      const fd = new FormData()
      fd.set("file", file)
      fd.set("title", file.name.replace(/\.[^.]+$/, ""))
      if (folderId) fd.set("folderId", folderId)
      const result = await createAndUploadSstDocumentAction(fd)
      if (!result.ok) failed++
    } catch {
      failed++
    }
    done++
    onProgress(done, failed)
  }
}

export function DocumentacionHeaderActions({ currentFolderId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [folderName, setFolderName] = React.useState("")

  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<{ done: number; total: number; failed: number } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const folderInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    // `webkitdirectory` no está en los tipos de React; se activa por ref.
    const el = folderInputRef.current
    if (el) {
      el.setAttribute("webkitdirectory", "")
      el.setAttribute("directory", "")
    }
  }, [uploadOpen])

  function createFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = folderName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await createSstDocumentFolderAction({ name, parentId: currentFolderId })
      if (result.ok) {
        setFolderName("")
        router.refresh()
      }
    })
  }

  const handleUpload = React.useCallback((files: File[]) => {
    if (files.length === 0 || busy) return
    setBusy(true)
    setProgress({ done: 0, total: files.length, failed: 0 })
    void (async () => {
      await uploadFilesAsDocuments(files, currentFolderId, (done, failed) =>
        setProgress({ done, total: files.length, failed }),
      )
      router.refresh()
      setBusy(false)
    })()
  }, [busy, currentFolderId, router])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm">
            <FolderPlus size={16} className="mr-1" />
            Nueva carpeta
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={createFolder}>
            <DialogHeader>
              <DialogTitle>Nueva carpeta</DialogTitle>
              <DialogDescription>Se creará dentro de la ubicación actual.</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              placeholder="Nombre de carpeta"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
            />
            <DialogFooter>
              <Button type="submit" disabled={pending || !folderName.trim()}>
                Crear carpeta
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (busy) return
          setUploadOpen(open)
          if (!open) setProgress(null)
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" size="sm">
            <FileArrowUp size={16} className="mr-1" />
            Subir archivo
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subir documentos</DialogTitle>
            <DialogDescription>
              Sube archivos o una carpeta completa a esta ubicación. Cada archivo se registra como un documento.
            </DialogDescription>
          </DialogHeader>

          <div
            aria-label="Zona para subir documentos"
            className="rounded-lg border border-dashed border-(--color-border) bg-(--color-surface) px-4 py-8 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              handleUpload(Array.from(event.dataTransfer.files))
            }}
          >
            <p className="text-sm text-(--color-text-subtle)">Arrastra archivos aquí o usa los botones.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                Subir archivos
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => folderInputRef.current?.click()}>
                Subir carpeta
              </Button>
            </div>
            {progress && (
              <p className="mt-3 text-xs text-(--color-text-subtle)">
                {busy
                  ? `Subiendo ${progress.done} de ${progress.total}...`
                  : `Listo: ${progress.done - progress.failed} de ${progress.total} subidos`}
                {progress.failed > 0 ? ` · ${progress.failed} con error` : ""}
              </p>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ""
              handleUpload(files)
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ""
              handleUpload(files)
            }}
          />
        </DialogContent>
      </Dialog>

      <Button asChild size="sm" variant="secondary">
        <Link href="/prevencion/documentacion/papelera">Papelera</Link>
      </Button>
    </div>
  )
}
