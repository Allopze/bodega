import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ORDERS_PAGE_SIZE,
  SOLICITUDES_PAGE_SIZE,
  RECEPCION_PAGE_SIZE,
  HISTORY_PAGE_SIZE,
  APPROVAL_REQUESTS_PAGE_SIZE,
  PENDING_PURCHASE_PAGE_SIZE,
} from "@/lib/constants"

/**
 * El paginador interno de `DataTable` corta las filas que ya llegaron
 * paginadas por el servidor. Si su `pageSize` es menor que el del `page.tsx`,
 * la tabla parte la página del servidor en dos y esconde el resto tras un
 * segundo paginador con un total distinto — que fue exactamente el bug de
 * /recepcion y /entregas (servidor 25, tabla 20: 5 filas inalcanzables sin
 * notarlo).
 *
 * Este test falla si vuelven a divergir.
 */

const ROOT = join(__dirname, "..", "..")

/** `pageSize={X}` que la lista pasa a DataTable, resuelto contra las constantes. */
const PAGE_SIZE_CONSTANTS: Record<string, number> = {
  ORDERS_PAGE_SIZE,
  SOLICITUDES_PAGE_SIZE,
  RECEPCION_PAGE_SIZE,
  HISTORY_PAGE_SIZE,
  APPROVAL_REQUESTS_PAGE_SIZE,
  PENDING_PURCHASE_PAGE_SIZE,
}

const LISTS: { file: string; server: number }[] = [
  { file: "app/(app)/compras/oc-list.tsx",            server: ORDERS_PAGE_SIZE },
  { file: "app/(app)/compras/pending-purchase-list.tsx", server: PENDING_PURCHASE_PAGE_SIZE },
  { file: "app/(app)/solicitudes/request-list.tsx",   server: SOLICITUDES_PAGE_SIZE },
  { file: "app/(app)/recepcion/recepcion-table.tsx",  server: RECEPCION_PAGE_SIZE },
  { file: "app/(app)/entregas/deliveries-table.tsx",  server: HISTORY_PAGE_SIZE },
]

describe("tamaño de página de las listas de adquisiciones", () => {
  it.each(LISTS)("$file no esconde filas de la página del servidor", ({ file, server }) => {
    const source = readFileSync(join(ROOT, file), "utf8")
    const match = source.match(/pageSize=\{([^}]+)\}/)
    expect(match, `${file} no pasa pageSize a DataTable`).not.toBeNull()

    const raw = (match![1] ?? "").trim()
    const value = PAGE_SIZE_CONSTANTS[raw] ?? Number(raw)
    expect(Number.isFinite(value), `pageSize={${raw}} no resuelve a un número`).toBe(true)
    expect(value).toBe(server)
  })
})
