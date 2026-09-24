"use client"

/**
 * Subida tipada: primero se declara **qué** documento es y de qué faena, y
 * después se adjunta. Lo que se declara decide el resto —categoría, si queda
 * vigente al cargarlo o pasa por aprobación— y el aviso de abajo dice, antes de
 * subir, qué efecto tendrá sobre el programa preventivo (carpeta de requisitos
 * legales N°19, entrega del RIOHS N°18).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { FileText } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { FileDropzone } from "@/components/ui/file-dropzone"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { toast } from "@/lib/toast"
import type { DocumentUploadEffects } from "@/lib/services/pdtp-adapters/document-pdtp-effects"
import {
  listSstDocumentsOfTypeAction,
  previewSstDocumentUploadEffectsAction,
  uploadTypedSstDocumentAction,
} from "./actions"

export type TypedUploadTypeOption = {
  id: string
  name: string
  code: string
  categoryName: string
  requiresApproval: boolean
  defaultValidityMonths: number | null
}

export type TypedUploadWorksiteOption = { id: string; name: string }

const NEW_DOCUMENT = "__nuevo__"
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.xls,.xml,application/pdf,image/jpeg,image/png"

export function TypedUploadForm({
  types,
  worksites,
  canUploadCorporate,
  currentFolderId,
  folderWorksiteId,
  initialTypeId,
  initialWorksiteId,
  onDone,
  onCancel,
}: {
  types: TypedUploadTypeOption[]
  worksites: TypedUploadWorksiteOption[]
  /** Sólo con alcance global: un documento corporativo es de toda la empresa. */
  canUploadCorporate: boolean
  currentFolderId: string | null
  /** La carpeta abierta es de una faena: el documento queda en ella. */
  folderWorksiteId: string | null
  initialTypeId?: string
  initialWorksiteId?: string | null
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const lockedWorksite = folderWorksiteId
  const defaultWorksite = lockedWorksite
    ?? initialWorksiteId
    ?? (!canUploadCorporate && worksites.length === 1 ? worksites[0]!.id : "")
  const [typeId, setTypeId] = React.useState(initialTypeId ?? "")
  const [worksiteId, setWorksiteId] = React.useState<string>(defaultWorksite ?? "")
  const [documentId, setDocumentId] = React.useState(NEW_DOCUMENT)
  const [existing, setExisting] = React.useState<Array<{ id: string; title: string; status: string }>>([])
  const [title, setTitle] = React.useState("")
  const [titleTouched, setTitleTouched] = React.useState(false)
  const [effectiveFrom, setEffectiveFrom] = React.useState("")
  const [effectiveTo, setEffectiveTo] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)
  const [effects, setEffects] = React.useState<DocumentUploadEffects | null>(null)
  const [loadingEffects, setLoadingEffects] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const type = types.find((option) => option.id === typeId) ?? null
  const worksiteName = worksites.find((option) => option.id === worksiteId)?.name ?? null
  const needsWorksite = !canUploadCorporate && !worksiteId

  const typeOptions: ComboboxOption[] = React.useMemo(() => types.map((option) => ({
    value: option.id,
    label: option.name,
    hint: `${option.categoryName} · ${option.code}`,
  })), [types])

  // Título por defecto: el tipo y la faena. Se respeta lo que la persona escriba.
  React.useEffect(() => {
    if (titleTouched || !type) return
    setTitle(worksiteName ? `${type.name} — ${worksiteName}` : type.name)
  }, [type, worksiteName, titleTouched])

  // Documentos existentes del tipo y la faena: cargar una versión nueva en vez
  // de duplicar el documento.
  React.useEffect(() => {
    let cancelled = false
    if (!typeId || needsWorksite) {
      setExisting([])
      setDocumentId(NEW_DOCUMENT)
      return
    }
    void listSstDocumentsOfTypeAction({ typeId, worksiteId: worksiteId || null }).then((result) => {
      if (cancelled) return
      const documents = result.ok ? result.data?.documents ?? [] : []
      setExisting(documents)
      setDocumentId(documents[0]?.id ?? NEW_DOCUMENT)
    })
    return () => { cancelled = true }
  }, [typeId, worksiteId, needsWorksite])

  React.useEffect(() => {
    let cancelled = false
    if (!typeId || needsWorksite) {
      setEffects(null)
      return
    }
    setLoadingEffects(true)
    void previewSstDocumentUploadEffectsAction({ typeId, worksiteId: worksiteId || null }).then((result) => {
      if (cancelled) return
      setEffects(result.ok ? result.data?.effects ?? null : null)
      setLoadingEffects(false)
    })
    return () => { cancelled = true }
  }, [typeId, worksiteId, needsWorksite])

  const datesInvalid = Boolean(effectiveFrom && effectiveTo && effectiveTo < effectiveFrom)
  const canSubmit = Boolean(type && file && !needsWorksite && !datesInvalid && !pending
    && (documentId !== NEW_DOCUMENT || title.trim()))

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || !type || !file) return
    setPending(true)
    setError(null)
    const formData = new FormData()
    formData.set("file", file)
    formData.set("typeId", type.id)
    formData.set("worksiteId", worksiteId)
    if (currentFolderId) formData.set("folderId", currentFolderId)
    if (documentId !== NEW_DOCUMENT) formData.set("documentId", documentId)
    formData.set("title", title.trim())
    if (effectiveFrom) formData.set("effectiveFrom", effectiveFrom)
    if (effectiveTo) formData.set("effectiveTo", effectiveTo)
    try {
      const result = await uploadTypedSstDocumentAction(formData)
      if (!result.ok) {
        setError(result.message ?? "No se pudo cargar el documento.")
        return
      }
      toast.success(result.message ?? "Documento cargado.")
      router.refresh()
      onDone()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <FieldGroup className="gap-3">
        <Field
          label="Tipo de documento"
          htmlFor="typed-upload-type"
          required
          helper="Declara qué es antes de adjuntarlo: el tipo define si queda vigente al cargarlo y qué acredita en el programa preventivo."
        >
          <Combobox
            id="typed-upload-type"
            options={typeOptions}
            value={typeId}
            onChange={(value) => { setTypeId(value); setTitleTouched(false) }}
            placeholder="Busca el tipo (RIOHS, carta conductora, registro de IRL…)"
            disabled={pending}
          />
        </Field>

        <DocumentWorksiteField
          id="typed-upload-worksite"
          worksites={worksites}
          value={worksiteId}
          onChange={setWorksiteId}
          canUseCorporate={canUploadCorporate}
          lockedWorksiteId={lockedWorksite}
          disabled={pending}
        />

        {type && !needsWorksite && existing.length > 0 && (
          <Field label="¿Nueva versión o documento nuevo?" htmlFor="typed-upload-document">
            <Select value={documentId} onValueChange={setDocumentId} disabled={pending}>
              <SelectTrigger id="typed-upload-document"><SelectValue /></SelectTrigger>
              <SelectContent>
                {existing.map((doc) => (
                  <SelectItem key={doc.id} value={doc.id}>Nueva versión de «{doc.title}»</SelectItem>
                ))}
                <SelectItem value={NEW_DOCUMENT}>Documento nuevo</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {documentId === NEW_DOCUMENT && (
          <Field label="Título" htmlFor="typed-upload-title" required>
            <Input
              id="typed-upload-title"
              value={title}
              maxLength={200}
              onChange={(event) => { setTitle(event.target.value); setTitleTouched(true) }}
              disabled={pending}
            />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vigente desde" htmlFor="typed-upload-from" helper="Vacío: desde hoy.">
            <DatePicker id="typed-upload-from" value={effectiveFrom} onChange={setEffectiveFrom} disabled={pending} />
          </Field>
          <Field
            label="Vigente hasta"
            htmlFor="typed-upload-to"
            helper={type?.defaultValidityMonths
              ? `Vacío: vence a los ${type.defaultValidityMonths} meses, la validez del tipo.`
              : "Vacío: sin vencimiento."}
            error={datesInvalid ? "No puede terminar antes de comenzar." : undefined}
          >
            <DatePicker id="typed-upload-to" value={effectiveTo} onChange={setEffectiveTo} min={effectiveFrom || undefined} disabled={pending} error={datesInvalid} />
          </Field>
        </div>

        <Field label="Archivo" htmlFor="typed-upload-file" required>
          <FileDropzone
            id="typed-upload-file"
            accept={ACCEPT}
            acceptLabel="Elegir archivo"
            icon={<FileText size={28} weight="duotone" />}
            title={file ? file.name : "Selecciona o arrastra el archivo aquí"}
            description="PDF, JPG, PNG, DOCX, XLSX o XML (máximo 25 MB)"
            onFileSelect={setFile}
            disabled={pending}
          />
        </Field>
      </FieldGroup>

      {type && !needsWorksite && (
        <UploadEffectsCallout effects={effects} loading={loadingEffects} requiresApproval={type.requiresApproval} />
      )}

      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>{pending ? "Cargando..." : "Cargar documento"}</Button>
      </div>
    </form>
  )
}

function UploadEffectsCallout({ effects, loading, requiresApproval }: {
  effects: DocumentUploadEffects | null
  loading: boolean
  requiresApproval: boolean
}) {
  if (loading && !effects) {
    return <p className="text-xs text-[var(--color-text-muted)]" aria-live="polite">Calculando el efecto de esta carga…</p>
  }
  const direct = effects?.becomesCurrentOnUpload ?? !requiresApproval
  const folder = effects?.legalFolder ?? []
  const completes = folder.filter((entry) => entry.satisfiedAfter === entry.total && entry.satisfiedBefore < entry.total)
  return (
    <div className="space-y-2" aria-live="polite">
      <Callout tone="info" className="text-xs">
        {direct
          ? "Quedará vigente al cargarlo: este tipo es un registro externo y no requiere revisión ni aprobación."
          : "Quedará en borrador: tiene efecto cuando se publique, después de su revisión y aprobación."}
      </Callout>
      {folder.length > 0 && (
        <Callout tone={completes.length > 0 ? "success" : "info"} className="text-xs">
          {folder.length <= 3 ? (
            <ul className="space-y-1">
              {folder.map((entry) => (
                <li key={`${entry.activityNumber}:${entry.worksiteId}`}>
                  Carpeta de requisitos legales (N°{entry.activityNumber}) de {entry.worksiteName}: {entry.satisfiedAfter} de {entry.total}
                  {entry.satisfiedAfter === entry.total
                    ? " — queda completa y acredita el mes."
                    : ` — faltará: ${entry.missingAfter.join(", ")}.`}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Carpeta de requisitos legales (N°{folder[0]!.activityNumber}): con esta carga queda completa en {folder.filter((entry) => entry.satisfiedAfter === entry.total).length} de {folder.length} faenas.
            </p>
          )}
        </Callout>
      )}
      {effects && effects.staleDependents.length > 0 && (
        <Callout tone="warning" className="text-xs">
          Al quedar vigente, {effects.staleDependents.join(" y ")} {effects.staleDependents.length === 1 ? "quedará anterior" : "quedarán anteriores"} a este RIOHS: carga las cartas nuevas para que la carpeta siga al día.
        </Callout>
      )}
      {effects?.riohsRollout && (
        <Callout tone="info" className="text-xs">
          Al publicarse abrirá la entrega a toda la dotación (N°18) en {effects.riohsRollout.worksiteCount} {effects.riohsRollout.worksiteCount === 1 ? "faena" : "faenas"}, con plazo de {effects.riohsRollout.dueDays} días.
        </Callout>
      )}
    </div>
  )
}

/**
 * La faena de un documento. Sólo se elige cuando hay algo que elegir:
 *
 * - quien opera una sola faena (el prevencionista de faena) no elige: sus
 *   documentos son de su faena, y el campo la muestra como dato;
 * - una carpeta de faena fija la faena para cualquiera;
 * - con alcance global (la jefatura del departamento) se elige la faena o
 *   "Corporativo", un documento de toda la empresa.
 *
 * El servidor impone lo mismo por su cuenta (`assertScopeAccess`): esto sólo
 * evita ofrecer una elección que no existe.
 */
export function DocumentWorksiteField({
  id,
  worksites,
  value,
  onChange,
  canUseCorporate,
  lockedWorksiteId = null,
  disabled = false,
  label = "Faena",
}: {
  id: string
  worksites: TypedUploadWorksiteOption[]
  value: string
  onChange: (worksiteId: string) => void
  canUseCorporate: boolean
  lockedWorksiteId?: string | null
  disabled?: boolean
  label?: string
}) {
  const fixedId = lockedWorksiteId ?? (!canUseCorporate && worksites.length === 1 ? worksites[0]!.id : null)
  // Un campo fijo tiene que reflejarse en el valor que se envía, aunque el
  // estado del llamador haya nacido vacío.
  React.useEffect(() => {
    if (fixedId && value !== fixedId) onChange(fixedId)
  }, [fixedId, value, onChange])

  if (fixedId) {
    const name = worksites.find((site) => site.id === fixedId)?.name ?? "Faena de la carpeta"
    return (
      <Field
        label={label}
        htmlFor={id}
        helper={lockedWorksiteId ? "La carpeta abierta pertenece a esta faena." : "Es tu faena: lo que cargues queda en ella."}
      >
        <Input id={id} value={name} readOnly aria-readonly="true" />
      </Field>
    )
  }
  return (
    <Field
      label={label}
      htmlFor={id}
      required={!canUseCorporate}
      helper={canUseCorporate ? "Corporativo: un documento de toda la empresa, como el RIOHS o sus cartas conductoras." : undefined}
    >
      <WorksiteSelect
        id={id}
        aria-label="Faena del documento"
        worksites={worksites}
        value={value}
        onChange={onChange}
        includeAll={canUseCorporate}
        allValue="__corporativo__"
        allLabel="Corporativo (toda la empresa)"
        placeholder={canUseCorporate ? "Corporativo (toda la empresa)" : "Selecciona la faena"}
        disabled={disabled}
      />
    </Field>
  )
}
