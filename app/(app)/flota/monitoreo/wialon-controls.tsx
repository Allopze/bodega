"use client"

import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr"
import { useRouter } from "next/navigation"
import { SecretSettingField } from "@/components/admin/secret-setting-field"
import { IntegrationSettingsDialog, SettingTextField } from "@/components/admin/integration-settings-dialog"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import type { WialonAdminStatus } from "@/lib/integrations/wialon/wialon-settings"
import {
  clearWialonSettingsAction,
  runWialonSyncAction,
  saveWialonSettingsAction,
  testWialonConnectionAction,
} from "./actions"

/**
 * Configuración de Wialon en Monitoreo GPS. Comparte el diálogo de integraciones
 * con Copec/VisionLink; el token nunca vuelve al navegador y el botón de
 * actualización manual usa el mismo sync que el cron.
 */
export function WialonControls({ status }: { status: WialonAdminStatus }) {
  const router = useRouter()
  const sync = useOperation({ feedback: "toast", onSuccess: () => router.refresh() })
  const { fields, canStoreSecrets } = status

  return (
    <div className="flex flex-wrap items-center gap-2">
      <IntegrationSettingsDialog
        idPrefix="wialon"
        providerName="Wialon"
        description="Token de API de Wialon Hosting. El cruce con la flota usa el vínculo manual, la patente del perfil de la unidad, su VIN, el código o el nombre."
        canStoreSecrets={canStoreSecrets}
        withoutKeyringNote="La URL, los parámetros y el interruptor sí se pueden guardar; el token debe venir de WIALON_TOKEN en el servidor."
        hasStoredSettings={status.hasStoredSettings}
        syncEnabled={fields.syncEnabled.value?.trim() === "true"}
        syncLabel="Actualización automática"
        syncDescription="Cada 5 minutos la plataforma lee los medidores y el último mensaje de cada unidad, desfasada de OnWay. Con Monitoreo GPS abierto, la posición se actualiza cada 10 segundos."
        saveAction={saveWialonSettingsAction}
        clearAction={clearWialonSettingsAction}
        testAction={testWialonConnectionAction}
      >
        <SettingTextField
          id="wialon-base-url"
          name="baseUrl"
          label="URL de Wialon"
          status={fields.baseUrl}
          placeholder="https://hst-api.wialon.com"
          hint="Sólo el origen; la plataforma agrega /wialon/ajax.html."
        />
        <SecretSettingField
          id="wialon-token"
          name="token"
          label="Token de API"
          type="password"
          status={fields.token}
          clearName="clearToken"
          disabled={!canStoreSecrets}
        />
        <details className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
            Parámetros de sensores
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              El odómetro y el horómetro salen de los contadores que mantiene Wialon. Sólo si la cuenta los
              lleva en un sensor propio, escribe aquí el nombre de su parámetro en el mensaje; un valor
              ausente se muestra como «sin dato», no como 0.
            </p>
            <SettingTextField
              id="wialon-odometer-param"
              name="odometerParam"
              label="Odómetro"
              status={fields.odometerParam}
              placeholder="Contador de Wialon"
              hint="Vacío = contador de Wialon."
            />
            <SettingTextField
              id="wialon-hour-meter-param"
              name="hourMeterParam"
              label="Horómetro"
              status={fields.hourMeterParam}
              placeholder="Contador de Wialon"
              hint="Vacío = contador de Wialon."
            />
            <SettingTextField
              id="wialon-fuel-level-param"
              name="fuelLevelParam"
              label="Nivel de estanque"
              status={fields.fuelLevelParam}
              placeholder="fuel_level"
            />
          </div>
        </details>
      </IntegrationSettingsDialog>

      <Button
        type="button"
        size="sm"
        disabled={!status.fields.token.configured}
        loading={sync.pending}
        onClick={() => sync.run(runWialonSyncAction)}
      >
        <ArrowClockwise size={14} aria-hidden />
        Actualizar ahora
      </Button>
    </div>
  )
}
