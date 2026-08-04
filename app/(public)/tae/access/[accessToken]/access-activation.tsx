"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleNotch, WarningCircle } from "@phosphor-icons/react"
import { saveTaeAccessConfig, saveTaeAccessToken } from "@/lib/pwa/tae-offline-queue"
import { Button } from "@/components/ui/button"

type ActivationFailure = {
  code: "TAE-ACCESS-404" | "TAE-ACCESS-429" | "TAE-ACCESS-STORAGE" | "TAE-ACCESS-NETWORK"
  title: string
  message: string
  nextStep: string
}

class TaeAccessActivationError extends Error {
  constructor(readonly failure: ActivationFailure) {
    super(failure.message)
  }
}

function responseFailure(status: number): ActivationFailure {
  if (status === 404) {
    return {
      code: "TAE-ACCESS-404",
      title: "Este enlace TAE ya no está disponible",
      message: "Puede haber vencido, sido revocado o no corresponder a este punto de carga.",
      nextStep: "Escanea un QR vigente del punto autorizado y vuelve a intentarlo.",
    }
  }
  if (status === 429) {
    return {
      code: "TAE-ACCESS-429",
      title: "Este dispositivo debe esperar antes de continuar",
      message: "Se alcanzó temporalmente el límite de preparación del acceso.",
      nextStep: "Espera unos minutos y luego usa Reintentar. No necesitas volver a completar datos.",
    }
  }
  return {
    code: "TAE-ACCESS-NETWORK",
    title: "No se pudo confirmar el acceso TAE",
    message: "El servicio no respondió como se esperaba.",
    nextStep: "Comprueba la conexión e inténtalo nuevamente.",
  }
}

function classifyFailure(cause: unknown): ActivationFailure {
  if (cause instanceof TaeAccessActivationError) return cause.failure
  if (cause instanceof DOMException && ["QuotaExceededError", "SecurityError", "InvalidStateError"].includes(cause.name)) {
    return {
      code: "TAE-ACCESS-STORAGE",
      title: "Este navegador no pudo guardar el acceso",
      message: "TAE necesita almacenamiento local para conservar la faena y poder trabajar sin conexión.",
      nextStep: "Habilita el almacenamiento para este sitio o usa otro navegador/dispositivo y luego reintenta.",
    }
  }
  return {
    code: "TAE-ACCESS-NETWORK",
    title: "No se pudo preparar este dispositivo",
    message: "No fue posible validar y guardar el acceso TAE en este momento.",
    nextStep: "Comprueba la conexión e inténtalo nuevamente. Si continúa, informa el código de soporte.",
  }
}

export function TaeAccessActivation({ accessToken }: { accessToken: string }) {
  const router = useRouter()
  const [failure, setFailure] = React.useState<ActivationFailure | null>(null)
  const [preparing, setPreparing] = React.useState(true)
  const mounted = React.useRef(true)
  const activeRequest = React.useRef<AbortController | null>(null)
  const retryRef = React.useRef<HTMLButtonElement>(null)

  const activate = React.useCallback(async () => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setPreparing(true)
    setFailure(null)
    try {
      const response = await fetch("/api/tae/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
        signal: controller.signal,
      })
      if (!response.ok) throw new TaeAccessActivationError(responseFailure(response.status))
      const body = await response.json() as { ok: boolean; data?: Record<string, unknown>; message?: string }
      if (!body.ok || !body.data) throw new TaeAccessActivationError(responseFailure(500))
      try {
        await Promise.all([saveTaeAccessToken(accessToken), saveTaeAccessConfig(body.data)])
      } catch (cause) {
        const storageFailure = classifyFailure(cause)
        throw new TaeAccessActivationError(storageFailure.code === "TAE-ACCESS-NETWORK"
          ? {
              code: "TAE-ACCESS-STORAGE",
              title: "Este navegador no pudo guardar el acceso",
              message: "TAE necesita almacenamiento local para conservar la faena y poder trabajar sin conexión.",
              nextStep: "Habilita el almacenamiento para este sitio o usa otro navegador/dispositivo y luego reintenta.",
            }
          : storageFailure)
      }
      if (mounted.current && !controller.signal.aborted) router.replace("/tae")
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return
      setFailure(classifyFailure(cause))
    } finally {
      if (mounted.current && activeRequest.current === controller) setPreparing(false)
    }
  }, [accessToken, router])

  React.useEffect(() => {
    mounted.current = true
    void activate()
    return () => {
      mounted.current = false
      activeRequest.current?.abort()
    }
  }, [activate])

  React.useEffect(() => {
    if (failure) retryRef.current?.focus()
  }, [failure])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-6">
      <div className="w-full rounded-[var(--radius-2xl)] border border-(--color-border) bg-(--color-surface) p-6 text-center shadow-[var(--shadow-lg)]">
        {failure ? <section role="alert" aria-live="assertive">
          <WarningCircle size={36} className="mx-auto text-[var(--color-danger)]" aria-hidden />
          <p className="mt-4 text-eyebrow text-[var(--color-danger-ink)]">Acceso TAE pendiente</p>
          <h1 className="mt-1 text-h2">{failure.title}</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{failure.message}</p>
          <p className="mt-3 text-sm text-[var(--color-text)]">{failure.nextStep}</p>
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">Código de soporte: <span className="font-mono">{failure.code}</span></p>
          <Button ref={retryRef} type="button" className="mt-5 w-full" size="lg" onClick={() => void activate()} loading={preparing}>Reintentar</Button>
        </section> : <>
          <CircleNotch size={30} className="mx-auto animate-spin text-[var(--color-primary)]" />
          <h1 className="mt-4 text-h2">Preparando Control TAE</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]" aria-live="polite">Este enlace configurará la faena y el punto de carga en este dispositivo.</p>
        </>}
      </div>
    </main>
  )
}
