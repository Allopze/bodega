"use client"

import { useState, useEffect, useCallback } from "react"
import { Gear, Clock, CalendarDots, Warning, Hourglass } from "@phosphor-icons/react/dist/ssr"
import { getBackupConfigAction, updateBackupConfigAction } from "./actions"
import type { BackupConfig } from "@/lib/services/backups"

const FIELD_ICONS = {
  backupHour: Clock,
  retentionDays: CalendarDots,
  maxAgeHours: Warning,
  manualTimeoutMinutes: Hourglass,
} as const

interface FieldDef {
  key: keyof BackupConfig
  label: string
  unit: string
  min: number
  max: number
  description: string
}

const FIELDS: FieldDef[] = [
  {
    key: "backupHour",
    label: "Hora UTC del backup",
    unit: "h",
    min: 0,
    max: 23,
    description: "Hora del backup diario (0 = medianoche UTC, 3 = madrugada Chile)",
  },
  {
    key: "retentionDays",
    label: "Días de retención",
    unit: "días",
    min: 1,
    max: 365,
    description: "Backups más antiguos se eliminan del disco y de Google Drive",
  },
  {
    key: "maxAgeHours",
    label: "Alerta de antigüedad",
    unit: "h",
    min: 1,
    max: 168,
    description: "Si el último backup supera esta edad, se marca como crítico",
  },
  {
    key: "manualTimeoutMinutes",
    label: "Timeout manual",
    unit: "min",
    min: 5,
    max: 120,
    description: "Tiempo máximo para un backup lanzado desde este panel",
  },
]

export function BackupSettingsForm() {
  const [config, setConfig] = useState<BackupConfig | null>(null)
  const [edited, setEdited] = useState<Partial<Record<keyof BackupConfig, number>>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    getBackupConfigAction().then(setConfig).catch(() => setConfig(null))
  }, [])

  const getValue = useCallback(
    (key: keyof BackupConfig): number => {
      if (key in edited) return edited[key]!
      if (config) return config[key]
      return 0
    },
    [config, edited],
  )

  const handleChange = useCallback((key: keyof BackupConfig, value: number) => {
    setEdited((prev) => ({ ...prev, [key]: value }))
    setMessage(null)
  }, [])

  const handleSave = useCallback(async (key: keyof BackupConfig) => {
    const value = edited[key]
    if (value === undefined) return

    setSaving(true)
    setMessage(null)
    try {
      const updated = await updateBackupConfigAction({ [key]: value })
      setConfig(updated)
      setEdited((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setMessage({ ok: true, text: "Guardado" })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Error al guardar" })
    } finally {
      setSaving(false)
    }
  }, [edited])

  if (!config) return null

  return (
    <section id="backup-settings" className="mb-5 scroll-mt-24 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
        <Gear size={16} className="text-[var(--color-text-muted)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Configuración de respaldos</h2>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((field) => {
            const Icon = FIELD_ICONS[field.key]
            const value = getValue(field.key)
            const dirty = field.key in edited
            const original = config[field.key]

            return (
              <div key={field.key} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Icon size={14} className="text-[var(--color-text-muted)]" />
                  <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {field.label}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={value}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val !== "" && !Number.isNaN(Number(val))) {
                        handleChange(field.key, Number(val))
                      }
                    }}
                    aria-label={field.label}
                    className="h-8 w-16 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-center text-sm font-mono tabular-nums text-[var(--color-text)] transition-colors focus:border-[var(--color-focus-ring)] focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]"
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{field.unit}</span>

                  {dirty && (
                    <button
                      type="button"
                      onClick={() => handleSave(field.key)}
                      disabled={saving || value < field.min || value > field.max}
                      className="ml-auto rounded-[var(--radius)] bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Guardar
                    </button>
                  )}

                  {!dirty && original !== undefined && (
                    <span className="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">
                      {original}
                    </span>
                  )}
                </div>

                <p className="text-[11px] leading-tight text-[var(--color-text-muted)]">
                  {field.description}
                </p>
              </div>
            )
          })}
        </div>

        {message && (
          <p className={`mt-3 text-xs ${message.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  )
}
