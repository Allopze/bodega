/**
 * lib/services/dte-portal/require-cod-emp.ts
 *
 * Todos los lectores de DTE (los tres reportes Excel y /compras/dte) filtran
 * por el `codEmp` VIVO de la configuración, no por el de las filas ya
 * guardadas. Si la configuración se borra o se rota, `readDtePortalConfig`
 * devuelve cadena vacía y `eq(codEmp, "")` no calza con ninguna fila
 * histórica: el Libro de Compras salía vacío con HTTP 200, como si el mes no
 * tuviera documentos.
 *
 * Fallar cerrado y ruidosamente es la única lectura honesta: un libro de
 * compras vacío presentado como completo es evidencia tributaria falsamente
 * negativa.
 */

import { readDtePortalConfig } from "./config"

export const DTE_COD_EMP_MISSING_MESSAGE =
  "La sincronización DTE no está configurada (falta el código de empresa): " +
  "configúrala en Administración › Sincronización DTE antes de consultar documentos tributarios."

export class DteCodEmpMissingError extends Error {
  constructor() {
    super(DTE_COD_EMP_MISSING_MESSAGE)
    this.name = "DteCodEmpMissingError"
  }
}

/** El `codEmp` efectivo, o un error explícito si no hay ninguno configurado. */
export async function requireDteCodEmp(): Promise<string> {
  const codEmp = (await readDtePortalConfig()).credentials.codEmp
  if (!codEmp) throw new DteCodEmpMissingError()
  return codEmp
}
