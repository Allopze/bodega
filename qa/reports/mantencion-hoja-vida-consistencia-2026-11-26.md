# QA · Consistencia de la pestaña Mantención del equipo (2026-11-26)

Rama `fix/mantencion-hoja-vida-consistencia`. Alcance: `/flota/[id]/mantencion`. En prod, la tarjeta «Historial de mantenciones» (línea de tiempo de formularios, OT y registros) mostraba 6 trabajos y justo debajo la tarjeta «Hoja de vida» decía «Este equipo aún no tiene mantenciones».

## Causa
La línea de tiempo se agregó el 2026-11-25 (`1382f942f`), pero la tarjeta antigua siguió en la página. Esa tarjeta solo leía lo firmado en la app, y en prod eso hoy suma 0. El botón «Exportar historial» de la cabecera usaba la misma fuente: con un equipo que solo tiene formularios respondía «Este equipo todavía no tiene mantenciones que puedas exportar».

## Cambios
| Hallazgo | Cambio |
|---|---|
| Dos tarjetas de historial que se contradicen | Una sola tarjeta, «Historial de mantenciones». Quien ve el historial (`mant:records:view_all`/`view_worksite`) ve la línea de tiempo, que ya incluye lo firmado. Quien no lo ve recibe la lista de firmados con el mismo título y el vacío «aún no tiene mantenciones firmadas». Si se dibuja la línea de tiempo, la lista de firmados ya no se consulta. |
| «Hoja de vida» como nombre de una tarjeta y a la vez de la pestaña | Ninguna tarjeta se llama así. «Hoja de vida del equipo» sigue nombrando la pestaña (enlaces del Panel). |
| «0 días en taller» en casi cada formulario | La línea de tiempo lo omite cuando el trabajo salió el mismo día. Mientras sigue en taller muestra lo mismo que la lista («3 días · sigue en taller», «En taller»); antes decía «3 días en taller» o «en taller». |
| «Exportar historial» exportaba solo lo firmado | La hoja «Historial» trae las mismas filas que la tarjeta, con las columnas del Historial de mantenciones. El detalle de firmados (con anuladas), «Ítems de preventivas» y «Repuestos» va en hojas aparte, solo si existen. Sin permiso de historial, el libro abre con «Registros firmados». |
| Vacíos de «Órdenes de trabajo» y «Repuestos y servicios comprados» como `h2` dentro de una tarjeta con `h2` | Pasan a `as="p"`, igual que el vacío de la línea de tiempo. |

## Pruebas deterministas
| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | 0 problemas |
| `npm run test:fast` | 22.644 pasan y 1 falla: `scripts/backup-env-whitelist.test.ts` (`ONWAY_CAPTCHA_*`). Ya fallaba en la base y no la toca este cambio. |
| PGlite `mantencion-equipment-life`, `mantencion-hoja-vida-sigue-equipo`, `mantencion-history-export` | 71/71, incluida la regresión «un equipo solo con formularios exporta su Historial» |
| vitest de componentes: historial, ficha del equipo, compras, pestaña Flota | 195/195 |
| E2E `mantencion-historial` (build de producción, base `bodega_hoja_e2e` y puerto :3114 propios) | 9/9 |
| E2E `ficha-vehiculo` + `mantencion-historico` (mismo servidor) | 4/4 |

El spec E2E de la línea de tiempo ahora comprueba tres cosas. Hay un solo encabezado «Historial de mantenciones» y ninguno «Hoja de vida». No aparece «aún no tiene mantenciones». «Exportar historial» baja `historial-QA-LK-X1-….xlsx` con las hojas `["Historial", "Metadatos"]` y 33 filas, todas «Formulario».

## Verificación en navegador
Capturas a 1440 y 390 px de un equipo solo con formularios (QA-LK-X1) y de uno con una OT en taller (QA-LK-A1). Resultado: una sola tarjeta de historial, sin desborde horizontal, sin errores de consola, y «14 días · sigue en taller» en la OT abierta.

## COVERAGE GAP
- Ese build de E2E es anterior al cambio a `as="p"` de los dos vacíos. Ese cambio está cubierto por pruebas de componente, no por E2E.
- No hice un recorrido contra `bodega_dev`: el clasificador bloquea el login con el usuario QA de `.env.qa`. La verificación en navegador es la de la E2E aislada.
- El caso «sin permiso de historial» (un rol con `mant:equipment:manage` y sin `mant:records:view_*`) no existe en los roles sembrados. Solo está probado con pruebas de componente.

## Riesgos y decisiones
- La ficha ya no muestra en pantalla las mantenciones **anuladas**, porque la línea de tiempo solo trae las vigentes. Siguen en «Registros firmados» (`/mantencion/registros`) y en la hoja «Registros firmados» del Excel.
- Una OT que entró a taller aparece en la línea de tiempo y también en «Órdenes de trabajo». Se dejó así a propósito: la segunda es la cola de trabajo, con estado y rendimiento antes y después, e incluye OT que todavía no entran a taller.
- Lo que sigue igual porque es dato de origen y no código: formularios marcados «Correctiva» cuyo texto dice «MANTENCION PREVENTIVA», y lecturas de formulario sin unidad (texto libre).
