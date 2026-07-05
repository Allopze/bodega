"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash } from "@phosphor-icons/react/dist/ssr"
import { addPdtpActivityFormAction } from "./actions"

/**
 * H-M2: form de "agregar actividad" como Client Component con
 * `useFieldArray`-like pattern (estado local). Permite al usuario
 * agregar N responsables y N hojas, no solo 1. Envía los valores
 * como `responsibleSlugs[]` y `sheetCodes[]` (array notation) que
 * la Server Action lee con `fd.getAll()`.
 */
export function PdtpAddActivityForm({
  programId,
  hoja,
  faena,
  defaultObjectiveOrder = 1,
  errorMessage,
}: {
  programId: string
  hoja: string
  faena: string
  defaultObjectiveOrder?: number
  errorMessage?: string
}) {
  const [responsibleSlugs, setResponsibleSlugs] = React.useState<string[]>(["prf"])
  const [sheetCodes, setSheetCodes] = React.useState<string[]>(["pdtp_general"])

  const addResp = () => setResponsibleSlugs((s) => [...s, ""])
  const removeResp = (i: number) =>
    setResponsibleSlugs((s) => s.filter((_, idx) => idx !== i))
  const updateResp = (i: number, v: string) =>
    setResponsibleSlugs((s) => s.map((x, idx) => (idx === i ? v : x)))

  const addSheet = () => setSheetCodes((s) => [...s, ""])
  const removeSheet = (i: number) =>
    setSheetCodes((s) => s.filter((_, idx) => idx !== i))
  const updateSheet = (i: number, v: string) =>
    setSheetCodes((s) => s.map((x, idx) => (idx === i ? v : x)))

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Agregar actividad</h3>
      {errorMessage && (
        <p
          role="alert"
          className="mb-3 rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {errorMessage}
        </p>
      )}
      <form action={addPdtpActivityFormAction} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="hoja" value={hoja} />
        <input type="hidden" name="faena" value={faena} />

        <div>
          <label className="text-xs text-[var(--color-text-subtle)]">Orden objetivo (1-8)</label>
          <Input
            name="objectiveOrder"
            type="number"
            min="1"
            max="8"
            defaultValue={defaultObjectiveOrder}
            required
            className="mt-1 h-8"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-subtle)]">Objetivo</label>
          <Input name="objective" required className="mt-1 h-8" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-[var(--color-text-subtle)]">Actividad</label>
          <Textarea name="activity" required rows={2} className="mt-1" />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-subtle)]">Programa</label>
          <Input name="program" required className="mt-1 h-8" />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-subtle)]">Responsable (nombre)</label>
          <Input
            name="responsibleDisplay"
            required
            className="mt-1 h-8"
            placeholder="PRF"
          />
        </div>

        <div className="col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-[var(--color-text-subtle)]">
              Responsables (slugs RBAC)
            </label>
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
          <div className="space-y-1">
            {responsibleSlugs.map((slug, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  name="responsibleSlugs[]"
                  value={slug}
                  onChange={(e) => updateResp(i, e.target.value)}
                  placeholder="prf, jt, jdpr, ..."
                  required
                  className="h-8"
                />
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

        <div className="col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-[var(--color-text-subtle)]">
              Hojas oficiales
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addSheet}
              aria-label="Agregar hoja"
            >
              <Plus size={12} className="mr-1" />
              Agregar
            </Button>
          </div>
          <div className="space-y-1">
            {sheetCodes.map((code, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  name="sheetCodes[]"
                  value={code}
                  onChange={(e) => updateSheet(i, e.target.value)}
                  placeholder="pdtp_general, cphs, ..."
                  required
                  className="h-8"
                />
                {sheetCodes.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSheet(i)}
                    aria-label={`Quitar hoja ${i + 1}`}
                  >
                    <Trash size={12} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-2 flex justify-end">
          <Button type="submit" size="sm">
            Agregar actividad
          </Button>
        </div>
      </form>
    </div>
  )
}
