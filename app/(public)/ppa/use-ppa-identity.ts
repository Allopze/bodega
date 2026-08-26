"use client"

import * as React from "react"
import { useRutIdentity, type RutIdentityResult } from "@/lib/hooks/use-rut-identity"
import { findWorkerByRutAction } from "./actions"

export interface MatchedWorker {
  id: string
  name: string
  rut: string | null
  position: string | null
}

/** Match de PPA con la faena que resuelve el servidor (no se expone en la UI). */
interface PpaMatchedWorker extends MatchedWorker {
  worksiteId: string
}

interface UsePpaIdentityOptions {
  hasFaenaParam: boolean
  onWorksiteChange: (worksiteId: string) => void
}

interface UsePpaIdentityReturn {
  rutSearch: string
  setRutSearch: (v: string) => void
  searchingWorker: boolean
  matchedWorker: MatchedWorker | null
  manual: boolean
  workerName: string
  setWorkerName: (v: string) => void
  workerRut: string
  setWorkerRut: (v: string) => void
  workerCompany: string
  setWorkerCompany: (v: string) => void
  workerId: string
  handleVerifyRut: () => Promise<void>
  toggleManual: () => void
  resetIdentity: () => void
}

export function usePpaIdentity({
  hasFaenaParam,
  onWorksiteChange,
}: UsePpaIdentityOptions): UsePpaIdentityReturn {
  const [workerId, setWorkerId] = React.useState("")
  const [manual, setManual] = React.useState(false)
  const [workerName, setWorkerName] = React.useState("")
  const [workerRut, setWorkerRut] = React.useState("")
  const [workerCompany, setWorkerCompany] = React.useState("")

  /** RUT efectivamente buscado en la última verificación (fallback si el
   *  servidor devuelve match sin RUT). */
  const searchedRutRef = React.useRef("")

  const verifyByRut = React.useCallback(
    async (rut: string): Promise<RutIdentityResult<PpaMatchedWorker>> => {
      searchedRutRef.current = rut
      const res = await findWorkerByRutAction(rut)
      if (res.ok && res.worker) {
        return {
          ok: true,
          matched: {
            id: res.worker.id,
            name: res.worker.name,
            rut: res.worker.rut,
            position: res.worker.position,
            worksiteId: res.worker.worksiteId,
          },
        }
      }
      return { ok: false, message: res.message ?? "No se encontró el trabajador." }
    },
    [],
  )

  const identity = useRutIdentity<PpaMatchedWorker>({
    verify: verifyByRut,
    onBeforeVerify: React.useCallback(() => {
      setWorkerId("")
      if (!hasFaenaParam) onWorksiteChange("")
    }, [hasFaenaParam, onWorksiteChange]),
    onMatched: React.useCallback((worker: PpaMatchedWorker) => {
      setWorkerId(worker.id)
      if (!hasFaenaParam) onWorksiteChange(worker.worksiteId)
      setWorkerRut(worker.rut ?? searchedRutRef.current)
    }, [hasFaenaParam, onWorksiteChange]),
    messages: { success: "Trabajador verificado.", error: "Error al buscar el trabajador." },
  })

  function resetIdentity() {
    identity.resetMatch()
    setWorkerId("")
    if (!hasFaenaParam) onWorksiteChange("")
  }

  function toggleManual() {
    setManual((m) => !m)
    identity.resetMatch()
    setWorkerId("")
  }

  return {
    rutSearch: identity.rut,
    setRutSearch: identity.setRut,
    searchingWorker: identity.verifying,
    matchedWorker: identity.matched,
    manual,
    workerName, setWorkerName,
    workerRut, setWorkerRut,
    workerCompany, setWorkerCompany,
    workerId,
    handleVerifyRut: identity.verify,
    toggleManual,
    resetIdentity,
  }
}
