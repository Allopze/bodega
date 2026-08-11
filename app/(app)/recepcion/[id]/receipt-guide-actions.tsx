"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { prepareAdditionalGuideAction } from "@/app/(app)/bodega/guias/actions"

export function ReceiptGuideActions({ receiptId, canPrepare }: { receiptId: string; canPrepare: boolean }) {
  const router = useRouter()
  const { pending, run } = useOperation()

  if (!canPrepare) return null

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      disabled={pending}
      onClick={() => run(async () => {
        const result = await prepareAdditionalGuideAction(receiptId)
        if (result.ok) {
          toast.success(result.message ?? "Guía preparada")
          const guideId = typeof result.data?.guideId === "string" ? result.data.guideId : null
          if (guideId) router.push(`/bodega/guias/${guideId}`)
          else router.refresh()
        } else {
          toast.error(result.message ?? "No se pudo preparar la guía")
        }
        return result
      })}
    >
      Preparar otro despacho
    </Button>
  )
}
