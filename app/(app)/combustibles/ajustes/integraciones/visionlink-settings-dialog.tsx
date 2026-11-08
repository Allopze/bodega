"use client"

import { SecretSettingField } from "@/components/admin/secret-setting-field"
import type { VisionLinkAdminStatus } from "@/lib/integrations/visionlink/visionlink-settings"
import { clearVisionLinkSettingsAction, saveVisionLinkSettingsAction, testVisionLinkConnectionAction } from "./actions"
import { IntegrationSettingsDialog, SettingTextField } from "./integration-settings-dialog"

/**
 * Credenciales y actualización diaria de VisionLink. `status` es el DTO seguro:
 * el client secret nunca cruza al navegador; el client id y el scope no son
 * secretos y vienen precargados.
 */
export function VisionLinkSettingsDialog({ status }: { status: VisionLinkAdminStatus }) {
  const { fields, canStoreSecrets } = status
  return (
    <IntegrationSettingsDialog
      idPrefix="visionlink"
      providerName="VisionLink"
      description="Las credenciales de aplicación que entrega Cat Digital Marketplace. El client secret se guarda cifrado y no vuelve a mostrarse: deja el campo vacío para conservar el valor actual."
      canStoreSecrets={canStoreSecrets}
      withoutKeyringNote="El client id, el scope y el interruptor sí se pueden guardar."
      hasStoredSettings={status.hasStoredSettings}
      syncEnabled={fields.syncEnabled.value?.trim() === "true"}
      syncDescription="Cada mañana hacia las 06:00 la plataforma lee la telemetría de los equipos de los últimos 14 días."
      saveAction={saveVisionLinkSettingsAction}
      clearAction={clearVisionLinkSettingsAction}
      testAction={testVisionLinkConnectionAction}
    >
      <SettingTextField id="visionlink-client-id" name="clientId" label="Client id" status={fields.clientId} />
      <SecretSettingField
        id="visionlink-client-secret"
        name="clientSecret"
        label="Client secret"
        type="password"
        status={fields.clientSecret}
        clearName="clearClientSecret"
        disabled={!canStoreSecrets}
      />
      <SettingTextField
        id="visionlink-scope"
        name="scope"
        label="Scope"
        status={fields.scope}
        hint="Opcional: sin valor se usa «client id/.default»."
      />
    </IntegrationSettingsDialog>
  )
}
