"use client"

/**
 * Clasificar un documento ya cargado: declarar qué es (tipo) y de qué faena.
 * Es lo que le faltaba a todo lo que entró por la carga masiva o antes de la
 * subida tipada: sin tipo, un documento no acredita nada del programa
 * preventivo ni cuenta en la carpeta de requisitos legales.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { toast } from "@/lib/toast"
import { classifySstDocumentAction } from "../actions"
import { DocumentWorksiteField, type TypedUploadTypeOption, type TypedUploadWorksiteOption } from "../typed-upload-form"

export function ClassifyDocumentDialog({
  documentId,
  currentTypeId,
  currentWorksiteId,
  types,
  worksites,
  canUseCorporate,
}: {
  documentId: string
  currentTypeId: string | null
  currentWorksiteId: string | null
  types: TypedUploadTypeOption[]
  worksites: TypedUploadWorksiteOption[]
  canUseCorporate: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [typeId, setTypeId] = React.useState(currentTypeId ?? "")
  const [worksiteId, setWorksiteId] = React.useState(currentWorksiteId ?? "")
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  const options: ComboboxOption[] = React.useMemo(() => types.map((type) => ({
    value: type.id,
    label: type.name,
    hint: `${type.categoryName} · ${type.code}`,
  })), [types])

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await classifySstDocumentAction({ documentId, typeId, worksiteId: worksiteId || null })
      if (!result.ok) {
        setError(result.message ?? "No se pudo clasificar el documento.")
        return
      }
      toast.success(result.message ?? "Documento clasificado.")
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setTypeId(currentTypeId ?? ""); setWorksiteId(currentWorksiteId ?? ""); setError(null) } }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={currentTypeId ? "secondary" : "primary"}>
          {currentTypeId ? "Cambiar clasificación" : "Clasificar documento"}
        </Button>
      </DialogTrigger>
      <DialogContent
        // Con un tipo ya declarado, el foco inicial en su buscador lo desplegaría
        // y ocultaría la clasificación actual.
        onOpenAutoFocus={currentTypeId ? (event) => { event.preventDefault(); document.getElementById("classify-worksite")?.focus() } : undefined}
      >
        <DialogHeader>
          <DialogTitle>Clasificar documento</DialogTitle>
          <DialogDescription>El tipo define qué acredita en el programa preventivo; la faena, en qué carpeta cuenta.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-3">
          <Field label="Tipo de documento" htmlFor="classify-type" required>
            <Combobox id="classify-type" options={options} value={typeId} onChange={setTypeId} placeholder="Busca el tipo" disabled={pending} />
          </Field>
          <DocumentWorksiteField
            id="classify-worksite"
            worksites={worksites}
            value={worksiteId}
            onChange={setWorksiteId}
            canUseCorporate={canUseCorporate}
            disabled={pending}
          />
          {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
          <Button type="button" size="sm" onClick={save} disabled={pending || !typeId || (!canUseCorporate && !worksiteId)}>
            {pending ? "Guardando..." : "Guardar clasificación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
