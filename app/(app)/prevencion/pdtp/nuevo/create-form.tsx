"use client"

import { useActionState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createPdtpProgramAction } from "../actions"

const CURRENT_YEAR = new Date().getFullYear()

export function PdtpCreateProgramForm({ userId }: { userId: string }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(createPdtpProgramAction, null)

  // Navigate to builder on success
  if (state?.ok && state.programId) {
    router.push(`/prevencion/pdtp/${state.programId}/editar`)
  }

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
