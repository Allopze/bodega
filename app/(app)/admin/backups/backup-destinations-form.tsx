"use client"

import { useCallback, useState } from "react"
import { Cloud, HardDrives, Warning, FloppyDisk, Lightning } from "@phosphor-icons/react/dist/ssr"
import { updateBackupConfigAction, probeCloudreveBackupAction } from "./actions"
import type { BackupConfig } from "@/lib/services/backups"
import { Button } from "@/components/ui/button"

interface Props {
  initialConfig: BackupConfig
  localPath: string
}

export function BackupDestinationsForm({ initialConfig, localPath }: Props) {
  const [config, setConfig] = useState<BackupConfig>(initialConfig)
  const [pathDraft, setPathDraft] = useState(initialConfig.cloudreveBackupsPath)
  const [saving, setSaving] = useState<"drive" | "cloudreve" | "path" | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null)

  const applyConfig = useCallback(async (input: Partial<BackupConfig>) => {
    setMessage(null)
    setSaving(input.driveBackupsEnabled !== undefined ? "drive"
      : input.cloudreveBackupsEnabled !== undefined ? "cloudreve" : "path")
    try {
      const updated = await updateBackupConfigAction(input)
      setConfig(updated)
      setPathDraft(updated.cloudreveBackupsPath)
      setMessage({ ok: true, text: "Guardado" })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Error al guardar" })
    } finally {
      setSaving(null)
    }
  }, [])

  const testConnection = useCallback(async () => {
    setProbe(null)
    try {
      setProbe(await probeCloudreveBackupAction())
    } catch (err) {
      setProbe({ ok: false, message: err instanceof Error ? err.message : "Error al probar" })
    }
  }, [])

  return (
    <section id="backup-destinations" className="mb-5 scroll-mt-24 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
        <Cloud size={16} className="text-[var(--color-text-muted)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Destinos de respaldo</h2>
      </div>

      <div className="space-y-4 p-4">
        {/* Local: siempre activo, path fijado por infraestructura. */}
        <div className="flex items-start gap-3">
          <HardDrives size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-text)]">Local</span>
              <span className="rounded-full bg-[var(--color-success-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success-ink)]">Siempre activo</span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Snapshot en el disco del servidor ({localPath}). El path del host lo define la infraestructura (bind mount).
            </p>
          </div>
        </div>

        {/* Cloudreve */}
        <div className="flex items-start gap-3">
          <Cloud size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <input
                id="cloudreve-enabled"
                type="checkbox"
                checked={config.cloudreveBackupsEnabled}
                disabled={saving === "cloudreve"}
                onChange={(e) => applyConfig({ cloudreveBackupsEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
              />
              <label htmlFor="cloudreve-enabled" className="text-sm font-medium text-[var(--color-text)]">
                Subir a Cloudreve (WebDAV)
              </label>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Usa las credenciales configuradas en Administración › Almacenamiento de documentos. Si el upload falla, el respaldo se marca fallido.
            </p>

            {config.cloudreveBackupsEnabled && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={pathDraft}
                  disabled={saving === "path"}
                  onChange={(e) => setPathDraft(e.target.value)}
                  aria-label="Carpeta remota de respaldos"
                  className="h-8 w-64 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-sm font-mono text-[var(--color-text)] focus:border-[var(--color-focus-ring)] focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={saving === "path" || pathDraft === config.cloudreveBackupsPath}
                  onClick={() => applyConfig({ cloudreveBackupsPath: pathDraft })}
                >
                  <FloppyDisk size={14} />
                  Guardar carpeta
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={testConnection}>
                  <Lightning size={14} />
                  Probar conexión
                </Button>
              </div>
            )}
            {probe && (
              <p className={`mt-2 text-xs ${probe.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                {probe.message}
              </p>
            )}
          </div>
        </div>

        {/* Google Drive (off por defecto) */}
        <div className="flex items-start gap-3">
          <Warning size={16} className="mt-0.5 text-[var(--color-text-muted)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <input
                id="drive-enabled"
                type="checkbox"
                checked={config.driveBackupsEnabled}
                disabled={saving === "drive"}
                onChange={(e) => applyConfig({ driveBackupsEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
              />
              <label htmlFor="drive-enabled" className="text-sm font-medium text-[var(--color-text)]">
                Google Drive (rclone)
              </label>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Desactivado por defecto: el destino remoto activo es Cloudreve. Requiere rclone con Service Account.
            </p>
          </div>
        </div>

        {message && (
          <p className={`text-xs ${message.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  )
}
