import { nameKey } from "@/lib/mantencion/normalize"
import { resolveWorksiteId } from "@/lib/worksites/resolve-worksite"
import type { CargoTable } from "./cargos"
import type { Catalogs } from "./catalogs"
import { cleanText, compactKey, rutKey } from "./normalize"
import type { ChargeResolution } from "./types"

/**
 * Calces del archivo contra los maestros, todos EXACTOS (comparando sin tildes, mayúsculas ni signos). Nunca adivinan por
 * parecido: lo que no calza (o calza con más de uno) devuelve `null` / `pending` y va al informe. NO se crean productos ni
 * proveedores desde texto libre: eso lo decide jefatura mirando los informes de «sin calce».
 */

export interface ProductMatch { id: string; unitOfMeasure: string }

export interface Resolvers {
  worksiteId(text: string): string | null
  worksiteName(id: string): string
  /** `usuario` (login o correo) y `solicitante` (nombre): el primero que calce con un único usuario. */
  userId(usuario: string | null, solicitante: string | null): string | null
  product(articulo: string, codigo: string | null): ProductMatch | null
  supplierId(text: string): string | null
  charge(cargo: string | null, worksiteId: string): ChargeResolution
}

type Index<T> = Map<string, T[]>

function addTo<T>(index: Index<T>, key: string, value: T) {
  if (!key) return
  const list = index.get(key)
  if (!list) index.set(key, [value])
  else if (!list.includes(value)) list.push(value)
}

/** Un único candidato; si hay varios, el único activo; si no, ninguno (ambiguo). */
function pickUnique<T extends { isActive?: boolean }>(candidates: readonly T[] | undefined): T | null {
  if (!candidates?.length) return null
  if (candidates.length === 1) return candidates[0]!
  const active = candidates.filter((candidate) => candidate.isActive !== false)
  return active.length === 1 ? active[0]! : null
}

export function buildResolvers(catalogs: Catalogs, cargos: CargoTable): Resolvers {
  const siteNames = new Map(catalogs.worksites.map((site) => [site.id, site.name]))

  const usersByLogin: Index<Catalogs["users"][number]> = new Map()
  const usersByName: Index<Catalogs["users"][number]> = new Map()
  for (const user of catalogs.users) {
    addTo(usersByLogin, nameKey(user.email), user)
    addTo(usersByLogin, nameKey(user.email.split("@")[0] ?? ""), user)
    addTo(usersByName, nameKey(user.name), user)
  }

  const vehiclesByKey: Index<Catalogs["vehicles"][number]> = new Map()
  for (const vehicle of catalogs.vehicles) {
    addTo(vehiclesByKey, compactKey(vehicle.code), vehicle)
    addTo(vehiclesByKey, compactKey(vehicle.plate), vehicle)
  }

  // El producto se ofrece sólo si está activo: la app rechaza una línea que apunta a uno dado de baja.
  const productsByCode: Index<Catalogs["products"][number]> = new Map()
  const productsByName: Index<Catalogs["products"][number]> = new Map()
  for (const product of catalogs.products.filter((candidate) => candidate.isActive)) {
    addTo(productsByCode, compactKey(product.sku), product)
    addTo(productsByCode, compactKey(product.partNumber), product)
    addTo(productsByName, nameKey(product.name), product)
  }

  const suppliersByName: Index<Catalogs["suppliers"][number]> = new Map()
  const suppliersByRut: Index<Catalogs["suppliers"][number]> = new Map()
  for (const supplier of catalogs.suppliers.filter((candidate) => candidate.isActive)) {
    addTo(suppliersByName, nameKey(supplier.name), supplier)
    addTo(suppliersByRut, rutKey(supplier.rut) ?? "", supplier)
  }

  const centersByWorksite = new Map<string, Index<Catalogs["costCenters"][number]>>()
  for (const center of catalogs.costCenters) {
    if (!center.worksiteId) continue
    const index = centersByWorksite.get(center.worksiteId) ?? new Map()
    addTo(index, nameKey(center.name), center)
    centersByWorksite.set(center.worksiteId, index)
  }

  const vehicleLabel = (vehicle: { code: string | null; plate: string }) => vehicle.code || vehicle.plate
  // Un cargo a un equipo sólo vale si se puede comprar con él: activo y en la faena de la nota (la misma regla de
  // `assertItemFleetLink` al guardar la solicitud). Si el código coincide con un equipo que no cumple, la línea queda con
  // el cargo pendiente y el motivo dice por qué; nunca se imputa a un equipo de otra faena ni dado de baja.
  const vehicleByKey = (key: string, worksiteId: string) => {
    const matches = vehiclesByKey.get(key) ?? []
    const eligible = matches.filter((vehicle) => vehicle.isActive && vehicle.worksiteId === worksiteId)
    if (eligible.length === 1) return { match: eligible[0]!, problem: null }
    if (eligible.length > 1) return { match: null, problem: "Coincide con más de un equipo (código o patente)" }
    if (matches.length === 0) return { match: null, problem: null }
    if (matches.length > 1) return { match: null, problem: "Coincide con equipos que están inactivos o en otra faena (código o patente)" }
    const [only] = matches
    return {
      match: null,
      problem: only!.isActive
        ? `El equipo «${vehicleLabel(only!)}» está en otra faena (${siteNames.get(only!.worksiteId) ?? only!.worksiteId}), no en la de la nota (${siteNames.get(worksiteId) ?? worksiteId})`
        : `El equipo «${vehicleLabel(only!)}» está inactivo (dado de baja)`,
    }
  }

  return {
    worksiteId: (text) => resolveWorksiteId(text, catalogs.worksites, catalogs.aliases),
    worksiteName: (id) => siteNames.get(id) ?? id,

    userId(usuario, solicitante) {
      for (const text of [usuario, solicitante]) {
        const key = nameKey(text ?? "")
        if (!key) continue
        const hit = pickUnique(usersByLogin.get(key)) ?? pickUnique(usersByName.get(key))
        if (hit) return hit.id
      }
      return null
    },

    product(articulo, codigo) {
      const byCode = codigo ? pickUnique(productsByCode.get(compactKey(codigo))) : null
      const hit = byCode ?? pickUnique(productsByName.get(nameKey(articulo)))
      return hit ? { id: hit.id, unitOfMeasure: hit.unitOfMeasure } : null
    },

    supplierId(text) {
      const rut = rutKey(text)
      const hit = (rut ? pickUnique(suppliersByRut.get(rut)) : null) ?? pickUnique(suppliersByName.get(nameKey(text)))
      return hit?.id ?? null
    },

    charge(cargo, worksiteId) {
      const text = cleanText(cargo)
      if (!text) return { kind: "none" }
      const pending = (reason: string): ChargeResolution => ({ kind: "pending", chargeText: text, reason })
      const entry = cargos.get(compactKey(text))
      if (entry) {
        if ("revisar" in entry) return pending("Marcado «revisar» en la tabla de equivalencias")
        if ("equipo" in entry) {
          const { match, problem } = vehicleByKey(compactKey(entry.equipo), worksiteId)
          return match
            ? { kind: "vehicle", vehicleId: match.id, label: vehicleLabel(match) }
            : pending(problem ?? `La equivalencia apunta al equipo «${entry.equipo}», que no está en la flota (o es ambiguo)`)
        }
        const center = pickUnique(centersByWorksite.get(worksiteId)?.get(nameKey(entry.centro)))
        return center
          ? { kind: "costCenter", costCenterId: center.id, label: center.name }
          : pending(`La equivalencia apunta al centro «${entry.centro}», que no existe (o es ambiguo) en la faena de la nota`)
      }
      const { match, problem } = vehicleByKey(compactKey(text), worksiteId)
      if (match) return { kind: "vehicle", vehicleId: match.id, label: vehicleLabel(match) }
      return pending(problem ?? "No es un código ni una patente de la flota y no está en la tabla de equivalencias")
    },
  }
}
