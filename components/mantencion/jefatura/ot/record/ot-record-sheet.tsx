"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { registerWorkOrderRecordAction } from "@/app/(app)/mantencion/ot/[id]/actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { useOperation } from "@/lib/hooks/use-operation"
import {
  MANT_WEB_APP_VERSION, MANT_WEB_DEVICE_ID, MANT_WEB_PHOTO_TYPES, webMetaField, webPhotoField, type PhotoMeta,
} from "@/lib/mantencion/contracts"
import { buildRow } from "@/lib/mantencion/client/fleet-view"
import { flowReducer } from "@/lib/mantencion/client/flow"
import { buildFlowEnv } from "@/lib/mantencion/client/flow-env"
import { buildRecord, stepForRejection } from "@/lib/mantencion/client/flow-record"
import { newDraft, stepsFor, type FlowDraft, type FlowStep } from "@/lib/mantencion/client/flow-types"
import { validateAll } from "@/lib/mantencion/client/flow-validate"
import { capturePhoto, PhotoError } from "@/lib/mantencion/client/photo-capture"
import type { MantPhotoKind } from "@/lib/mantencion/types"
import type { WorkOrderRecordForm } from "@/lib/services/mantencion/web-record"
import { toast } from "@/lib/toast"
import { todayInChile } from "@/lib/utils"
import { RecordStepFotos, RecordStepRevisar, type LoadedPhoto, type PhotoHandlers } from "./record-step-fotos-revisar"
import { RecordStepLectura } from "./record-step-lectura"
import { RecordStepPauta, RecordStepTrabajo } from "./record-step-trabajo"

export type RecordKind = "P" | "C"

const STEP_TITLES: Record<FlowStep, string> = {
  equipo: "Equipo",
  lectura: "Lectura y fecha",
  pauta: "Pauta",
  trabajo: "Trabajo",
  fotos: "Fotos",
  revisar: "Revisar y firmar",
}

const NEXT_LABEL: Partial<Record<FlowStep, string>> = { lectura: "Continuar", pauta: "Continuar a fotos", trabajo: "Continuar a fotos", fotos: "Revisar registro" }

interface StoredPhoto extends LoadedPhoto {
  blob: Blob
  meta: PhotoMeta
}

/** ¿Hay algo escrito que se perdería al cerrar? El equipo viene fijo, así que no cuenta. */
function hasTyped(draft: FlowDraft): boolean {
  return draft.readingText !== "" || draft.jobs.length > 0 || draft.oilIds.length > 0 || draft.noOilChange || draft.driverIds.length > 0
    || draft.description.trim() !== "" || draft.notes.trim() !== "" || Object.keys(draft.marks).length > 0
    || draft.photos.correctiva.length > 0 || !!draft.photos.filtros || !!draft.photos.sticker
}

export interface OtRecordSheetProps {
  kind: RecordKind
  workOrderId: string
  folio: string
  userId: string
  userName: string
  form: WorkOrderRecordForm
  onClose: () => void
}

/**
 * Registrar desde el PC la correctiva o preventiva de la OT. Es el flujo de la
 * app con los componentes de la plataforma: el mismo reductor (`flowReducer`),
 * la misma validación por paso y el mismo armado del registro (`buildRecord`),
 * con el equipo fijo (el de la OT, sin paso «Equipo»). Las fotos se achican y
 * timbran en el navegador como en el teléfono, y todo viaja en un solo envío.
 *
 * Se monta al abrirse: cada apertura es un registro nuevo (id nuevo). Cerrar con
 * algo escrito pide confirmar; un rechazo del servidor lleva al paso del campo.
 */
export function OtRecordSheet({ kind, workOrderId, folio, userId, userName, form, onClose }: OtRecordSheetProps) {
  const router = useRouter()
  const [draft, dispatch] = React.useReducer(flowReducer, undefined, () => newDraft({
    userId, kind, vehicleId: form.equipment.id, schedule: form.schedule, workOrderId,
  }))
  const row = React.useMemo(() => buildRow(form.equipment, form.schedule, [], new Set(form.worksiteIds)), [form])
  const today = todayInChile()
  const env = React.useMemo(() => buildFlowEnv({ row, today }), [row, today])
  const steps = stepsFor(kind)
  const step = steps[draft.step] ?? "lectura"
  const op = useOperation()
  const [confirmClose, setConfirmClose] = React.useState(false)

  const [photos, setPhotos] = React.useState<Record<string, StoredPhoto>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<Partial<Record<MantPhotoKind, string>>>({})
  const urls = React.useRef<string[]>([])
  React.useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url) }, [])

  async function loadPhoto(photoKind: MantPhotoKind, file: File) {
    setLoadError((current) => ({ ...current, [photoKind]: undefined }))
    if (!(MANT_WEB_PHOTO_TYPES as readonly string[]).includes(file.type)) {
      setLoadError((current) => ({ ...current, [photoKind]: "Esa foto no sirve: carga una en JPG o PNG. Si es de un iPhone (HEIC), guárdala como JPG primero." }))
      return
    }
    setBusy(photoKind)
    try {
      const captured = await capturePhoto(file, { code: row.eq.code, plate: row.eq.plate })
      const id = crypto.randomUUID()
      const url = URL.createObjectURL(captured.blob)
      urls.current.push(url)
      const meta: PhotoMeta = {
        kind: photoKind, sha256: captured.sha256, width: captured.width, height: captured.height,
        stampedAt: captured.stampedAt, takenAtExif: captured.takenAtExif, exif: captured.exif, deviceId: MANT_WEB_DEVICE_ID,
      }
      setPhotos((current) => ({ ...current, [id]: { blob: captured.blob, meta, url } }))
      if (photoKind === "correctiva") dispatch({ type: "photoAdd", id })
      else dispatch({ type: "photo", slot: photoKind, id })
    } catch (error) {
      const message = error instanceof PhotoError ? error.message : "No pudimos leer la foto. Prueba con otra."
      setLoadError((current) => ({ ...current, [photoKind]: message.replace("Saca otra con la cámara.", "Prueba con otra.") }))
    } finally {
      setBusy(null)
    }
  }

  const handlers: PhotoHandlers = {
    photos,
    busy,
    loadError,
    onFile: (photoKind, file) => { void loadPhoto(photoKind, file) },
    onRemove: (id) => dispatch({ type: "photoRemove", id }),
  }

  function requestClose() {
    if (op.pending) return
    if (hasTyped(draft)) setConfirmClose(true)
    else onClose()
  }

  function next() {
    op.setMessage("")
    dispatch({ type: "next", env })
  }

  function confirmAndNext(patch: Partial<FlowDraft>) {
    dispatch({ type: "patch", patch })
    dispatch({ type: "next", env })
  }

  function sign() {
    const ctx = { row, today }
    const problem = validateAll(draft, steps.slice(1), ctx)
    if (problem) {
      dispatch({ type: "goStep", step: steps.indexOf(problem.step), backToReview: true })
      dispatch({ type: "errors", errors: problem.errors })
      return
    }
    const built = buildRecord(draft, { row, deviceId: MANT_WEB_DEVICE_ID, appVersion: MANT_WEB_APP_VERSION, offlineSince: null, now: new Date() })
    if (!built.ok) { op.setMessage(built.message, "error"); return }
    const data = new FormData()
    data.set("record", JSON.stringify(built.payload))
    for (const photo of built.payload.photos) {
      const stored = photos[photo.id]
      if (!stored) { op.setMessage("Falta una de las fotos. Vuelve a cargarla.", "error"); return }
      data.set(webPhotoField(photo.id), new File([stored.blob], `${photo.id}.jpg`, { type: "image/jpeg" }))
      data.set(webMetaField(photo.id), JSON.stringify(stored.meta))
    }
    op.run(
      () => registerWorkOrderRecordAction(data),
      (result) => {
        toast.success(result.message ?? `Registro guardado y enlazado a ${folio}.`)
        const warnings = (result.data?.warnings as string[] | undefined) ?? []
        for (const warning of warnings) toast.warning(warning)
        onClose()
        router.refresh()
      },
      (result) => {
        // El servidor señala el campo: se vuelve a su paso, con el mensaje a la vista.
        const field = Object.keys(result.fieldErrors ?? {})[0] ?? null
        const target = stepForRejection(field)
        if (target !== "revisar") dispatch({ type: "goStep", step: steps.indexOf(target), backToReview: true })
      },
    )
  }

  const last = draft.step >= steps.length - 1
  const catalogs = { workTypes: form.workTypes, oils: form.oils, drivers: form.drivers, workshops: form.workshops, mechanics: form.mechanics }

  return (
    <>
      <Sheet open onOpenChange={(open) => { if (!open) requestClose() }}>
        <SheetContent stableHeight className="sm:max-w-2xl" onInteractOutside={(event) => event.preventDefault()}>
          <SheetHeader>
            <div className="min-w-0">
              <SheetTitle>{kind === "C" ? "Registrar correctiva" : "Registrar preventiva"} · {folio}</SheetTitle>
              <SheetDescription>Paso {draft.step} de {steps.length - 1} · {STEP_TITLES[step]}</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody>
            {step === "lectura" && <RecordStepLectura draft={draft} dispatch={dispatch} row={row} onConfirm={confirmAndNext} />}
            {step === "trabajo" && <RecordStepTrabajo draft={draft} dispatch={dispatch} row={row} catalogs={catalogs} folio={folio} />}
            {step === "pauta" && <RecordStepPauta draft={draft} dispatch={dispatch} row={row} />}
            {step === "fotos" && <RecordStepFotos draft={draft} dispatch={dispatch} handlers={handlers} />}
            {step === "revisar" && <RecordStepRevisar draft={draft} dispatch={dispatch} row={row} catalogs={catalogs} folio={folio} userName={userName} />}
          </SheetBody>
          <SheetFooter className="flex-wrap">
            {op.message && <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">{op.message}</p>}
            {draft.step > 1 && (
              <Button type="button" variant="secondary" disabled={op.pending} onClick={() => dispatch({ type: "back" })}>Volver</Button>
            )}
            {last ? (
              <Button type="button" variant="primary" loading={op.pending} onClick={sign}>Firmar y guardar</Button>
            ) : (
              <Button type="button" variant="primary" disabled={busy !== null} onClick={next}>{NEXT_LABEL[step] ?? "Continuar"}</Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="¿Descartar el registro?"
        description="Lo que escribiste y las fotos cargadas se pierden. El registro no se guardó."
        variant="destructive"
        confirmLabel="Descartar"
        cancelLabel="Seguir registrando"
        onConfirm={() => { setConfirmClose(false); onClose() }}
      />
    </>
  )
}
