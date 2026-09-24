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
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createSstDocumentFolderAction } from "./actions"
import { uploadFilesAsDocuments } from "./documentacion-upload"
import { TypedUploadForm, type TypedUploadTypeOption, type TypedUploadWorksiteOption } from "./typed-upload-form"

interface Props {
  currentFolderId: string | null
  /** Faena de la carpeta abierta: lo que se suba ahí es de esa faena. */
  folderWorksiteId: string | null
  documentTypes: TypedUploadTypeOption[]
  worksites: TypedUploadWorksiteOption[]
  canUploadCorporate: boolean
  /** Llegada desde el programa preventivo (`?tipo=`/`?faena=`): abre el diálogo prellenado. */
  initialTypeId?: string
  initialWorksiteId?: string | null
}

export function DocumentacionHeaderActions({
  currentFolderId,
  folderWorksiteId,
  documentTypes,
  worksites,
  canUploadCorporate,
  initialTypeId,
  initialWorksiteId,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [folderOpen, setFolderOpen] = React.useState(false)
  const [folderName, setFolderName] = React.useState("")

  const [uploadOpen, setUploadOpen] = React.useState(Boolean(initialTypeId))
  // Clasificado es el camino por defecto: es el único que dice qué es el
  // documento y, con eso, qué acredita. La carga masiva queda para migrar
  // carpetas enteras, sin efecto en el programa hasta clasificarlas.
  const [uploadMode, setUploadMode] = React.useState<"typed" | "bulk">("typed")
  const [busy, setBusy] = React.useState(false)
  const [dataClass, setDataClass] = React.useState<"" | "operational" | "personal" | "sensitive_preventive" | "client_secret">("")
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
  }, [uploadOpen, uploadMode])

  function createFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = folderName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await createSstDocumentFolderAction({ name, parentId: currentFolderId })
      if (result.ok) {
        setFolderName("")
        setFolderOpen(false)
        router.refresh()
      }
    })
  }

  const handleUpload = React.useCallback((files: File[]) => {
    if (files.length === 0 || busy || !dataClass) return
    setBusy(true)
    setProgress({ done: 0, total: files.length, failed: 0 })
    void (async () => {
      await uploadFilesAsDocuments(files, currentFolderId, dataClass, (done, failed) =>
        setProgress({ done, total: files.length, failed }),
      )
      router.refresh()
      setBusy(false)
    })()
  }, [busy, currentFolderId, dataClass, router])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog
        open={folderOpen}
        onOpenChange={(open) => {
          setFolderOpen(open)
          if (!open) setFolderName("")
        }}
      >
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
          if (!open) {
            setProgress(null)
            setDataClass("")
            setUploadMode("typed")
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" size="sm">
            <FileArrowUp size={16} className="mr-1" />
            Subir documento
          </Button>
        </DialogTrigger>
        <DialogContent
          className="sm:max-w-2xl"
          // Llegada con el tipo declarado (`?tipo=`): el foco va al archivo, no al
          // buscador de tipo, que al abrirse ocultaría el tipo elegido.
          onOpenAutoFocus={initialTypeId ? (event) => { event.preventDefault(); document.getElementById("typed-upload-file")?.focus() } : undefined}
        >
          <DialogHeader>
            <DialogTitle>Subir documento</DialogTitle>
            <DialogDescription>
              {uploadMode === "typed"
                ? "Declara qué documento es y de qué faena, y adjúntalo."
                : "Sube archivos o una carpeta completa a esta ubicación. Quedan sin clasificar y en borrador."}
            </DialogDescription>
          </DialogHeader>

          <SegmentedControl
            ariaLabel="Modo de carga"
            variant="segmented"
            items={[
              { key: "typed", label: "Documento clasificado", active: uploadMode === "typed", onClick: () => setUploadMode("typed") },
              { key: "bulk", label: "Carga masiva (sin clasificar)", active: uploadMode === "bulk", onClick: () => setUploadMode("bulk") },
            ]}
          />

          {uploadMode === "typed" ? (
            <TypedUploadForm
              types={documentTypes}
              worksites={worksites}
              canUploadCorporate={canUploadCorporate}
              currentFolderId={currentFolderId}
              folderWorksiteId={folderWorksiteId}
              initialTypeId={initialTypeId}
              initialWorksiteId={initialWorksiteId}
              onDone={() => setUploadOpen(false)}
              onCancel={() => setUploadOpen(false)}
            />
          ) : (<>
          <div className="space-y-2">
            <label htmlFor="document-data-class" className="text-sm font-medium text-(--color-text)">
              Clasificación obligatoria
            </label>
            <Select
              value={dataClass}
              onValueChange={(value) => setDataClass(value as Exclude<typeof dataClass, "">)}
              disabled={busy}
            >
              <SelectTrigger id="document-data-class" aria-label="Clasificación del documento">
                <SelectValue placeholder="Selecciona antes de cargar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operational">Operacional</SelectItem>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="sensitive_preventive">Sensible preventivo</SelectItem>
                <SelectItem value="client_secret">Secreto de cliente</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-(--color-text-subtle)">
              Fichas clínicas, diagnósticos y denuncias reservadas no se cargan en esta biblioteca.
            </p>
          </div>

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
              <Button type="button" size="sm" disabled={busy || !dataClass} onClick={() => fileInputRef.current?.click()}>
                Subir archivos
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy || !dataClass} onClick={() => folderInputRef.current?.click()}>
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
          </>)}
        </DialogContent>
      </Dialog>

      <Button asChild size="sm" variant="secondary">
        <Link href="/prevencion/documentacion/papelera">Papelera</Link>
      </Button>
    </div>
  )
}
