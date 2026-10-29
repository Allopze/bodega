import { createHash } from "node:crypto"
import sharp from "sharp"
import { daysAgo } from "./mantencion-sync-fixtures"

/** Utilidades de las pruebas que llaman los handlers `/api/mantencion/*` directamente con `Request`. */

const ORIGIN = "http://localhost"

export async function makeJpeg(width = 32, height = 24, color = "#1e6e3e"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer()
}

export function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex")
}

export async function metaFor(buffer: Buffer, overrides: Record<string, unknown> = {}) {
  const info = await sharp(buffer).metadata()
  return {
    kind: "filtros", sha256: sha256(buffer), width: info.width, height: info.height,
    stampedAt: new Date().toISOString(), takenAtExif: null, exif: null, deviceId: crypto.randomUUID(), ...overrides,
  }
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

export function jsonRequest(path: string, token: string | null, body: unknown, method = "POST"): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

export function getRequest(path: string, token: string | null, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { ...authHeaders(token), ...headers } })
}

export function photoRequest(token: string | null, id: string, input: { file?: Uint8Array | null; meta?: unknown; name?: string }): Request {
  const form = new FormData()
  if (input.file) form.set("file", new File([input.file as BlobPart], input.name ?? "foto.jpg", { type: "image/jpeg" }))
  if (input.meta !== undefined && input.meta !== null) form.set("meta", typeof input.meta === "string" ? input.meta : JSON.stringify(input.meta))
  return new Request(`${ORIGIN}/api/mantencion/sync/fotos/${id}`, { method: "PUT", headers: authHeaders(token), body: form })
}

export const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

/** Cuerpo de una preventiva de 10.000 km para el camión Scania de Biodiversa (ítems k1 y k4). */
export function preventiveBody(photos: Array<{ id: string; kind: string }>, overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(), vehicleId: "v-ka135", reading: 12_000, workDate: daysAgo(5), signedAt: new Date().toISOString(),
    offlineSince: null, deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false,
    correctsRecordId: null, photos, kind: "P", scheduleId: "sch-km", scheduleVersion: 1, intervalValue: 10_000, suggestedIntervalValue: 10_000,
    manualScheduleReason: null, items: [{ itemKey: "k1", value: "R", reason: null }, { itemKey: "k4", value: "R", reason: null }],
    notes: "Sin novedad", ...overrides,
  }
}

export function correctiveBody(photos: Array<{ id: string; kind: string }>, overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(), vehicleId: "v-ka135", reading: 12_000, workDate: daysAgo(2), signedAt: new Date().toISOString(),
    offlineSince: null, deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false,
    correctsRecordId: null, photos, kind: "C", oilIds: ["oil-motor"], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: "wt-mec", hours: 2, noParts: false, parts: [{ quantity: 1, description: "Manguera" }] }],
    description: "Cambio de manguera de aire",
    inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null, driverIds: ["dr-1"], ...overrides,
  }
}
