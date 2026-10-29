"use client"

import { useEffect, useState } from "react"
import { listDrafts } from "@/lib/mantencion/client/drafts"
import { subscribe } from "@/lib/mantencion/client/events"
import type { FlowDraft } from "@/lib/mantencion/client/flow-types"

/** Borradores sin terminar de una cuenta (uno por tipo). Se relee cuando se guarda, se firma o se descarta. */
export function useDrafts(userId: string): FlowDraft[] {
  const [drafts, setDrafts] = useState<FlowDraft[]>([])
  useEffect(() => {
    let cancelled = false
    const load = () => { void listDrafts(userId).then((list) => { if (!cancelled) setDrafts(list) }).catch(() => {}) }
    load()
    const off = subscribe("drafts", load)
    return () => { cancelled = true; off() }
  }, [userId])
  return drafts
}
