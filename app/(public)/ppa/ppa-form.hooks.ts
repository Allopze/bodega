"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/lib/toast"
import { evaluatePpa } from "@/lib/ppa/evaluation"
import type { PpaAnswers, PpaStopReason } from "@/lib/ppa/types"
import { ppaSubmitSchema } from "@/lib/validation/ppa"
import { submitPpaAction } from "./actions"
import { usePpaOfflineQueue } from "@/lib/pwa/hooks"
import { usePpaIdentity } from "./use-ppa-identity"
import type { PpaFormProps } from "./ppa-form.types"

interface UsePpaFormReturn {
  worksiteId: string
  setWorksiteId: (v: string) => void
  workPermitId: string
  setWorkPermitId: (v: string) => void
  rutSearch: string
  setRutSearch: (v: string) => void
  searchingWorker: boolean
  matchedWorker: { id: string; name: string; rut: string | null; position: string | null } | null
  manual: boolean
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
  resolvedWorksiteName: string
  online: boolean
  savedOffline: boolean
  err: (k: string) => string | undefined
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

  const [worksiteId, setWorksiteIdRaw] = React.useState(initialWorksiteId)
  const [workPermitId, setWorkPermitId] = React.useState("")

  // Un permiso pertenece a una faena: cambiar de faena vuelve a dejar el
  // permiso sin elegir, en vez de arrastrar el de la faena anterior.
  function setWorksiteId(next: string) {
    setWorksiteIdRaw(next)
    setWorkPermitId("")
  }

  const identity = usePpaIdentity({
    hasFaenaParam,
    onWorksiteChange: setWorksiteId,
  })

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
  const [savedOffline, setSavedOffline] = React.useState(false)

  // La acción pública de verificación por RUT no devuelve el nombre de la
  // faena (minimización de PII — ver findWorkerByRutAction), solo su id.
  // El nombre se resuelve acá contra `worksites` (ya público, es la misma
  // lista que alimenta el <Select> del modo manual) para poder mostrar
  // confirmación tanto si la faena vino de ?faena= como si se derivó del RUT.
  const resolvedWorksiteName = worksites.find((w) => w.id === worksiteId)?.name ?? ""

  function toggleControl(value: string) {
    setControles((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    )
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
    const name = identity.manual ? identity.workerName.trim() : (identity.matchedWorker?.name ?? "")
    const rut = identity.manual ? identity.workerRut.trim() : identity.rutSearch.trim()
    return {
      worksiteId,
      workPermitId: workPermitId || undefined,
      workerId: identity.manual ? undefined : identity.workerId || undefined,
      workerName: name,
      workerRut: rut || undefined,
      workerCompany: identity.workerCompany || undefined,
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

  // Muestra la confirmación de guardado offline sin navegar. router.push a
  // "/ppa?saved=offline" requiere un roundtrip RSC al servidor para el nuevo
  // searchParam — sin red ese roundtrip falla, cae a navegación de documento
  // completo, y el Service Worker (que solo cachea "/ppa" sin query) sirve su
  // fallback offline genérico en vez del formulario/confirmación real. Un
  // flag de estado local evita la navegación por completo (no se usa
  // history.pushState: escribir el historial fuera de next/navigation puede
  // desincronizar el estado interno del router de App Router).
  function showOfflineSaved() {
    setSavedOffline(true)
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
        showOfflineSaved()
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
        showOfflineSaved()
      }
    })
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    const payload = buildPayload()
    const parsed = ppaSubmitSchema.safeParse(payload)
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>)
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

  const err = (k: string) => errors[k]?.[0]

  return {
    worksiteId, setWorksiteId,
    workPermitId, setWorkPermitId,
    rutSearch: identity.rutSearch, setRutSearch: identity.setRutSearch,
    searchingWorker: identity.searchingWorker,
    matchedWorker: identity.matchedWorker,
    manual: identity.manual,
    workerName: identity.workerName, setWorkerName: identity.setWorkerName,
    workerRut: identity.workerRut, setWorkerRut: identity.setWorkerRut,
    workerCompany: identity.workerCompany, setWorkerCompany: identity.setWorkerCompany,
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
    resolvedWorksiteName, online,
    savedOffline,
    err,
    handleVerifyRut: identity.handleVerifyRut,
    onSubmit,
    toggleManual: identity.toggleManual,
    resetIdentity: identity.resetIdentity,
    doSubmit,
  }
}
