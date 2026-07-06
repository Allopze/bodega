"use client"

import * as React from "react"
import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { createPdtpProgramAction } from "../actions"

const CURRENT_YEAR = new Date().getFullYear()

type ExistingProgram = { id: string; title: string; year: number; version: number }

export function PdtpCreateProgramForm({ userId, existingPrograms = [] }: { userId: string; existingPrograms?: ExistingProgram[] }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(createPdtpProgramAction, null)
  const [copyFrom, setCopyFrom] = React.useState("")

  // Bug B: router.push() en el cuerpo del componente es un side-effect de
  // render (dispara el warning de React y puede re-ejecutarse en cada
  // render mientras el estado siga "ok"). Navegar al builder en un efecto.
  React.useEffect(() => {
    if (state?.ok && state.programId) {
      router.push(`/prevencion/pdtp/${state.programId}/editar`)
    }
  }, [state, router])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />

      <div>
        <label className="text-sm font-medium text-[var(--color-text)]">Año del programa</label>
        <Input
          name="year"
          type="number"
          min={2024}
          max={CURRENT_YEAR + 2}
          defaultValue={CURRENT_YEAR}
          required
          className="mt-1"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-[var(--color-text)]">Título del programa</label>
        <Input
          name="title"
          required
          className="mt-1"
          placeholder={`Programa de Trabajo Preventivo SG-SST ${CURRENT_YEAR}`}
        />
      </div>

      {existingPrograms.length > 0 && (
        <div>
          <label className="text-sm font-medium text-[var(--color-text)]">Duplicar estructura de un programa existente (opcional)</label>
          <input type="hidden" name="copySheetsFromProgramId" value={copyFrom} />
          <Select value={copyFrom} onValueChange={setCopyFrom}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Ninguno — programa vacío con las 8 hojas plantilla" />
            </SelectTrigger>
            <SelectContent>
              {existingPrograms.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title} ({p.year} · v{p.version})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Copia hojas, actividades y planificación del programa elegido hacia el año {CURRENT_YEAR}+. Las ejecuciones y cumplimiento no se copian: el nuevo programa arranca en borrador.
          </p>
        </div>
      )}

      {state?.message && !state.ok && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear programa"}
        </Button>
      </div>
    </form>
  )
}
