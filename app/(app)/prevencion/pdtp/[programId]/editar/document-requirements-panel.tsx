"use client"

/**
 * Carpeta de requisitos legales (N°19): qué documentos debe tener vigentes
 * cada faena para que el mes se acredite. Es contenido firmado del programa,
 * así que sólo se edita con el programa en borrador; firmado, se muestra.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperation } from "@/lib/hooks/use-operation"
import { setPdtpActivityDocumentRequirementsAction } from "../../actions"

type Requirement = {
  documentTypeId: string
  scope: "faena" | "corporativo"
  mustFollowDocumentTypeId: string | null
}

type DocumentTypeOption = { id: string; name: string; code: string; categoryName: string }

const NO_ANCHOR = "__ninguno__"

export function DocumentRequirementsPanel({
  programId,
  activity,
  requirements,
  documentTypes,
  editable,
}: {
  programId: string
  activity: { id: string; n: number; activity: string }
  requirements: Requirement[]
  documentTypes: DocumentTypeOption[]
  editable: boolean
}) {
  const router = useRouter()
  const operation = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const [rows, setRows] = React.useState<Requirement[]>(requirements)
  const [adding, setAdding] = React.useState("")
  React.useEffect(() => setRows(requirements), [requirements])

  const typeById = new Map(documentTypes.map((type) => [type.id, type]))
  const available: ComboboxOption[] = documentTypes
    .filter((type) => !rows.some((row) => row.documentTypeId === type.id))
    .map((type) => ({ value: type.id, label: type.name, hint: `${type.categoryName} · ${type.code}` }))
  const dirty = JSON.stringify(rows) !== JSON.stringify(requirements)

  function update(index: number, patch: Partial<Requirement>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function move(index: number, delta: number) {
    setRows((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }
  function remove(index: number) {
    setRows((current) => current.filter((_, i) => i !== index)
      // Quitar un tipo deja sin ancla a quien debía seguirlo.
      .map((row) => (row.mustFollowDocumentTypeId === current[index]?.documentTypeId ? { ...row, mustFollowDocumentTypeId: null } : row)))
  }
  function add(typeId: string) {
    if (!typeId) return
    setRows((current) => [...current, { documentTypeId: typeId, scope: "faena", mustFollowDocumentTypeId: null }])
    setAdding("")
  }
  function save() {
    operation.run(() => setPdtpActivityDocumentRequirementsAction({ programId, activityId: activity.id, requirements: rows }))
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" aria-labelledby="document-requirements-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="document-requirements-title" className="text-base font-semibold text-[var(--color-text)]">
            Carpeta documental · N°{activity.n}
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            El mes se acredita en Documentación cuando la faena tiene vigentes todos estos documentos. Corporativo: basta un documento de la empresa para todas las faenas.
          </p>
        </div>
        {editable && (
          <Button size="sm" onClick={save} loading={operation.pending} disabled={!dirty}>Guardar carpeta</Button>
        )}
      </div>

      {rows.length === 0 && (
        <Callout tone="warning" className="mt-3 text-xs">
          La carpeta no declara documentos: el programa no puede enviarse a revisión hasta que declare al menos uno.
        </Callout>
      )}

      <ul className="mt-3 space-y-2">
        {rows.map((row, index) => {
          const type = typeById.get(row.documentTypeId)
          const anchors = rows.filter((other) => other.documentTypeId !== row.documentTypeId)
          return (
            <li key={row.documentTypeId} className="grid gap-2 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[1fr_10rem_14rem_auto] sm:items-end">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">{type?.name ?? row.documentTypeId}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{type ? `${type.categoryName} · ${type.code}` : "Tipo inactivo o eliminado"}</p>
              </div>
              <Field label="Alcance" htmlFor={`req-scope-${index}`}>
                <Select value={row.scope} onValueChange={(value) => update(index, { scope: value as Requirement["scope"] })} disabled={!editable}>
                  <SelectTrigger id={`req-scope-${index}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="faena">Por faena</SelectItem>
                    <SelectItem value="corporativo">Corporativo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Debe ser posterior a" htmlFor={`req-follow-${index}`}>
                <Select
                  value={row.mustFollowDocumentTypeId ?? NO_ANCHOR}
                  onValueChange={(value) => update(index, { mustFollowDocumentTypeId: value === NO_ANCHOR ? null : value })}
                  disabled={!editable}
                >
                  <SelectTrigger id={`req-follow-${index}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ANCHOR}>Sin condición</SelectItem>
                    {anchors.map((anchor) => (
                      <SelectItem key={anchor.documentTypeId} value={anchor.documentTypeId}>
                        {typeById.get(anchor.documentTypeId)?.name ?? anchor.documentTypeId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {editable && (
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="ghost" aria-label={`Subir ${type?.name ?? "documento"}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={`Bajar ${type?.name ?? "documento"}`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={`Quitar ${type?.name ?? "documento"}`} onClick={() => remove(index)}><Trash size={14} /></Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {editable && (
        <div className="mt-3 max-w-md">
          <Field label="Agregar documento a la carpeta" htmlFor="req-add">
            <Combobox id="req-add" options={available} value={adding} onChange={add} placeholder="Busca un tipo documental" />
          </Field>
        </div>
      )}
      {!editable && (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">El programa está firmado: la carpeta se cambia en una revisión nueva.</p>
      )}
    </section>
  )
}
