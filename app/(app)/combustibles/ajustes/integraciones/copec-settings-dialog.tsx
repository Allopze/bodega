"use client"

import { SecretSettingField } from "@/components/admin/secret-setting-field"
import type { CopecAdminStatus } from "@/lib/combustibles/copec-settings"
import { clearCopecSettingsAction, saveCopecSettingsAction, testCopecConnectionAction } from "./actions"
import { IntegrationSettingsDialog, SettingTextField } from "./integration-settings-dialog"

/**
 * Credenciales y actualización diaria de Copec. `status` es el DTO seguro: dice
 * si cada campo está configurado y de dónde viene, y trae el valor sólo del RUT
 * y del correo; usuario y contraseña no cruzan nunca al navegador.
 */
export function CopecSettingsDialog({ status }: { status: CopecAdminStatus }) {
  const { fields, canStoreSecrets } = status
  return (
    <IntegrationSettingsDialog
      idPrefix="copec"
      providerName="Copec"
      description="Usuario y contraseña de la cuenta ADMINISTRADOR CLIENTE del portal de Copec, con el RUT de la empresa. Los secretos se guardan cifrados y no vuelven a mostrarse: deja un campo vacío para conservar el valor actual."
      canStoreSecrets={canStoreSecrets}
      withoutKeyringNote="El RUT, el usuario de la corrida y el interruptor sí se pueden guardar."
      hasStoredSettings={status.hasStoredSettings}
      syncEnabled={fields.syncEnabled.value?.trim() !== "false"}
      syncDescription="Cada mañana hacia las 05:30 la plataforma lee las cargas nuevas, sin descargar planillas."
      saveAction={saveCopecSettingsAction}
      clearAction={clearCopecSettingsAction}
      testAction={testCopecConnectionAction}
    >
      <SecretSettingField
        id="copec-username"
        name="username"
        label="Usuario"
        status={fields.username}
        clearName="clearUsername"
        disabled={!canStoreSecrets}
      />
      <SecretSettingField
        id="copec-password"
        name="password"
        label="Contraseña"
        type="password"
        status={fields.password}
        clearName="clearPassword"
        disabled={!canStoreSecrets}
      />
      <SettingTextField
        id="copec-client-rut"
        name="clientRut"
        label="RUT de la empresa"
        status={fields.clientRut}
        placeholder="12345678-9"
      />
      <SettingTextField
        id="copec-importer-email"
        name="importerEmail"
        label="Usuario que registra la actualización"
        status={fields.importerEmail}
        type="email"
        placeholder="correo@empresa.cl"
        hint="Debe ser un usuario activo: la corrida automática queda a su nombre."
      />
    </IntegrationSettingsDialog>
  )
}
