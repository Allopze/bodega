/**
 * Identidad de un maestro: qué se puede cambiar después de haberlo usado.
 *
 * Patrón P1 de la auditoría 2026-09-14 (`CAT-002`, `CLI-001`, `PRV-002`). La
 * plataforma ya sabía hacerlo en un sitio: `updateProduct` se niega a cambiar la
 * talla o el color de una variante que ya tiene solicitudes, compras,
 * movimientos, entregas o stock, y explica que hay que crear otra variante para
 * conservar el historial. Esa misma idea faltaba en tres campos más, todos de
 * la misma naturaleza:
 *
 *  - la **unidad de medida** de un producto, que reinterpreta retroactivamente
 *    todo el saldo (`worksite_stock` no guarda unidad propia);
 *  - el **RUT** de un cliente y el de un proveedor, que son la identidad
 *    tributaria con la que ya se emitieron y se validaron documentos;
 *  - el **cliente de un contrato**, que arrastra su facturación a otro titular.
 *
 * El criterio no es "este campo es importante" sino uno más estrecho y
 * comprobable: **cambiarlo reescribe el significado de lo ya registrado**. Un
 * nombre, una dirección o un teléfono se corrigen sin problema; un RUT no
 * corrige un error de tipeo, reasigna el titular de todo lo emitido.
 *
 * Este módulo es puro: decide qué cambió y cómo se dice. Cada llamador aporta
 * su propia sonda de historia, porque "usado" significa cosas distintas en cada
 * maestro y esas consultas viven donde están sus tablas.
 */

export interface IdentityField {
  /** Nombre del campo en el formulario, para devolver el error donde se escribió. */
  key: string
  /** Cómo se llama en pantalla. */
  label: string
  before: string | null | undefined
  after: string | null | undefined
}

export interface IdentityChange {
  key: string
  label: string
  before: string
  after: string
}

/** Normaliza para comparar: un espacio de más no es un cambio de identidad. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").trim()
}

export function changedIdentityFields(fields: readonly IdentityField[]): IdentityChange[] {
  return fields.flatMap((field) => {
    const before = normalize(field.before)
    const after = normalize(field.after)
    if (before === after) return []
    return [{ key: field.key, label: field.label, before, after }]
  })
}

/**
 * El mensaje que ve quien intentó el cambio. Dice tres cosas, en este orden:
 * qué campo, por qué no se puede, y qué hacer en su lugar. Sin lo tercero el
 * bloqueo sólo traslada el problema.
 */
export function identityLockedMessage(
  changes: readonly IdentityChange[],
  reason: string,
  remedy: string,
): string {
  const campos = changes.map((change) => `${change.label} («${change.before}» → «${change.after}»)`)
  const lista = campos.length === 1
    ? campos[0]!
    : `${campos.slice(0, -1).join(", ")} y ${campos.at(-1)!}`
  return `No se puede cambiar ${lista}: ${reason}. ${remedy}`
}

/**
 * Errores de identidad, distinguibles de cualquier otro fallo para que la
 * acción los devuelva como error del campo y no como error genérico.
 */
export class MasterIdentityError extends Error {
  readonly fieldKeys: string[]
  constructor(message: string, fieldKeys: string[]) {
    super(message)
    this.name = "MasterIdentityError"
    this.fieldKeys = fieldKeys
  }
}

/**
 * El guardián completo: si hay cambios de identidad **y** el maestro ya tiene
 * historia, falla. `hasHistory` se consulta sólo cuando hay algo que proteger,
 * para no pagar la consulta en cada edición de nombre o teléfono.
 */
export async function assertIdentityStable(input: {
  fields: readonly IdentityField[]
  hasHistory: () => Promise<boolean>
  reason: string
  remedy: string
}): Promise<void> {
  const changes = changedIdentityFields(input.fields)
  if (changes.length === 0) return
  if (!(await input.hasHistory())) return
  throw new MasterIdentityError(
    identityLockedMessage(changes, input.reason, input.remedy),
    changes.map((change) => change.key),
  )
}
