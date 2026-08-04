/**
 * Detecta solicitudes con un tipo que no concuerda con lo que contienen.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * El hallazgo FORM-CORE-001 de la auditoría UI/UX: entrar por `/repuestos/nueva`
 * o `/servicios/nueva` construía el formulario como si fuera una solicitud de
 * EPP. El defecto está corregido y certificado por E2E en dos viewports, pero
 * eso no dice nada de **las solicitudes creadas mientras el defecto existía**:
 * quedaron guardadas con `request_type = 'epp'` y contenido de repuestos.
 *
 * TASK-UI-003 lo pide explícitamente —"revisar las solicitudes históricas
 * potencialmente mal tipadas antes de migrar datos"— y no es una prueba: es una
 * consulta a la base real, que sólo puede correr quien tenga acceso a ella.
 *
 * ── QUÉ BUSCA ──────────────────────────────────────────────────────────────
 *
 * Un ítem guarda sus campos propios en `request_item_attributes` con el nombre
 * desnormalizado. "N° de Parte", "Equipo / Máquina" y "Patente / Código interno"
 * **sólo** los produce el editor de repuestos y servicios: si aparecen colgando
 * de una solicitud tipada `epp` u `otro`, el tipo es el que está mal, no el
 * contenido.
 *
 * ── QUÉ NO HACE ────────────────────────────────────────────────────────────
 *
 * No escribe. Ni una fila. Reclasificar una solicitud cambia su flujo de
 * aprobación —los tipos con cotización exigen tres cotizaciones o una
 * justificación—, así que la corrección es una decisión con dueño, no un
 * `UPDATE` automático. Esto produce la lista para tomarla.
 *
 *   DATABASE_URL=<url> npx tsx scripts/check-mistyped-requests.ts
 */
import postgres from "postgres"
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"
import { SERVICE_ATTRIBUTE_NAMES } from "@/lib/validation/servicios"

/**
 * Atributos compartidos con el catálogo de productos: **no** delatan nada.
 *
 * "Marca" y "Modelo" estuvieron en la lista de sospechosos y era un error: el
 * catálogo EPP los usa como atributos corrientes —`product_attributes` los
 * enumera junto a talla, color y medida, y la revisión de importación EPP mapea
 * `brand: "Marca", model: "Modelo"`—. Con ellos dentro, la consulta contra
 * producción devolvió **once solicitudes EPP perfectamente bien tipadas**,
 * delatadas todas por tener un campo "Modelo", que es lo que un casco tiene.
 *
 * Un detector con falsos positivos plausibles es peor que ninguno: invita a
 * "corregir" registros correctos, y nueve de esas once estaban en compra.
 */
const COMPARTIDOS_CON_CATALOGO = new Set<string>(["Marca", "Modelo"])

/**
 * Atributos que **sólo** el editor de repuestos y servicios sabe escribir.
 *
 * Se derivan de las constantes que la propia aplicación usa al persistir, no de
 * los rótulos del formulario. La diferencia no es cosmética: el campo rotulado
 * "Equipo / Máquina" se guarda como **"Equipo"**, y "Patente / Código interno"
 * como **"Patente/Código"**. La primera versión de este script copió los
 * rótulos y habría producido **falsos negativos** —el peor sentido del error:
 * un "no hay nada" que nadie vuelve a cuestionar—.
 *
 * Atado a la fuente, un cambio de nombre en el formulario no puede desalinear
 * el detector en silencio.
 */
const ATRIBUTOS_DE_EQUIPO = [
  ...new Set([...Object.values(REPUESTO_ATTRIBUTE_NAMES), ...Object.values(SERVICE_ATTRIBUTE_NAMES)]),
].filter((nombre) => !COMPARTIDOS_CON_CATALOGO.has(nombre))

/** Tipos que no deberían llevar esos atributos nunca. */
const TIPOS_SIN_EQUIPO = ["epp", "otro"]

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    console.error("DATABASE_URL es requerido. Este script sólo lee; apúntalo a la base que quieras revisar.")
    process.exit(1)
  }

  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const sospechosas = await sql<{
      id: string
      code: string | null
      request_type: string
      status: string
      created_at: string
      atributos: string[]
      items: number
    }[]>`
      select
        r.id,
        r.code,
        r.request_type,
        r.status,
        r.created_at::text as created_at,
        array_agg(distinct a.attribute_name order by a.attribute_name) as atributos,
        count(distinct i.id)::int as items
      from purchase_requests r
      join purchase_request_items i on i.request_id = r.id
      join request_item_attributes a on a.request_item_id = i.id
      where r.request_type = any(${TIPOS_SIN_EQUIPO})
        and a.attribute_name = any(${ATRIBUTOS_DE_EQUIPO})
      group by r.id, r.code, r.request_type, r.status, r.created_at
      order by r.created_at
    `

    if (sospechosas.length === 0) {
      console.log("Sin solicitudes mal tipadas: ninguna solicitud EPP u 'otro' lleva atributos de equipo.")
      return
    }

    console.log(`${sospechosas.length} solicitud(es) con tipo incoherente con su contenido:\n`)
    console.log("| Código | Tipo actual | Estado | Ítems | Atributos que delatan | Creada |")
    console.log("| --- | --- | --- | ---: | --- | --- |")
    for (const fila of sospechosas) {
      console.log(
        `| ${fila.code ?? fila.id} | ${fila.request_type} | ${fila.status} | ${fila.items} | ${fila.atributos.join(", ")} | ${fila.created_at.slice(0, 10)} |`,
      )
    }

    // El estado importa para decidir: una solicitud en borrador se puede
    // reclasificar sin consecuencias; una ya aprobada arrastra un flujo de
    // aprobación que se ejecutó con las reglas del tipo equivocado.
    const cerradas = sospechosas.filter((f) => !["draft", "cancelled"].includes(f.status))
    console.log(
      `\n${cerradas.length} de ${sospechosas.length} ya salieron de borrador: reclasificarlas cambia el flujo de aprobación que ya se ejecutó.`,
    )
    console.log("Este script no modifica nada. La reclasificación es una decisión con dueño.")
    process.exitCode = 1
  } finally {
    await sql.end()
  }
}

void main()
