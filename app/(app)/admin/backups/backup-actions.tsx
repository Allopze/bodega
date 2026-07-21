"use client"

import { useActionState } from "react"
import { Play } from "@phosphor-icons/react/dist/ssr"
import { triggerManualBackupAction } from "./actions"

export function BackupsActions() {
  const [state, formAction, pending] = useActionState(triggerManualBackupAction, { ok: true, message: "" })

  return (
    <div className="flex items-center gap-2">
      {state.message && (
        <span className={`text-xs ${state.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {state.message}
        </span>
      )}
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-[var(--duration-fast)] hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={14} className={pending ? "animate-pulse" : ""} />
          {pending ? "Respaldando…" : "Respaldar ahora"}
        </button>
      </form>
    </div>
  )
}
