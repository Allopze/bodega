"use client"

import * as React from "react"
import { toast } from "@/lib/toast"
import { findWorkerByRutAction } from "./actions"

export interface MatchedWorker {
  id: string
  name: string
  rut: string | null
  position: string | null
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
  const [rutSearch, setRutSearch] = React.useState("")
  const [searchingWorker, setSearchingWorker] = React.useState(false)
  const [matchedWorker, setMatchedWorker] = React.useState<MatchedWorker | null>(null)
  const [workerId, setWorkerId] = React.useState("")
  const [manual, setManual] = React.useState(false)
  const [workerName, setWorkerName] = React.useState("")
  const [workerRut, setWorkerRut] = React.useState("")
  const [workerCompany, setWorkerCompany] = React.useState("")

  function resetIdentity() {
    setMatchedWorker(null)
    setWorkerId("")
    if (!hasFaenaParam) onWorksiteChange("")
  }

  async function handleVerifyRut() {
    if (!rutSearch) return
    setSearchingWorker(true)
    resetIdentity()
    try {
      const res = await findWorkerByRutAction(rutSearch)
      if (res.ok && res.worker) {
        setMatchedWorker({
          id: res.worker.id,
          name: res.worker.name,
          rut: res.worker.rut,
          position: res.worker.position,
        })
        setWorkerId(res.worker.id)
        if (!hasFaenaParam) onWorksiteChange(res.worker.worksiteId)
        setWorkerRut(res.worker.rut ?? rutSearch)
        toast.success("Trabajador verificado.")
      } else {
        toast.error(res.message ?? "No se encontró el trabajador.")
      }
    } catch {
      toast.error("Error al buscar el trabajador.")
    } finally {
      setSearchingWorker(false)
    }
  }

  function toggleManual() {
    setManual((m) => !m)
    setMatchedWorker(null)
    setWorkerId("")
  }

  return {
    rutSearch, setRutSearch,
    searchingWorker,
    matchedWorker,
    manual,
    workerName, setWorkerName,
    workerRut, setWorkerRut,
    workerCompany, setWorkerCompany,
    workerId,
    handleVerifyRut,
    toggleManual,
    resetIdentity,
  }
}
