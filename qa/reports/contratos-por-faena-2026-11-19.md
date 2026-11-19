# QA — Contratos por faena (2026-11-19)

Rama `feat/contratos-por-faena` (worktree `bodega-wt/contratos-faena`), con `main` 96a23ea33 fusionado (traslado de equipos, Next 16.4.6) en 6fcc56005.
Spec: `docs/superpowers/specs/2026-11-18-contratos-por-faena-design.md`.
Plan: `docs/superpowers/plans/2026-11-18-contratos-por-faena.md`.

## Alcance recorrido

Verificado:

- Puertas deterministas sobre la cabeza fusionada.
- E2E dirigida (15 specs) contra una **build de producción** (`next build` + standalone), con base y puerto propios (`bodega_e2e_contratos`, :3101).
- Recorrido de navegador sobre `bodega_dev` servido con esa misma build en :3002, con el usuario QA administrador.

No recorrido:

- Producción.
- Roles acotados en el navegador. Están cubiertos por pruebas de acción (`contract-actions.test.ts`, `flota-change-contract-action.test.ts`) y por la E2E de `restricted-roles` y `control-operacional-navegacion`.
- El traslado/anulación **por la interfaz** con contratos. Su efecto sobre los contratos lo cubren las pruebas PGlite de `fleet-transfers-pglite.test.ts`, y la E2E `traslado-equipos` pasa, pero no verifica el contrato.
- Rendimiento con volumen de producción.

## Puertas

| Puerta | Resultado |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run lint` (hook de commit) | OK (1 advertencia preexistente de `main` en `e2e/mantencion-3a-equipos.spec.ts`) |
| `npm run check:secrets` | OK |
| `npm run check:security-audit` | OK (sin altos ni críticos) |
| `npm run db:verify-migrations` | OK (394 entradas hasta `0393_crazy_venus`) |
| `npm run test:fast` | OK: 1.399 archivos, 20.968 pruebas |
| `npm run test:pglite` | OK: 406 archivos, 5.272 pruebas (la falla preexistente de `queries.test.ts` ya no aparece tras fusionar `main`) |
| E2E dirigida (build de producción) | **115/115 pasan** |

Specs E2E: `contratos-faena` (nueva), `traslado-equipos`, `ficha-vehiculo`, `flota`, `control-operacional-navegacion`, `control-operacional-combustible`, `mantencion-3a-equipos`, `mantencion-3c-incorporar-flota`, `facturacion`, `restricted-roles`, `catalogs-migrated`, `admin-flow`, `admin-index`, `modal-alto-estable`, `combustibles`.

### Corridas previas sobre `next dev` (no son evidencia)

Antes de la fusión, la misma batería sobre `next dev --webpack` dio entre 1 y 19 fallas por corrida. El servidor llegó a 8 GB y se reinició 13 veces, con `ERR_CONNECTION_REFUSED/RESET`, el login agotado y clics de pestaña que no navegaban en 5 s por compilación en frío. Las fallas también caían en pantallas que la rama no toca. En la build de producción no se repitió ninguna.

## Integración con el traslado de equipos (main)

`main` dejó el traslado (`transferVehiclesTx`) como la única puerta para cambiar un equipo de faena, y ese camino no cerraba el contrato. Se conectó así:

- **Traslado:** cierra el contrato de origen el día anterior a la fecha (`relocateVehicleWorksiteTx`).
- **Anulación:** devuelve el equipo a su contrato de origen (`revertVehicleRelocationTx` → `reopenContractAssignmentsOnVoidTx`), con el mismo criterio con que se reabre la estadía de origen. No se reabre si el contrato ya no está activo ni si terminó antes del traslado.
- **Guarda estática:** `fleet-relocation-callers.test.ts` ahora exige esto en `fleet-transfers.ts` e impide escribir la faena por otro lado.

## Recorrido de navegador (bodega_dev, build de producción :3002)

Datos `QA_` sembrados por la interfaz en «Cholguan - Arauco»:

- Mandante «QA_Mandante Arauco», creado en línea.
- «QA_Movimiento de residuos», con KA-128 y CA-83 desde el 01-08-2026.
- «QA_Carga y descarga de madera», con término el 31-12-2026 y CA-90 y GR-09 desde el 01-08-2026.
- CA-90 pasa a residuos el 15-10-2026 desde su ficha.

| Paso | Resultado |
| --- | --- |
| Lista de faenas → detalle de la faena | PASS |
| Crear contrato con mandante en línea | PASS (nace `billing_cycle='none'`, código automático) |
| Segundo contrato con término, mandante existente | PASS |
| Asignar en lote con fecha pasada | PASS en base y en pantalla (`02-faena-con-contratos.png`). El guion marcó FAIL: **advertencia de automatización**, porque `isVisible()` no espera al refresco posterior al cierre de la hoja |
| Asignación en un contrato con término queda acotada a ese término | PASS (GR-09: `valid_to = 2026-12-31`) |
| «Sin contrato» lista los equipos de la faena sin contrato (KA-59) | PASS |
| Ficha: cambiar de un contrato con término a otro el 15-10 | PASS: madera 01-08 → 14-10, residuos desde 15-10 (`03-ficha-ca90.png`) |
| La descripción de la ficha nombra faena y contrato | PASS («Cholguan - Arauco · QA_Movimiento de residuos») |
| Panel: sección «Costo por contrato» en 01-08 → 31-10 | PASS (`04-panel-seccion.png`) |
| Cuadratura por Excel: contratos de Cholguán = hoja «Activos» de Cholguán, por componente | PASS: combustible $8.396.432 = $888.063 + $7.508.369; OT $0 = $0; compras con equipo $0 = $0 |
| El nombre del contrato filtra el Panel conservando el período | PASS (`05-panel-filtrado.png`) |
| Ancho de 390 px sin scroll horizontal (faena y Panel) | PASS |
| Errores de consola | PASS (ninguno) |
| Respuestas 5xx o requests fallidos | PASS (sólo `ERR_ABORTED` de precargas y navegaciones canceladas, que no son fallas) |

Durante el recorrido, el guion mismo tuvo tres defectos que se corrigieron antes de la corrida final. Ninguno era de la aplicación:

- El selector «Hasta» se llama «Término del contrato».
- El calendario sólo retrocedía meses.
- La región «Costo por contrato» coincidía por subcadena con las tablas «Costo por contrato en …»; se resolvió con `exact: true`.

## Hallazgos

### PRODUCT BUG

Ninguno confirmado.

### INCONSISTENCY / UX FINDING

1. **«Sin contrato» no aparece en el Panel cuando su costo es $0, pero un contrato sin equipos sí aparece con $0.** En Cholguán, el detalle de la faena lista más de 20 equipos sin contrato, pero el Panel no muestra esa fila porque en el período no tuvieron costo. Se lee bien gracias a la cuadratura, pero el criterio de mostrar u ocultar filas en $0 no es el mismo para las dos.
2. **Cada faena repite la cabecera de la tabla y sus columnas no se alinean entre faenas** (`04-panel-seccion.png`). Es aceptable, pero una sola tabla con filas de grupo se leería mejor.
3. **El historial de contrato puede nombrar contratos de otra faena después de un traslado.** Ya se había anotado en la revisión final y queda como seguimiento.

### COVERAGE GAP

- El traslado y la anulación por la interfaz con un equipo que tiene contrato. Está cubierto en PGlite, no en la E2E.
- La columna «Mano de obra (OT)» es $0 en todo `bodega_dev`, así que el reparto de OT por contrato sólo está verificado en PGlite (`contract-costs-pglite.test.ts`).

## Datos que quedan en bodega_dev

- Los contratos `QA_Movimiento de residuos` y `QA_Carga y descarga de madera`.
- El mandante `QA_Mandante Arauco` (RUT 76.123.456-0).
- Cinco asignaciones.

Se dejaron para revisar la pantalla. Para borrarlos:

```sql
delete from contract_vehicle_assignments where contract_id in (select id from contracts where name like 'QA_%');
delete from contracts where name like 'QA_%';
delete from clients where name like 'QA_%';
```

`bodega_dev` quedó migrada hasta la 0393. Las 0391 y 0392 de `main` se aplicaron después de retirar la 0391 vieja de esta rama, que tenía un `when` posterior y habría hecho que `db:migrate` las saltara.
