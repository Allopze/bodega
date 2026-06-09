"use client"

import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { updateSystemSettings } from "./actions"
import type { CompanyProfile } from "@/lib/services/system-settings"

interface ConfigFormProps {
  initialPdfMaxSizeMb:   number
  initialCompanyProfile: CompanyProfile
}

export function ConfigForm({ initialPdfMaxSizeMb, initialCompanyProfile }: ConfigFormProps) {
  const [state, formAction] = useActionState(updateSystemSettings, INITIAL_STATE)

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Configuración guardada")
    } else if (state.message && !state.fieldErrors) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <form action={formAction} className="max-w-3xl space-y-6">
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-h2 text-[var(--color-text)]">
            Datos de empresa para órdenes de compra
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Estos datos aparecen en la versión imprimible que se envía al proveedor.
          </p>
        </div>

        {state.message && !state.ok && !state.fieldErrors && (
          <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
        )}

        <FieldGroup className="gap-5">
          <div className="grid grid-cols-1 md:grid-cols-[1.4fr_0.8fr] gap-4">
            <Field
              label="Razón social o nombre"
              htmlFor="company-name"
              required
              helper="Se imprimirá en el encabezado de la orden de compra."
              error={state.fieldErrors?.companyName?.[0]}
            >
              <Input
                id="company-name"
                name="companyName"
                defaultValue={initialCompanyProfile.name}
                error={!!state.fieldErrors?.companyName}
              />
            </Field>
            <Field
              label="RUT"
              htmlFor="company-rut"
              helper="Opcional."
              error={state.fieldErrors?.companyRut?.[0]}
            >
              <Input
                id="company-rut"
                name="companyRut"
                defaultValue={initialCompanyProfile.rut}
                placeholder="76123456-7"
                error={!!state.fieldErrors?.companyRut}
                className="font-mono"
              />
            </Field>
          </div>

          <Field
            label="Dirección"
            htmlFor="company-address"
            helper="Casa matriz, oficina o dirección comercial."
            error={state.fieldErrors?.companyAddress?.[0]}
          >
            <Input
              id="company-address"
              name="companyAddress"
              defaultValue={initialCompanyProfile.address}
              placeholder="Av. Principal 1234, Santiago"
              error={!!state.fieldErrors?.companyAddress}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field
              label="Teléfono"
              htmlFor="company-phone"
              helper="Opcional."
              error={state.fieldErrors?.companyPhone?.[0]}
            >
              <Input
                id="company-phone"
                name="companyPhone"
                defaultValue={initialCompanyProfile.phone}
                placeholder="+56 9 8765 4321"
                error={!!state.fieldErrors?.companyPhone}
              />
            </Field>
            <Field
              label="Correo"
              htmlFor="company-email"
              helper="Opcional."
              error={state.fieldErrors?.companyEmail?.[0]}
            >
              <Input
                id="company-email"
                name="companyEmail"
                type="email"
                defaultValue={initialCompanyProfile.email}
                placeholder="compras@chome.cl"
                error={!!state.fieldErrors?.companyEmail}
              />
            </Field>
            <Field
              label="Sitio web"
              htmlFor="company-website"
              helper="Opcional."
              error={state.fieldErrors?.companyWebsite?.[0]}
            >
              <Input
                id="company-website"
                name="companyWebsite"
                defaultValue={initialCompanyProfile.website}
                placeholder="www.chome.cl"
                error={!!state.fieldErrors?.companyWebsite}
              />
            </Field>
          </div>
        </FieldGroup>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <h2 className="text-base font-semibold text-[var(--color-text)] mb-4">
          Parámetros de carga de archivos
        </h2>

        <FieldGroup className="gap-6">
          <Field
            label="Límite de tamaño de archivo PDF (MB)"
            htmlFor="pdf-max-size"
            required
            helper="Define el tamaño máximo en Megabytes para la subida de facturas anexas en formato PDF."
            error={state.fieldErrors?.pdfMaxSizeMb?.[0]}
          >
            <div className="flex items-center gap-3">
              <Input
                id="pdf-max-size"
                name="pdfMaxSizeMb"
                type="number"
                min="1"
                max="500"
                defaultValue={initialPdfMaxSizeMb}
                error={!!state.fieldErrors?.pdfMaxSizeMb}
                className="w-32 font-mono text-center"
              />
              <span className="text-sm font-medium text-[var(--color-text-muted)]">
                MB
              </span>
            </div>
          </Field>
        </FieldGroup>
      </div>

      <div className="flex justify-end">
        <SubmitButton label="Guardar Configuración" loadingLabel="Guardando..." variant="primary" />
      </div>
    </form>
  )
}
