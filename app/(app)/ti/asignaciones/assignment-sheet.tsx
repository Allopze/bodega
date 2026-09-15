"use client"

import * as React from "react"
import Image from "next/image"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton, SheetTrigger,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toLocalInputValue } from "@/lib/utils"
import { X, Plus, Camera } from "@phosphor-icons/react"
import { createAssignmentAction } from "./actions"
import { IT_ASSIGNMENT_KINDS, IT_PHYSICAL_STATES } from "@/lib/validation/ti"
import { IT_ASSIGNMENT_KIND_META, IT_PHYSICAL_STATE_META, ACCESSORY_SUGGESTIONS } from "@/lib/services/ti/constants"

interface AssignmentSheetProps {
  trigger: React.ReactNode
  assetId?: string
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  assets?: { id: string; code: string; status: string; typeName: string }[]
}

interface UploadedPhoto {
  id: string
  previewUrl: string
  caption: string
}

const ALL = "_all"

/**
 * CTA del encabezado. El botón se construye acá, en el cliente, y no lo recibe
 * la página: ver la nota de `SheetTrigger` en `@/components/ui/sheet`.
 */
export function AssignmentCta({
  workers,
  worksites,
  assets = [],
}: Omit<AssignmentSheetProps, "trigger" | "assetId">) {
  return (
    <AssignmentSheet
      trigger={<Button><Plus size={14} className="mr-1.5" /> Nueva entrega</Button>}
      workers={workers}
      worksites={worksites}
      assets={assets}
    />
  )
}

export function AssignmentSheet({ trigger, assetId, workers, worksites, assets = [] }: AssignmentSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [selectedAsset, setSelectedAsset] = React.useState(assetId ?? "")
  const [kind, setKind] = React.useState("delivery")
  const [deliveredAt, setDeliveredAt] = React.useState(toLocalInputValue(new Date()))
  const [physicalState, setPhysicalState] = React.useState("bueno")
  const [accessories, setAccessories] = React.useState<string[]>([])
  const [accessoryDraft, setAccessoryDraft] = React.useState("")
  const [photos, setPhotos] = React.useState<UploadedPhoto[]>([])
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const pendingPhotoIdsRef = React.useRef<string[]>([])

  React.useEffect(() => {
    pendingPhotoIdsRef.current = photos.map((photo) => photo.id)
  }, [photos])

  const previewUrlsRef = React.useRef<string[]>([])
  React.useEffect(() => {
    previewUrlsRef.current = photos.map((photo) => photo.previewUrl)
  }, [photos])
  React.useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  async function discardPendingPhotos(ids = pendingPhotoIdsRef.current) {
    await Promise.all(ids.map(async (id) => {
      await fetch(`/api/ti/photos/${id}`, { method: "DELETE" }).catch(() => undefined)
    }))
  }

  function closeSheet() {
    const pendingIds = pendingPhotoIdsRef.current
    pendingPhotoIdsRef.current = []
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
      return []
    })
    setOpen(false)
    if (pendingIds.length > 0) void discardPendingPhotos(pendingIds)
  }

  function removePhoto(photo: UploadedPhoto) {
    URL.revokeObjectURL(photo.previewUrl)
    pendingPhotoIdsRef.current = pendingPhotoIdsRef.current.filter((id) => id !== photo.id)
    setPhotos((current) => current.filter((item) => item.id !== photo.id))
    void discardPendingPhotos([photo.id])
  }

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createAssignmentAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Entrega registrada")
      pendingPhotoIdsRef.current = []
      setOpen(false)
      setPhotos((current) => {
        current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
        return []
      })
      setAccessories([])
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  const availableAssets = assetId ? assets : assets.filter((a) => ["disponible", "en_bodega"].includes(a.status))

  async function uploadPhoto(file: File, caption: string) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("stage", "delivery")
      form.append("caption", caption)
      const response = await fetch("/api/ti/photos", { method: "POST", body: form })
      let payload: { id?: unknown; error?: string } = {}
      try {
        payload = await response.json() as { id?: unknown; error?: string }
      } catch {
        // A proxy/runtime error can return an empty or non-JSON body.
      }
      if (!response.ok) {
        toast.error(payload.error ?? "No se pudo subir la fotografía")
        return
      }
      if (typeof payload.id !== "string" || !payload.id) {
        toast.error("La fotografía se subió sin un identificador válido")
        return
      }
      setPhotos((prev) => [...prev, { id: payload.id as string, previewUrl: URL.createObjectURL(file), caption }])
    } catch {
      toast.error("No se pudo subir la fotografía")
    } finally {
      setUploading(false)
    }
  }

  function addAccessory() {
    const name = accessoryDraft.trim()
    if (!name) return
    if (accessories.some((a) => a.toLowerCase() === name.toLowerCase())) return
    setAccessories((prev) => [...prev, name])
    setAccessoryDraft("")
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) closeSheet(); else setOpen(true) }}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="accessoriesJson" value={JSON.stringify(accessories)} />
          <input type="hidden" name="photoIdsJson" value={JSON.stringify(photos.map((p) => p.id))} />
          <input type="hidden" name="assetId" value={selectedAsset} />

          <SheetHeader>
            <div>
              <SheetTitle>Nueva entrega</SheetTitle>
              <SheetDescription>
                Registra la entrega del equipo con su estado físico, accesorios y evidencia fotográfica. Se genera el acta al guardar.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              {!assetId && (
                <Field label="Activo" required error={state.fieldErrors?.assetId?.[0]} helper="Solo se listan activos disponibles o en bodega.">
                  <Select value={selectedAsset || ALL} onValueChange={(value) => setSelectedAsset(value === ALL ? "" : value)}>
                    <SelectTrigger aria-label="Activo">
                      <SelectValue placeholder="Selecciona un activo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Selecciona un activo</SelectItem>
                      {availableAssets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} · {a.typeName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Trabajador" required error={state.fieldErrors?.workerId?.[0]}>
                  <Select name="workerId">
                    <SelectTrigger aria-label="Trabajador">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {workers.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name} {w.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Faena" required error={state.fieldErrors?.worksiteId?.[0]}>
                  <Select name="worksiteId">
                    <SelectTrigger aria-label="Faena">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Tipo" required>
                  <Select name="kind" value={kind} onValueChange={setKind}>
                    <SelectTrigger aria-label="Tipo de entrega">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_ASSIGNMENT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>{IT_ASSIGNMENT_KIND_META[k] ?? k}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Fecha y hora de entrega" required error={state.fieldErrors?.deliveredAt?.[0]}>
                  <DateTimePicker name="deliveredAt" value={deliveredAt} onChange={setDeliveredAt} />
                </Field>
                <Field label="Estado físico" required helper="Cómo se entrega el equipo.">
                  <Select name="physicalState" value={physicalState} onValueChange={setPhysicalState}>
                    <SelectTrigger aria-label="Estado físico">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_PHYSICAL_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{IT_PHYSICAL_STATE_META[s]?.label ?? s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {/*
                TIA-001 (auditoría 2026-09-14): aquí había una casilla
                —"confirmada por el técnico TI en representación del
                trabajador"— con la que quien entrega el equipo declaraba
                aceptada su propia acta. El acuse se registra ahora desde la
                lista de actas y lo hace una persona distinta del entregador.
              */}
              <Field label="Aceptación del trabajador" helper="El acta nace pendiente de acuse: lo registra después alguien distinto de quien entrega.">
                <p className="text-sm text-[var(--color-text-subtle)]">
                  Pendiente de acuse hasta que se registre desde el acta.
                </p>
              </Field>

              <Field label="Accesorios incluidos" helper="Cargador, mouse, bolso, dock…">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={accessoryDraft}
                      onChange={(e) => setAccessoryDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAccessory() } }}
                      placeholder="Escribe un accesorio y presiona Enter"
                      list="ti-accessory-suggestions"
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={addAccessory}>
                      <Plus size={14} />
                    </Button>
                    <datalist id="ti-accessory-suggestions">
                      {ACCESSORY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  {accessories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {accessories.map((acc) => (
                        <span key={acc} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs text-[var(--color-text)]">
                          {acc}
                          <button type="button" onClick={() => setAccessories((prev) => prev.filter((a) => a !== acc))} aria-label={`Quitar ${acc}`}>
                            <X size={11} className="text-[var(--color-text-subtle)]" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              <Field
                label="Evidencia fotográfica"
                helper="Fotos del estado físico al entregar: pantalla, tapa, teclado, costados, cargador y accesorios. Quedan asociadas a esta entrega para siempre."
              >
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    className="sr-only"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? [])
                      for (const file of files) await uploadPhoto(file, "")
                      e.target.value = ""
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera size={14} className="mr-1.5" />
                    {uploading ? "Subiendo..." : "Subir fotografías"}
                  </Button>
                  {photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {photos.map((photo) => (
                        <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-[var(--color-border)]">
                          <Image src={photo.previewUrl} alt="Evidencia de entrega" width={200} height={150} className="aspect-[4/3] w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removePhoto(photo)}
                            aria-label="Quitar fotografía"
                            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              <Field label="Observaciones">
                <Textarea name="observations" maxLength={500} placeholder="Rayas, detalles estéticos, funcionamiento…" rows={3} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={closeSheet}>Cancelar</Button>
            <SubmitButton label="Registrar entrega y acta" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
