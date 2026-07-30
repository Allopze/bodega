"use client"

import * as React from "react"
import { ListChecks, Plus, Trash, Users } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { addPdtpActivityFormAction } from "./actions"

type ResponsibleOption = { slug: string; displayName: string }
type SheetOption = { code: string; label: string }

/**
 * H-M2: form de "agregar actividad" como Client Component con
 * `useFieldArray`-like pattern (estado local). Permite al usuario
 * agregar N responsables y N hojas, no solo 1. Envía los valores
 * como `responsibleSlugs[]` y `sheetCodes[]` (array notation) que
 * la Server Action lee con `fd.getAll()`.
 *
 * Responsables y hojas se eligen de un Select poblado desde el catálogo
 * (antes eran `Input` de texto libre: el usuario tenía que escribir el
 * slug/code interno a mano). Si el catálogo viene vacío (programa nuevo
 * que nunca importó un Excel), cae a texto libre para no bloquear el uso.
 */
export function PdtpAddActivityForm({
  programId,
  hoja,
  faena,
  errorMessage,
  responsibleCatalog = [],
  sheetOptions = [],
}: {
  programId: string
  hoja: string
  faena: string
  errorMessage?: string
  responsibleCatalog?: ResponsibleOption[]
  sheetOptions?: SheetOption[]
}) {
  const [responsibleSlugs, setResponsibleSlugs] = React.useState<{ id: string; value: string }[]>([{ id: crypto.randomUUID(), value: responsibleCatalog[0]?.slug ?? "" }])
  // La actividad se agrega, por defecto, a la vista que el usuario ya está
  // mirando (`hoja`). Elegir otras vistas es una opción avanzada, no el flujo
  // principal: no debe leerse como "asignar a hojas de Excel".
  const defaultSheetCode = hoja || sheetOptions[0]?.code || ""
  const [sheetCodes, setSheetCodes] = React.useState<{ id: string; value: string }[]>([{ id: crypto.randomUUID(), value: defaultSheetCode }])

  const addResp = () => setResponsibleSlugs((s) => [...s, { id: crypto.randomUUID(), value: responsibleCatalog[0]?.slug ?? "" }])
  const removeResp = (i: number) =>
    setResponsibleSlugs((s) => s.filter((_, idx) => idx !== i))
  const updateResp = (i: number, v: string) =>
    setResponsibleSlugs((s) => s.map((x, idx) => (idx === i ? { ...x, value: v } : x)))

  const addSheet = () => setSheetCodes((s) => [...s, { id: crypto.randomUUID(), value: sheetOptions[0]?.code ?? "" }])
  const removeSheet = (i: number) =>
    setSheetCodes((s) => s.filter((_, idx) => idx !== i))
  const updateSheet = (i: number, v: string) =>
    setSheetCodes((s) => s.map((x, idx) => (idx === i ? { ...x, value: v } : x)))

  // El nombre visible del responsable se deriva del primero seleccionado en la
  // lista de abajo. Antes era un campo aparte ("Responsable (nombre)") que
  // obligaba a teclear el responsable dos veces. El schema exige
  // `responsibleDisplay`, así que lo enviamos por un hidden input.
  const primaryResponsibleDisplay = React.useMemo(() => {
    const first = responsibleSlugs[0]?.value ?? ""
    return responsibleCatalog.find((r) => r.slug === first)?.displayName ?? first
  }, [responsibleSlugs, responsibleCatalog])

  return (
    <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
            <Plus size={18} weight="bold" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Agregar actividad</p>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Define la actividad y los responsables asignados.
            </p>
          </div>
        </div>
      </div>

      <form action={addPdtpActivityFormAction}>
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="hoja" value={hoja} />
        <input type="hidden" name="faena" value={faena} />
        <input type="hidden" name="responsibleDisplay" value={primaryResponsibleDisplay} />

        <FieldGroup className="gap-5 p-5 sm:p-6">
          {errorMessage && (
            <p
              role="alert"
              className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {errorMessage}
            </p>
          )}

          {/* ── Section: Definición de la actividad ── */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:p-4">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                <ListChecks size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Definición de la actividad</p>
                <p className="mt-0.5 text-xs leading-5 text-text-subtle">
                  Describe la actividad preventiva y cómo debe ejecutarse.
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              <div>
                <Field label="Actividad preventiva" htmlFor="pdtp-act-desc" required>
                  <Textarea id="pdtp-act-desc" name="activity" required rows={4} maxLength={4000} placeholder="Describe la actividad preventiva a realizar" />
                </Field>
              </div>

              <div>
                <Field label="Guía de ejecución" htmlFor="pdtp-act-prog" required helper="Cómo realizar la actividad y qué evidencia conservar.">
                  <Textarea id="pdtp-act-prog" name="program" required rows={3} maxLength={2000} placeholder="Ej.: inspeccionar, registrar hallazgos y definir acciones" />
                </Field>
              </div>
            </div>
          </div>

          {/* ── Section: Responsables (vistas del programa como opción avanzada) ── */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:p-4">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                <Users size={18} weight="bold" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Responsables</p>
                <p className="mt-0.5 text-xs leading-5 text-text-subtle">
                  ¿Quién ejecuta esta actividad? Puedes asignar más de uno.
                </p>
              </div>
            </div>

            <FieldGroup className="gap-4">
              {/* ── Responsables ── */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--color-text)]">Responsables</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addResp}
                    aria-label="Agregar responsable"
                  >
                    <Plus size={12} className="mr-1" />
                    Agregar
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {responsibleSlugs.map((slug, i) => (
                    <div key={slug.id} className="flex items-center gap-1.5">
                      {responsibleCatalog.length > 0 ? (
                        <Select name="responsibleSlugs[]" value={slug.value} onValueChange={(v) => updateResp(i, v)}>
                          <SelectTrigger className="h-8 flex-1 text-sm">
                            <SelectValue placeholder="Responsable" />
                          </SelectTrigger>
                          <SelectContent>
                            {responsibleCatalog.map((r) => (
                              <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          name="responsibleSlugs[]"
                          value={slug.value}
                          onChange={(e) => updateResp(i, e.target.value)}
                          placeholder="Ej: Jefe de terreno"
                          required
                          className="h-8 flex-1"
                        />
                      )}
                      {responsibleSlugs.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeResp(i)}
                          aria-label={`Quitar responsable ${i + 1}`}
                        >
                          <Trash size={12} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Vistas del programa (avanzado) ──
                  La actividad ya se agrega a la vista que el usuario está
                  mirando (default arriba). Mostrarla en otras vistas es
                  opcional y poco común, por eso vive colapsada: el flujo
                  principal no debe leerse como "asignar a hojas de Excel". */}
              <details className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">
                  Mostrar también en otras vistas del programa (opcional)
                </summary>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs leading-5 text-text-subtle">Ya aparece en la vista actual. Agrega otras solo si corresponde.</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addSheet}
                    aria-label="Agregar vista"
                  >
                    <Plus size={12} className="mr-1" />
                    Agregar
                  </Button>
                </div>
                <div className="mt-2 space-y-1.5">
                  {sheetCodes.map((code, i) => (
                    <div key={code.id} className="flex items-center gap-1.5">
                      {sheetOptions.length > 0 ? (
                        <Select name="sheetCodes[]" value={code.value} onValueChange={(v) => updateSheet(i, v)}>
                          <SelectTrigger className="h-8 flex-1 text-sm">
                            <SelectValue placeholder="Vista" />
                          </SelectTrigger>
                          <SelectContent>
                            {sheetOptions.map((s) => (
                              <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          name="sheetCodes[]"
                          value={code.value}
                          onChange={(e) => updateSheet(i, e.target.value)}
                          placeholder="Ej: Vista general"
                          required
                          className="h-8 flex-1"
                        />
                      )}
                      {sheetCodes.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeSheet(i)}
                          aria-label={`Quitar vista ${i + 1}`}
                        >
                          <Trash size={12} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </FieldGroup>
          </div>

          {/* Submit */}
          <div className="flex justify-end border-t border-[var(--color-border)] pt-5">
            <Button type="submit" size="sm">
              Agregar actividad
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  )
}
