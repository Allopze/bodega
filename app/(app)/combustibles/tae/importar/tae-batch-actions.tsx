"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowClockwise } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { reprocessTaeImportBatchAction } from "./actions"

export function ReprocessTaeBatchButton({ batchId, canReprocess }: { batchId: string; canReprocess: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  if (!canReprocess) return null

  async function handleReprocess() {
    setLoading(true)
    try {
      const result = await reprocessTaeImportBatchAction(batchId)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else toast.error(result.message)
    } finally {
      setLoading(false)
    }
  }

  return <Button type="button" variant="secondary" size="sm" onClick={handleReprocess} disabled={loading}><ArrowClockwise className="h-4 w-4" />{loading ? "Reprocesando…" : "Reprocesar rechazadas"}</Button>
}
