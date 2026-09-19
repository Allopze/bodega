"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { submitPublicAcknowledgement, type PublicAckState } from "../../../actions"

const INITIAL: PublicAckState = { ok: false, message: "" }

/**
 * CAP-002 / PER-002: el formulario no pide identidad porque la identidad la
 * lleva el propio enlace — el token abre exactamente una asistencia o un
 * integrante de cuadrilla, nunca "el acuse de quien sea".
 */
export function PublicAcknowledgementForm({
  kind,
  targetId,
  token,
  alreadyAcknowledgedAt,
  eligible,
  ineligibleReason,
}: {
  kind: "permiso"
  targetId: string
  token: string
  alreadyAcknowledgedAt: string | null
  eligible: boolean
  ineligibleReason: string | null
}) {
  const [state, action, pending] = useActionState(submitPublicAcknowledgement, INITIAL)

  if (alreadyAcknowledgedAt || state.ok) {
    return (
      <p className="mt-3 text-sm font-medium text-[var(--color-success)]">
        Acuse registrado. No hace falta hacer nada más.
      </p>
    )
  }
  if (!eligible) {
    return <p className="mt-3 text-sm text-(--color-text-muted)">{ineligibleReason}</p>
  }

  return (
    <form action={action} className="mt-3 grid gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-(--color-text-muted)">
        Declaro haber recibido el AST y los controles de este permiso.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Registrando…" : "Acuso recibo"}
      </Button>
      {state.message && !state.ok && (
        <p className="text-sm text-[var(--color-danger)]">{state.message}</p>
      )}
    </form>
  )
}
