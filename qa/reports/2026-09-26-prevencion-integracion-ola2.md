# Integración de la ola 2: T3 y reglas del cierre anual (2026-09-26)

Rama local `prevencion/integracion-ola2` sobre la ola 1 (`ad0103a9`). Sin push.

| Rama integrada | Contenido | Informe |
|---|---|---|
| `prevencion/cierre-anual-reglas` | Reglas del cierre anual decididas el 2026-09-26 (migración 0332) | abajo |
| `prevencion/t3-fuentes` | Instancias e integración: regla única de I08-a en todas las vistas, sincronía instancia-ejecución, rechazos por faena fuera de la membresía, `FOR SHARE` en la acreditación, backfill de B01 y RE-20 en el cron | [T3](2026-09-26-prevencion-t3.md) |

## Reglas del cierre anual (decisión "ajustar ambas")

| Regla | Implementación | Prueba |
|---|---|---|
| Una faena dada de baja debe los meses completos anteriores a su baja | Columna nueva `worksites.deactivated_at` (migración 0332, una sola columna, sin `DROP`). La fija y la limpia `setWorksiteActive`. El cierre anual la considera si operaba el programa: fue miembro de alguna versión del año, o el programa es corporativo | `pdtp-year-close.test.ts`: baja en julio → debe enero a junio, no julio a diciembre. `worksite-lifecycle.test.ts`: fija y limpia la fecha (en rojo sin el cambio) |
| Bajas anteriores a la columna | No se sabe cuándo dejaron de operar y no se les exige nada. Queda documentado en el esquema | `pdtp-year-close.test.ts` |
| En un programa corporativo, una faena nueva debe desde que existe | La incorporación de una faena sin membresía es su `created_at`. Para las miembros se toma la incorporación más antigua entre las versiones del año | `pdtp-year-close.test.ts`: creada en octubre → debe octubre a diciembre |
| Los meses de una faena dada de baja se pueden cerrar | La ficha del programa ofrece esa faena, rotulada "(dada de baja)" y solo dentro del alcance del usuario, mientras deba meses. Los controles del ciclo de vida la enlazan | `pdtp-context.test.ts`, `program-lifecycle-controls.test.tsx` |

**Alcance deliberado:** las dos reglas rigen el cierre anual, que es lo que se decidió. El porcentaje y los atrasos siguen midiendo una faena corporativa desde la activación del programa. `created_at` es la fecha en que se creó el registro en la plataforma, no la fecha en que la faena empezó a operar: aplicarla al porcentaje podía borrar meses de programas importados o de datos históricos.

## Merge

- `page.tsx` chocó: T3 agregó `sessionWorksiteIds` al backlog y el cierre anual adelantó la lectura de la preparación para el cierre del año. Se conservaron las dos cosas.
- `latest.md` chocó; se conservaron las filas de ambas ramas.
- La cadena de migraciones queda en 0331 → 0332 (333 entradas).

## Verificación de la rama integrada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS |
| `db:generate` / cadena | Sin cambios pendientes / 333 entradas hasta 0332 |
| `npm run test:fast` | 770 archivos / **10.052 pruebas PASS**, 31 archivos omitidos (`*-postgres`) |
| `npm run test:pglite` | 210 archivos / **2.548 pruebas PASS** |
| E2E `pdtp-*` + `prevencion-*` contra un servidor aislado reconstruido (puerto 3100, base desechable) | **163 PASS, 1 omitida** (la condicional de `pdtp-habilitacion:98`) |

**Sin recorrer:**
- `npm run test:e2e` completo.
- Las suites `*-postgres`, salvo las dos de concurrencia que corrió T3.
- `npm run doctor`.
- Un recorrido de navegador del cierre anual con una faena dada de baja: el fixture E2E no tiene un año terminado con bajas. Lo cubren las pruebas de componente y de servicio.
