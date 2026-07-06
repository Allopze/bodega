"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { evaluatePpa } from "@/lib/ppa/evaluation"
import type { PpaAnswers, PpaStopReason } from "@/lib/ppa/types"
import { submitPpaAction, findWorkerByRutAction } from "./actions"
import { usePpaOfflineQueue } from "@/lib/pwa/hooks"
import type { PpaFormProps } from "./ppa-form.types"

interface UsePpaFormReturn {
  // State
  worksiteId: string
  setWorksiteId: (v: string) => void
  rutSearch: string
  setRutSearch: (v: string) => void
  searchingWorker: boolean
  matchedWorker: { id: string; name: string; position: string | null; worksiteName: string } | null
  manual: boolean
  setManual: (v: boolean) => void
  workerName: string
  setWorkerName: (v: string) => void
  workerRut: string
  setWorkerRut: (v: string) => void
  workerCompany: string
  setWorkerCompany: (v: string) => void
  tipoTrabajo: string
  setTipoTrabajo: (v: string) => void
  cambioPlanificado: "" | "si" | "no"
  setCambioPlanificado: (v: "" | "si" | "no") => void
  cambioDescripcion: string
  setCambioDescripcion: (v: string) => void
  peligroNoControlado: "" | "si" | "no"
  setPeligroNoControlado: (v: "" | "si" | "no") => void
  peligroDescripcion: string
  setPeligroDescripcion: (v: string) => void
  controles: string[]
  toggleControl: (v: string) => void
  seguroComenzar: "" | "si" | "no"
  setSeguroComenzar: (v: "" | "si" | "no") => void
  comp: Record<string, string>
  setComp: React.Dispatch<React.SetStateAction<Record<string, string>>>
  errors: Record<string, string[]>
  confirmOpen: boolean
  setConfirmOpen: (v: boolean) => void
  stopReasons: PpaStopReason[]
  pending: boolean
  paramWorksiteName: string
  online: boolean
  err: (k: string) => string | undefined
  // Handlers
  handleVerifyRut: () => Promise<void>
  onSubmit: (ev: React.FormEvent) => void
  toggleManual: () => void
  resetIdentity: () => void
  doSubmit: () => void
}

export function usePpaForm({
  worksites, initialWorksiteId, hasFaenaParam,
}: PpaFormProps): UsePpaFormReturn {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const { online, enqueue } = usePpaOfflineQueue()

  const [worksiteId, setWorksiteId] = React.useState(initialWorksiteId)
  const [rutSearch, setRutSearch] = React.useState("")
  const [searchingWorker, setSearchingWorker] = React.useState(false)
  const [matchedWorker, setMatchedWorker] = React.useState<{
    id: string; name: string; position: string | null; worksiteName: string
  } | null>(null)
  const [workerId, setWorkerId] = React.useState("")
  const [manual, setManual] = React.useState(false)
  const [workerName, setWorkerName] = React.useState("")
  const [workerRut, setWorkerRut] = React.useState("")
  const [workerCompany, setWorkerCompany] = React.useState("")

  const [tipoTrabajo, setTipoTrabajo] = React.useState("")
  const [cambioPlanificado, setCambioPlanificado] = React.useState<"" | "si" | "no">("")
  const [cambioDescripcion, setCambioDescripcion] = React.useState("")
  const [peligroNoControlado, setPeligroNoControlado] = React.useState<"" | "si" | "no">("")
  const [peligroDescripcion, setPeligroDescripcion] = React.useState("")
  const [controles, setControles] = React.useState<string[]>([])
  const [seguroComenzar, setSeguroComenzar] = React.useState<"" | "si" | "no">("")
  const [comp, setComp] = React.useState<Record<string, string>>({})

  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [stopReasons, setStopReasons] = React.useState<PpaStopReason[]>([])

  function resetIdentity() {
    setMatchedWorker(null)
    setWorkerId("")
    if (!hasFaenaParam) setWorksiteId("")
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
          position: res.worker.position,
          worksiteName: res.worker.worksiteName,
        })
        setWorkerId(res.worker.id)
        if (!hasFaenaParam) setWorksiteId(res.worker.worksiteId)
        setWorkerRut(rutSearch)
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

  const paramWorksiteName = hasFaenaParam
    ? worksites.find((w) => w.id === worksiteId)?.name ?? ""
    : ""

  function toggleControl(value: string) {
    setControles((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    )
  }

  function clientValidate(): boolean {
    const e: Record<string, string[]> = {}
    if (!worksiteId) e.worksiteId = ["Selecciona la faena."]
    if (manual) {
      if (workerName.trim().length < 2) e.workerName = ["Indica tu nombre."]
    } else if (!workerId) {
      e.workerId = ["Debes verificar tu RUT antes de enviar."]
    }
    if (!tipoTrabajo) e.tipoTrabajo = ["Selecciona el tipo de trabajo."]
    if (!cambioPlanificado) e.cambioPlanificado = ["Responde esta pregunta."]
    if (!peligroNoControlado) e.peligroNoControlado = ["Responde esta pregunta."]
    if (!seguroComenzar) e.seguroComenzar = ["Responde esta pregunta."]
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function buildAnswers(): PpaAnswers {
    return {
      tipoTrabajo,
      cambioPlanificado: cambioPlanificado as "si" | "no",
      cambioDescripcion: cambioDescripcion || undefined,
      peligroNoControlado: peligroNoControlado as "si" | "no",
      peligroDescripcion: peligroDescripcion || undefined,
      controles,
      seguroComenzar: seguroComenzar as "si" | "no",
      complementarias: comp,
    }
  }

  function buildPayload() {
    const name = manual ? workerName.trim() : (matchedWorker?.name ?? "")
    const rut = manual ? workerRut.trim() : rutSearch.trim()
    return {
      worksiteId,
      workerId: manual ? undefined : workerId || undefined,
      workerName: name,
      workerRut: rut || undefined,
      workerCompany: workerCompany || undefined,
      tipoTrabajo,
      cambioPlanificado: cambioPlanificado as "si" | "no",
      cambioDescripcion,
      peligroNoControlado: peligroNoControlado as "si" | "no",
      peligroDescripcion,
      controles,
      seguroComenzar: seguroComenzar as "si" | "no",
      complementarias: comp,
    }
  }

  function doSubmit() {
    setConfirmOpen(false)
    const payload = buildPayload()

    startTransition(async () => {
      if (!online) {
        try {
          await enqueue(payload)
        } catch {
          toast.error("No se pudo guardar offline. Verifica el almacenamiento del navegador.")
          return
        }
        toast.success(
          "PPA guardado offline. Se enviará automáticamente cuando vuelva la conexión.",
          { duration: 6000 },
        )
        router.push("/ppa?saved=offline")
        return
      }

      try {
        const res = await submitPpaAction(payload)
        if (res.ok && res.data?.token) {
          router.push(`/ppa/result/${res.data.token}`)
        } else {
          if (res.fieldErrors) setErrors(res.fieldErrors)
          toast.error(res.message ?? "No se pudo enviar el PPA.")
        }
      } catch (e) {
        const isNetworkError = e instanceof TypeError && /fetch|network/i.test(e.message)
        if (!isNetworkError) {
          toast.error(e instanceof Error ? e.message : "No se pudo enviar el PPA.")
          return
        }
        try {
          await enqueue(payload)
        } catch {
          toast.error("Error de red y no se pudo guardar offline. Intenta más tarde.")
          return
        }
        toast.warning(
          "Error de red. Tu PPA se ha guardado localmente y se enviará cuando vuelva la conexión.",
          { duration: 6000 },
        )
        router.push("/ppa?saved=offline")
      }
    })
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!clientValidate()) {
      toast.error("Faltan respuestas obligatorias.")
      return
    }
    const evaluation = evaluatePpa(buildAnswers())
    if (evaluation.stop) {
      setStopReasons(evaluation.reasons)
      setConfirmOpen(true)
      return
    }
    doSubmit()
  }

  function toggleManual() {
    setManual((m) => !m)
    setErrors({})
    setMatchedWorker(null)
    setWorkerId("")
  }

  const err = (k: string) => errors[k]?.[0]

  return {
    worksiteId, setWorksiteId,
    rutSearch, setRutSearch,
    searchingWorker,
    matchedWorker,
    manual, setManual,
    workerName, setWorkerName,
    workerRut, setWorkerRut,
    workerCompany, setWorkerCompany,
    tipoTrabajo, setTipoTrabajo,
    cambioPlanificado, setCambioPlanificado,
    cambioDescripcion, setCambioDescripcion,
    peligroNoControlado, setPeligroNoControlado,
    peligroDescripcion, setPeligroDescripcion,
    controles, toggleControl,
    seguroComenzar, setSeguroComenzar,
    comp, setComp,
    errors, confirmOpen, setConfirmOpen,
    stopReasons, pending,
    paramWorksiteName, online,
    err,
  // Handlers
  handleVerifyRut, onSubmit, toggleManual, resetIdentity,
  doSubmit,
  }
}
