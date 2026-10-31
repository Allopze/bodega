"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { ListChecks } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decideFlaggedLoadsAction } from "@/app/(app)/combustibles/revisar/actions"
import { MAX_DECISION_NOTE_LENGTH, MIN_DECISION_NOTE_LENGTH, validateDecisionNote } from "@/lib/combustibles/inbox/reasons"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

/**
 * Decidir varias cargas a la vez con una nota común. Una transacción, una
 * auditoría por carga. Sin confirmación: es la misma decisión de siempre, sólo
 * que repetida, y cada carga se puede deshacer desde «Decididas».
 */
export function BulkDecideBar({ loadIds, onDone, onClear }: { loadIds: string[]; onDone: () => void; onClear: () => void }) {
  const router = useRouter()
  const noteId = useId()
  const [note, setNote] = useState("")
  const { pending, message, run } = useOperation()
  const noteError = validateDecisionNote(note)

  function submit(decision: "approve" | "reject") {
    if (noteError) return
    run(
      () => decideFlaggedLoadsAction({ loadIds, decision, note: note.trim() }),
      (result) => {
        toast.success(result.message ?? "Decisión registrada")
        setNote("")
        router.refresh()
        onDone()
      },
    )
  }

  return (
    <div role="region" aria-label="Decidir las cargas seleccionadas" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-xl)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-4 py-3">
      <ListChecks size={18} className="shrink-0 text-[var(--color-success-ink)]" aria-hidden />
      <p className="text-sm font-semibold text-[var(--color-success-ink)]">{loadIds.length} {loadIds.length === 1 ? "seleccionada" : "seleccionadas"}</p>
      <label htmlFor={noteId} className="sr-only">Nota común de la decisión (mínimo {MIN_DECISION_NOTE_LENGTH} caracteres)</label>
      <Input
        id={noteId}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={MAX_DECISION_NOTE_LENGTH}
        placeholder={`Nota común (mínimo ${MIN_DECISION_NOTE_LENGTH} caracteres)`}
        className="w-full min-w-0 sm:w-80"
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="primary" onClick={() => submit("approve")} loading={pending} disabled={pending || noteError !== null}>Cuentan</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => submit("reject")} disabled={pending || noteError !== null}>No cuentan</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={pending}>Quitar selección</Button>
      </div>
      <p className="basis-full text-xs text-[var(--color-success-ink)]">En una carga duplicada, «Cuentan» significa que son dos cargas distintas y «No cuentan», que es la misma.</p>
      {message ? <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">{message}</p> : null}
    </div>
  )
}
