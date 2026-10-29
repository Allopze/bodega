import { fetchCatalog, fetchCatalogOthers, type ApiFailure } from "./api"
import { markAccountNeedsLogin, getAccount, canSync } from "./accounts"
import { STORE, idbGet, idbPut } from "./db"
import { emit } from "./events"
import { reportReachable } from "./signal"
import type { StoredCatalog } from "./types"

/**
 * Catálogo del alcance de cada cuenta (equipos, pautas con versión, reglas por
 * marca, talleres, conductores, estado de mantención, registros propios y
 * observaciones). Vive en IndexedDB para validar y listar sin señal; se
 * refresca con `ETag`/`If-None-Match` para no bajar lo mismo dos veces.
 */

export async function loadStoredCatalog(userId: string): Promise<StoredCatalog | null> {
  return (await idbGet<StoredCatalog>(STORE.catalogs, userId)) ?? null
}

export type RefreshOutcome = "updated" | "unchanged" | "needs_login" | "offline" | "error" | "skipped"

const inFlight = new Map<string, Promise<RefreshOutcome>>()

function outcomeFrom(failure: ApiFailure): RefreshOutcome {
  if (failure.kind === "auth") return "needs_login"
  return failure.kind === "retry" && failure.network ? "offline" : "error"
}

async function refreshNow(userId: string, withOthers: boolean, fetchImpl?: typeof fetch): Promise<RefreshOutcome> {
  const account = await getAccount(userId)
  if (!account || !canSync(account)) return "skipped"
  const stored = await loadStoredCatalog(userId)

  const main = await fetchCatalog(account.token, stored?.etag ?? null, fetchImpl)
  if (main.kind !== "ok") {
    if (main.kind === "retry") reportReachable(!main.network)
    if (main.kind === "auth") await markAccountNeedsLogin(userId)
    return outcomeFrom(main)
  }
  reportReachable(true)

  let outcome: RefreshOutcome = "unchanged"
  let current: StoredCatalog | null = stored
  if (!main.value.notModified) {
    current = {
      userId,
      etag: main.value.etag,
      catalog: main.value.body,
      fetchedAt: new Date().toISOString(),
      others: stored?.others ?? null,
    }
    await idbPut(STORE.catalogs, current)
    outcome = "updated"
  }

  // Segunda carga, liviana: el resto de los equipos de la empresa (para «Todas las faenas»).
  if (current && withOthers) {
    const others = await fetchCatalogOthers(account.token, current.others?.etag ?? null, fetchImpl)
    if (others.kind === "ok" && !others.value.notModified) {
      current = { ...current, others: { etag: others.value.etag, version: others.value.body.version, equipment: others.value.body.equipment, fetchedAt: new Date().toISOString() } }
      await idbPut(STORE.catalogs, current)
      outcome = "updated"
    }
  }
  if (outcome === "updated") emit("catalog")
  return outcome
}

/** Refresca el catálogo de una cuenta. Una sola petición a la vez por cuenta. */
export function refreshCatalog(userId: string, options: { withOthers?: boolean; fetchImpl?: typeof fetch } = {}): Promise<RefreshOutcome> {
  const existing = inFlight.get(userId)
  if (existing) return existing
  const promise = refreshNow(userId, options.withOthers ?? true, options.fetchImpl)
    .catch((): RefreshOutcome => "error")
    .finally(() => { inFlight.delete(userId) })
  inFlight.set(userId, promise)
  return promise
}
