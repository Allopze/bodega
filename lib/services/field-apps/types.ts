/**
 * lib/services/field-apps/types.ts — Lo que las lecturas de TI devuelven sobre
 * las apps del teléfono (`overview.ts`) y las páginas de `/ti/apps` pintan.
 *
 * Sin cifras de negocio (PPA detenidos, litros, preventivas): eso vive en cada
 * módulo. Acá sólo funcionamiento y uso.
 */
import type { FieldAppId } from "@/lib/apps/field-apps"
import type { DeviceState } from "@/lib/apps/device-state"

export interface FieldAppSummary {
  app:                      FieldAppId
  /** El módulo de la app está encendido. */
  enabled:                  boolean
  /** Primer aviso recibido de esta app; null = todavía ninguno (no es «nadie la usa»). */
  firstReportAt:            string | null
  lastReportAt:             string | null
  /** Teléfonos con aviso en `ACTIVE_WINDOW_MS`. */
  activeDevices:            number
  /** Teléfonos con aviso en `FORGET_AFTER_MS` (los que se muestran). */
  seenDevices:              number
  byState:                  Record<DeviceState, number>
  versionBehind:            number
  /** Accesos por vencer + sin uso (credenciales del mecánico o enlaces TAE). */
  accessesNeedingAttention: number
  /** Último envío que llegó desde la app (registro, PPA o carga). */
  lastSubmissionAt:         string | null
}

export interface FieldDeviceRow {
  app:             FieldAppId
  deviceId:        string
  platform:        string
  installed:       boolean
  version:         string
  builtAt:         string | null
  versionBehind:   boolean
  state:           DeviceState
  pendingCount:    number
  failedCount:     number
  oldestPendingAt: string | null
  lastAttemptAt:   string | null
  lastError:       string | null
  lastErrorAt:     string | null
  firstSeenAt:     string
  lastSeenAt:      string
  /** Sólo Mantención, cuando una credencial válida identificó a la persona. */
  userName:        string | null
  worksiteName:    string | null
  /** Sólo TAE: rótulo del enlace con que entró el teléfono, y su estado. */
  linkLabel:       string | null
  linkStatus:      "active" | "revoked" | "expired" | null
}

/** Demora entre llenar o firmar un envío y que llegue al servidor, por semana. */
export interface LatencyWeek {
  /** Lunes de la semana (Chile), `YYYY-MM-DD`. */
  weekStart:    string
  count:        number
  p50Minutes:   number | null
  p90Minutes:   number | null
  /** Fracción 0–1 de envíos hechos sin señal; null sin envíos. */
  offlineShare: number | null
}

/** Uso: por faena (PPA, TAE) o por persona (Mantención). */
export interface UsageRow {
  key:              string
  label:            string
  activeDevices:    number
  lastSubmissionAt: string | null
  submissions30d:   number
  /** Tenía envíos en los 30 días previos a los últimos 7 y ninguno en esos 7. */
  stopped:          boolean
}

export interface AccessLinkRow {
  id:            string
  label:         string
  worksiteName:  string
  status:        "active" | "revoked" | "expired"
  lastUsedAt:    string | null
  activeDevices: number
}

export interface AccessSummary {
  kind:                "credentials" | "links"
  active:              number
  expiringSoon:        number
  unused:              number
  revokedOrExpired30d: number
  /** Sólo TAE; vacío para las credenciales del mecánico. */
  links:               AccessLinkRow[]
}

export interface CaptureQuality {
  /** Identificación manual (trabajador no encontrado en la nómina) por faena, 30 días. */
  manualIdentity: Array<{ worksiteId: string; worksiteName: string; total: number; manual: number }>
  /** Sólo TAE: lectura del medidor por OCR contra digitada, por semana. */
  ocrWeeks:       Array<{ weekStart: string; readings: number; ocr: number; manual: number; avgConfidence: number | null }> | null
}
