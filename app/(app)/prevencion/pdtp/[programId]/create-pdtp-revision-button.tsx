"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import { createPdtpRevisionAction } from "../actions"

export function CreatePdtpRevisionButton({ sourceProgramId }: { sourceProgramId: string }) {
  const router = useRouter()
  const operation = useOperation()

  function createRevision() {
    operation.run(
      async () => {
        const result = await createPdtpRevisionAction(sourceProgramId)
        return {
          ...result,
          data: result.programId ? { programId: result.programId } : undefined,
        }
      },
      (result) => {
        const programId = typeof result.data?.programId === "string" ? result.data.programId : undefined
        if (programId) router.push(`/prevencion/pdtp/${programId}/editar`)
      },
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" loading={operation.pending} onClick={createRevision}>Crear revisión v+1</Button>
      {operation.message && <span className="text-xs text-[var(--color-danger)]" role="status">{operation.message}</span>}
    </span>
  )
}
