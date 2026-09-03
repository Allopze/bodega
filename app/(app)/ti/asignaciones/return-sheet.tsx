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
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toLocalInputValue } from "@/lib/utils"
import { X, Camera } from "@phosphor-icons/react"
import { returnAssignmentAction } from "./actions"
import { IT_RETURN_PHYSICAL_STATES } from "@/lib/validation/ti"
import { IT_PHYSICAL_STATE_META } from "@/lib/services/ti/constants"

interface ReturnSheetProps {
  trigger: React.ReactNode
  assignment: {
    id: string
    code: string
    assetId: string
    assetCode: string
    workerName: string
    accessories?: { id: string; name: string; returnedAt: string | null }[]
  }
}

interface UploadedPhoto {
  id: string
  previewUrl: string
  caption: string
}

export function ReturnSheet({ trigger, assignment }: ReturnSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [returnedAt, setReturnedAt] = React.useState(toLocalInputValue(new Date()))
  const [returnPhysicalState, setReturnPhysicalState] = React.useState("bueno")
  const [nextStatus, setNextStatus] = React.useState("disponible")
  const [returnedAccessories, setReturnedAccessories] = React.useState<string[]>(
    assignment.accessories?.filter((a) => !a.returnedAt).map((a) => a.name) ?? [],
  )
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
    const result = await returnAssignmentAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Devolución registrada")
      pendingPhotoIdsRef.current = []
      setOpen(false)
      setPhotos((current) => {
        current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl))
        return []
      })
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  async function uploadPhoto(file: File, caption: string) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("stage", "return")
      form.append("assignmentId", assignment.id)
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

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) closeSheet(); else setOpen(true) }}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="assignmentId" value={assignment.id} />
          <input type="hidden" name="assetId" value={assignment.assetId} />
          <input type="hidden" name="returnedAccessoriesJson" value={JSON.stringify(returnedAccessories)} />
          <input type="hidden" name="photoIdsJson" value={JSON.stringify(photos.map((p) => p.id))} />

          <SheetHeader>
            <div>
              <SheetTitle>Devolución — acta {assignment.code}</SheetTitle>
              <SheetDescription>
                {assignment.assetCode} · {assignment.workerName}. Registra el estado físico al devolver: esas fotos se comparan contra las de la entrega.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha y hora de devolución" required error={state.fieldErrors?.returnedAt?.[0]}>
                  <DateTimePicker name="returnedAt" value={returnedAt} onChange={setReturnedAt} />
                </Field>
                <Field label="Estado físico al devolver" required>
                  <Select name="returnPhysicalState" value={returnPhysicalState} onValueChange={setReturnPhysicalState}>
                    <SelectTrigger aria-label="Estado físico al devolver">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_RETURN_PHYSICAL_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{IT_PHYSICAL_STATE_META[s]?.label ?? s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="El activo vuelve a" required>
                <Select name="nextStatus" value={nextStatus} onValueChange={setNextStatus}>
                  <SelectTrigger aria-label="Estado siguiente del activo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disponible">Disponible</SelectItem>
                    <SelectItem value="en_bodega">En bodega</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {(assignment.accessories?.length ?? 0) > 0 && (
                <Field label="Accesorios devueltos" helper="Marca los que el trabajador devuelve.">
                  <div className="flex flex-wrap gap-1.5">
                    {(assignment.accessories ?? []).map((acc) => {
                      const checked = returnedAccessories.includes(acc.name)
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => setReturnedAccessories((prev) =>
                            checked ? prev.filter((a) => a !== acc.name) : [...prev, acc.name],
                          )}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            checked
                              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold text-[var(--color-primary-ink)]"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                          }`}
                        >
                          {acc.name}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              )}

              <Field
                label="Evidencia fotográfica de la devolución"
                helper="Fotos del estado en que se recibe el equipo. Se comparan con las de entrega en la ficha de custodia."
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
                  <Button type="button" variant="secondary" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    <Camera size={14} className="mr-1.5" />
                    {uploading ? "Subiendo..." : "Subir fotografías"}
                  </Button>
                  {photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {photos.map((photo) => (
                        <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-[var(--color-border)]">
                          <Image src={photo.previewUrl} alt="Evidencia de devolución" width={200} height={150} className="aspect-[4/3] w-full object-cover" />
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

              <Field label="Observaciones de la devolución">
                <Input name="returnObservations" maxLength={500} placeholder="Ej. pantalla con rayas en la esquina inferior izquierda" />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={closeSheet}>Cancelar</Button>
            <SubmitButton label="Registrar devolución" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
