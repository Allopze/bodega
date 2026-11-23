# Mantención: tercera tanda — la OT y la hoja de vida siguen al equipo trasladado (2026-11-23)

Rama `fix/mantencion-traslado-sigue-equipo`, sobre `main` `5c235f5ae`. Sin migraciones ni permisos nuevos.

## Decisión del usuario (2026-11-22)

Tras un traslado:

- la recepción y la conformidad de una OT abierta las da la faena **de destino**;
- la OT y la hoja de vida siguen al equipo.

Antes, la OT quedaba en la faena de origen. El destino no la veía ni podía darle conformidad, pero el origen, que ya no tenía el equipo, sí podía. La ficha del equipo además se contradecía: mostraba «Última preventiva MP-MAS-0053» junto a una hoja de vida vacía.

## Regla implementada

| Qué | Antes | Ahora |
|---|---|---|
| Ver una OT | Faena de imputación | Faena de imputación **o** faena actual del equipo |
| Recibir y dar la conformidad | Faena de imputación | Faena **actual** del equipo (destino) |
| Avisos «espera tu recepción / conformidad» | Faena de imputación | Faena actual del equipo |
| Faena de imputación de la OT (horas, Panel) | — | **No cambia** |
| Ver registros, PDF, fotos, hoja de vida, Excel del equipo e historial anterior | Faena del registro | Faena del registro **o** faena actual del equipo |
| Observar, revisar, anular, corregir o cerrar el taller de un registro | Faena del registro | **Sin cambio**: faena del registro |
| Cifras del Panel (OT y registros) | Visibilidad | Por faena de imputación o del registro: el trabajo cuenta donde se hizo |

Además:

- La ficha de la OT avisa: «El equipo está ahora en X; la recepción y la conformidad las da esa faena. Las horas quedan imputadas a Y.»
- La lista de OT marca «Equipo ahora en X». Su filtro por faena incluye las OT del equipo que está hoy en esa faena.
- El detalle de un registro de otra faena explica «Trabajo hecho en otra faena» y no muestra botones de acción.
- El aviso del traslado dice que la OT abierta sigue con el equipo.

## Commits

- `e821215b7`: la hoja de vida sigue al equipo trasladado.
- `9163d3dd7`: la OT de un equipo trasladado sigue al equipo; la conformidad la da el destino.

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run test:fast` | 21.853 pasan. Fallaba 1 prueba (`fleet-transfer-dialog`) que esperaba el aviso viejo del traslado; quedó corregida y en verde (20/20 en su archivo). |
| `npm run test:pglite` | **5.653 pasan, 0 fallas** (incluye las dos suites nuevas) |
| Hook de commit | OK |

**Pruebas nuevas:**

- `mantencion-work-orders-traslado-pglite`: OT trasladada de Biodiversa a Cholguán.
  - El destino la ve, recibe el aviso, la recibe y le da la conformidad.
  - El origen la ve, pero no la puede recibir ni darle la conformidad.
  - Una faena ajena no la ve.
  - La imputación sigue en Biodiversa.
  - Las OT abiertas del Panel se cuentan por imputación.
- `mantencion-hoja-vida-sigue-equipo-pglite`: registros e historial de un equipo trasladado.
  - El destino los ve en la lista, el detalle, la hoja de vida, el Excel, el PDF, las fotos y el historial anterior, pero no puede observar, revisar ni anular.
  - El origen actúa igual que antes.
  - Una faena ajena no los ve.
  - «Registros por revisar» del Panel se cuenta por la faena del registro.
- `work-order-access-traslado`: las reglas puras de acceso.

## Navegador

`next dev --webpack` de la rama en :3003 contra `bodega_dev`. 8 comprobaciones, todas OK, sin errores de consola ni 5xx.

- **Supervisor de Pacífico, KA-108** (trasladado de Masisa el 04-11):
  - La hoja de vida muestra «11 mantenciones vigentes» con los folios de Masisa. Antes mostraba «Este equipo aún no tiene mantenciones».
  - El detalle de MC-MAS-0002 se abre con el aviso «Trabajo hecho en otra faena» y sin botones de acción.
  - Un registro de otro equipo de otra faena sigue dando «No encontramos este registro».
- **Administrador:**
  - OT-STF-0002 (imputada a Santa Fe, con el equipo hoy en Flor del Laja) muestra el aviso de la faena actual y de la imputación.
  - La lista filtrada por Flor del Laja la incluye, con la marca «Equipo ahora en Flor del Laja».
- **No hay datos en desarrollo** de una OT abierta con el equipo trasladado. La recepción y la conformidad por el destino están cubiertas por PGlite, no por navegador.

## E2E

Corrida aislada sobre el worktree de la rama:

- base `bodega_e2e_lote1` en el contenedor `bodega-e2e-postgres` y puerto 3150, con una config temporal sin versionar;
- un worker, build de producción;
- specs `traslado-equipos`, `ficha-vehiculo`, `contratos-faena`, `mantencion-1-app`, `-2-jefatura`, `-3a-equipos`, `-4-permisos`, `-5-ot`, `mantencion-historico`, `indicadores-mantencion` y `ot-repuestos`.

**Resultado: 57 pasan y falla 1** (`mantencion-historico`).

- **Causa conocida:** falla por `POST /api/apps/visita` abortado (la baliza de TI al navegar). Esa falla también ocurre en `main` y no es de Mantención.
- **Aborto adicional en una corrida:** además apareció una vez `POST …/historicos/importar` abortado.
  - La traza muestra que es la última vista previa del spec: responde 200 y sólo se corta el stream.
  - Repetida 3 veces sobre el mismo build, no volvió a aparecer.
  - Es la misma carrera de tiempos ya documentada en la primera tanda: una ADVERTENCIA DE AUTOMATIZACIÓN, no un defecto del producto.

## Riesgos y brechas

- **Efecto en las listas:** el supervisor o administrador de la faena de destino ahora ve en Registros y en la lista de OT el trabajo hecho en el origen sobre el equipo trasladado. Es la consecuencia buscada, pero amplía lo que ve un rol acotado: incluye el nombre del mecánico y las notas.
- **Diferencia esperada entre lista y Panel:** el enlace «OT abiertas / Por conformidad» del Panel de la faena de destino puede mostrar en la lista una OT más que la cifra. La lista sigue al equipo y la cifra cuenta por imputación.
- **Revisión en lote:** la lista muestra la casilla en filas que sólo se ven por el traslado. Si se marcan, vuelven como «no encontrado». Quien revisa suele ser jefatura, que ve todo.
- **Sin cambios:** la app del mecánico. Su historial ya iba por equipo.
