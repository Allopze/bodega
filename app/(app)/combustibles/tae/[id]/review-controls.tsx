"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/lib/toast"
import { reviewTaeSubmissionAction } from "../actions"

export function ReviewControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [note, setNote] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  function update(next: "observed" | "validated" | "voided") {
    startTransition(async () => {
      const result = await reviewTaeSubmissionAction({ id, expectedStatus: status as "submitted" | "observed" | "validated" | "voided", status: next, reviewNote: note })
      if (result.ok) {
        toast.success(result.message ?? "Carga actualizada")
        setNote("")
        router.refresh()
      }
      else toast.error(result.message)
    })
  }
  const labels: Record<string, string> = { submitted: "Enviada", observed: "Observada", validated: "Validada", voided: "Anulada" }
  return <section className="border border-(--color-border) bg-(--color-surface) p-4"><p className="text-eyebrow">Revisión</p><p className="mt-1 text-sm text-[var(--color-text-muted)]">Estado actual: {labels[status] ?? status}</p>{status === "voided" ? <p className="mt-3 text-sm text-[var(--color-text-muted)]">La anulación es un estado terminal.</p> : <><Textarea aria-label="Motivo de la revisión" className="mt-3" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Motivo de la revisión" rows={3} /><div className="mt-3 flex flex-wrap gap-2">{status !== "validated" && <Button size="sm" disabled={pending} onClick={() => update("validated")}>Validar</Button>}{status !== "observed" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => update("observed")}>Observar</Button>}<Button size="sm" variant="destructive" disabled={pending} onClick={() => update("voided")}>Anular</Button></div></>}</section>
}
