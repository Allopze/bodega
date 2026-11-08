"use client"

import { useEffect, useRef, useState } from "react"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { SettingSource } from "@/lib/services/encrypted-settings"

/** De dónde sale un valor, dicho para quien administra (no para quien programa). */
export const SETTING_SOURCE_LABELS: Record<SettingSource, string> = {
  system_settings: "Guardado en la plataforma",
  environment: "Del servidor (.env)",
  missing: "Sin configurar",
}

export interface SecretSettingFieldProps {
  id: string
  /** Nombre del campo en el `FormData`. */
  name: string
  label: string
  /** Estado del campo en el DTO de la pantalla: nunca trae el valor. */
  status: { configured: boolean; source: SettingSource }
  /**
   * Nombre de la casilla «Borrar». Sólo se ofrece cuando el valor vino de la
   * plataforma: con el valor heredado del `.env`, borrar no tendría efecto.
   */
  clearName?: string
  placeholder?: string
  type?: "text" | "email" | "password"
  disabled?: boolean
}

/**
 * Campo de credencial de solo escritura.
 *
 * Siempre parte vacío —el valor guardado no cruza al navegador— y vacío
 * conserva lo que hay. Borrar es explícito, y la casilla se deshabilita
 * mientras se escribe un valor nuevo: escribir y borrar a la vez es
 * contradictorio y el servidor lo rechaza.
 *
 * Generaliza el `SecretField` que vivía en el formulario del DTE, con la regla
 * del formulario de Cloudreve para la casilla «Borrar».
 */
export function SecretSettingField({
  id,
  name,
  label,
  status,
  clearName,
  placeholder,
  type = "text",
  disabled = false,
}: SecretSettingFieldProps) {
  const [typed, setTyped] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // React vacía los campos no controlados al terminar una acción de formulario
  // (`form.reset()`). El espejo `typed` tiene que vaciarse con ellos, o la
  // casilla «Borrar» quedaría deshabilitada junto a un campo vacío.
  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    const onReset = () => setTyped(false)
    form.addEventListener("reset", onReset)
    return () => form.removeEventListener("reset", onReset)
  }, [])

  const helper = status.configured
    ? `${SETTING_SOURCE_LABELS[status.source]} · vacío conserva el valor actual.`
    : "Sin configurar."

  return (
    <div className="space-y-2">
      <Field label={label} htmlFor={id} helper={helper}>
        <Input
          ref={inputRef}
          id={id}
          name={name}
          type={type}
          placeholder={status.configured && type === "password" ? "••••••••" : placeholder}
          autoComplete={type === "password" ? "new-password" : "off"}
          disabled={disabled}
          onChange={(event) => setTyped(event.currentTarget.value.length > 0)}
        />
      </Field>
      {clearName && status.source === "system_settings" && (
        <Checkbox
          id={`${id}-clear`}
          name={clearName}
          value="on"
          disabled={disabled || typed}
          label={`Borrar el valor guardado (${label})`}
        />
      )}
    </div>
  )
}

/**
 * Aviso de que el servidor no tiene llavero: sin él no se guarda ningún
 * secreto. `children` explica qué SÍ se puede guardar en esa pantalla.
 */
export function SettingsKeyringCallout({ children }: { children?: React.ReactNode }) {
  return (
    <Callout tone="danger" role="alert" title="No hay llavero de cifrado en el servidor">
      Sin <code>DTE_SETTINGS_KEYRING</code> no se puede guardar ninguna credencial: el guardado se
      rechaza en vez de escribirla en claro.{children ? <> {children}</> : null}
    </Callout>
  )
}
