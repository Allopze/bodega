import type { Session } from "next-auth"
import { and, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { dteDocuments } from "@/db/schema"
import { requireDteCodEmp } from "@/lib/services/dte-portal/require-cod-emp"
import { dteTipoLabel, estadoPlataformaLabel } from "@/lib/services/dte-portal/labels"
import { buildDateFilter } from "./utils"
import type { ReportData, ExportFilters, ReportCell } from "./types"

/**
 * Libro de Compras Electrónico: todos los DTE recibidos de proveedores
 * (Bandeja de Entrada del portal DTE FacturaEnLínea) en el rango de fechas.
 *
 * Sin filtro de faena — a diferencia del resto de los reportes de compras,
 * el DTE es por empresa/período tributario (CodEmp del portal), no por
 * faena: dteDocuments no tiene worksiteId.
 */
export async function dteLibroCompras(_session: Session | null, filters: ExportFilters, limit: number): Promise<ReportData> {
  const codEmp = await requireDteCodEmp()

  const docs = await db
    .select({
      tipoDte:           dteDocuments.tipoDte,
      folio:             dteDocuments.folio,
      fechaEmision:      dteDocuments.fechaEmision,
      rutEmisor:         dteDocuments.rutEmisor,
      razonSocialEmisor: dteDocuments.razonSocialEmisor,
      montoNeto:         dteDocuments.montoNeto,
      iva:               dteDocuments.iva,
      montoTotal:        dteDocuments.montoTotal,
      estadoPlataforma:  dteDocuments.estadoPlataforma,
    })
    .from(dteDocuments)
    .where(and(
      eq(dteDocuments.codEmp, codEmp),
      buildDateFilter(filters, dteDocuments.fechaEmision),
    ))
    .orderBy(desc(dteDocuments.fechaEmision))
    .limit(limit + 1)

  const rowLimitApplied = docs.length > limit
  const limited = rowLimitApplied ? docs.slice(0, limit) : docs

  return {
    filenameBase: "dte-libro-compras",
    worksheetName: "Libro de Compras DTE",
    headers: ["Tipo", "Folio", "Fecha", "RUT Emisor", "Razón Social", "Neto", "IVA", "Total", "Origen montos", "Estado plataforma"],
    rows: limited.map((d) => {
      const amounts = resolveAmounts(d)
      return [
        dteTipoLabel(d.tipoDte),
        d.folio,
        d.fechaEmision,
        d.rutEmisor,
        d.razonSocialEmisor,
        amounts.montoNeto,
        amounts.iva,
        d.montoTotal,
        amounts.origen,
        estadoPlataformaLabel(d.estadoPlataforma),
      ] satisfies ReportCell[]
    }),
    rowLimitApplied,
  }
}

/** Tipos SII exentos de IVA: el neto ES el total y el IVA es cero por definición. */
const TIPOS_EXENTOS = new Set(["34", "41"])
/** Tipos SII inequívocamente afectos, donde la tasa 19% se puede aplicar. */
const TIPOS_AFECTOS = new Set(["33", "39"])
const IVA_RATE = 0.19

/**
 * Neto e IVA del libro, con su procedencia declarada.
 *
 * La Bandeja de Entrada no trae neto ni IVA separados: `sync.ts` los inserta
 * en null y sólo se rellenan si alguien abre el XML de ese documento
 * concreto. Un libro de compras sin base imponible no sirve, pero inventar un
 * IVA tampoco: se deriva sólo donde la aritmética es exacta (una resta, o un
 * documento exento) o donde la tasa es inequívoca (33/39 afectos), y la
 * columna "Origen montos" distingue siempre lo leído del XML de lo derivado.
 *
 * Las notas de crédito/débito (61/56) y las guías (52) quedan en blanco a
 * propósito: heredan la condición del documento referenciado, que acá no se
 * conoce. Ojo también con las facturas de combustible: llevan IEC y su IVA
 * NO es 19% del total, por eso el derivado va rotulado.
 */
function resolveAmounts(d: { tipoDte: string; montoNeto: number | null; iva: number | null; montoTotal: number }): {
  montoNeto: number | null
  iva: number | null
  origen: string
} {
  if (d.montoNeto !== null && d.iva !== null) {
    return { montoNeto: d.montoNeto, iva: d.iva, origen: "XML" }
  }
  // Una resta, no una estimación de tasa: exacta con cualquier tipo de documento.
  if (d.montoNeto !== null) {
    return { montoNeto: d.montoNeto, iva: round2(d.montoTotal - d.montoNeto), origen: "Derivado (total − neto)" }
  }
  if (d.iva !== null) {
    return { montoNeto: round2(d.montoTotal - d.iva), iva: d.iva, origen: "Derivado (total − IVA)" }
  }
  if (TIPOS_EXENTOS.has(d.tipoDte)) {
    return { montoNeto: d.montoTotal, iva: 0, origen: "Derivado (exento)" }
  }
  if (TIPOS_AFECTOS.has(d.tipoDte)) {
    const neto = Math.round(d.montoTotal / (1 + IVA_RATE))
    return { montoNeto: neto, iva: round2(d.montoTotal - neto), origen: "Derivado (IVA 19%)" }
  }
  return { montoNeto: null, iva: null, origen: "Sin XML" }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
