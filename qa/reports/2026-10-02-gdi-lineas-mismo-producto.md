# GDI con líneas del mismo producto — fix y verificación (2026-10-02)

Rama `fix/gdi-lineas-mismo-producto`.

## Problema reportado

Registrar la llegada a oficina de **OC-2026-0032** (vía oficina, faena Biodiversa) respondía
"Error al registrar recepción". Producción registró tres intentos (2026-10-01, 23:25, 23:28 y
23:29 UTC).

## Evidencia y causa

- **Log de producción**: falla el `insert into "dispatch_guide_items"` de
  `prepareDispatchGuideForOfficeReceiptTx`, que corre dentro de la transacción de
  `registerReceipt`. La recepción completa se revierte.
- **Causa**: el índice único `dispatch_guide_items_guide_product_unique (guide_id, product_id)`
  admite un solo renglón por producto en cada guía. La OC tiene EPP-027 y EPP-029 dos veces
  cada uno, y la GDI crea un renglón por línea de recepción.
- **Reproducción**: el test PGlite nuevo falló con el mismo `23505` sobre ese índice.
- **Producción (consultas READ ONLY)**:
  - Los intentos fallidos no dejaron recepciones ni GDI.
  - Otras OCs vía oficina abiertas con producto repetido: **0029** y **0033**.
  - OC-2026-0027 repite un servicio, que la GDI omite, así que no está afectada.
  - Ninguna fila actual viola los índices nuevos.
- **Origen de las líneas repetidas**: son legítimas. Vienen de solicitudes distintas o de dos
  líneas iguales de una misma solicitud, y la creación de OC nunca exigió producto único. La
  unificación de duplicados EPP del 2026-10-01 **no** es la causa.

## Cambio

- **Migración `0348_dispatch_guide_items_line_unique`**: el índice por producto se reemplaza
  por tres índices parciales.
  - `(guía, línea de OC)` y `(guía, línea de recepción)` para las guías de adquisiciones.
  - `(guía, producto)` solo para las guías manuales.
- **Edición de borradores vinculados** (`updateDispatchGuide`): cada fila se identifica por
  `sourceGuideItemId`, no por producto.
  - Sin ese campo, se acepta solo si el producto tiene una única línea de origen. Así sigue
    funcionando un formulario abierto antes del deploy.
  - Una guía manual rechaza líneas de origen.
- **Pre-chequeo de stock** (despacho y anulación): suma las líneas del mismo producto.
- **Formulario de guía**: clave de fila por línea de origen; etiqueta "SOL-xxxx · línea N de M
  de este producto en la OC"; aviso de sobre-stock sumado por producto.
- **Logger**: el log de un `Error` incluye `cause.code` y `cause.constraint` del driver, sin el
  `detail`. El próximo fallo de base dirá qué restricción lo rechazó.

## Verificación ejecutada

| Verificación | Resultado |
|---|---|
| `npm run typecheck`, `eslint` de lo tocado | OK |
| `npm run test:fast` | 820 archivos / 10 551 tests OK |
| `npm run test:pglite` | 250 archivos / 2 938 tests OK |
| `lib/__tests__/dispatch-guides.test.ts` | 7 tests nuevos: fallaban antes del fix, ahora 45/45 |
| `npm run db:verify-migrations`, segundo `db:generate` | cadena OK; "No schema changes" |
| `npm run db:migrate` en `bodega_dev` | 3 índices nuevos presentes |
| `npm run test:e2e -- e2e/guias-despacho.spec.ts --project=chromium` | 3/3, incluido el caso nuevo |

**Navegador** (`next dev` :3001, sesión QA, OC sembrada `QA_OC-GDI-DUP` con dos líneas de
EPP-002, de 5 y 3):

| Paso | Resultado |
|---|---|
| Recepción en oficina | REC-2026-0054 registrada; GDI-000031 preparada con 2 renglones |
| Edición del borrador | dos filas rotuladas "línea 1/2 de 2"; se bajó una de 5 → 1; en base cada renglón conservó su línea de OC y de recepción |
| Despacho | 2 salidas de oficina (−3, −1) y 2 ingresos a faena |
| Cotejo en faena | línea 1 recibió 1/5 y línea 2 recibió 3/3; OC `partially_received` (quedan 4 en oficina) |
| Errores | sin errores de consola ni respuestas HTTP ≥ 400 en todo el recorrido |

## Hallazgo de accesibilidad (corregido en esta misma rama)

**Antes:** en `/recepcion/nueva`, dos líneas del mismo producto tenían el mismo nombre
accesible ("Cantidad a recibir de …"), tanto en la tabla de escritorio como en las tarjetas
móviles.
- Un lector de pantalla no las distinguía.
- Con cantidades iguales tampoco se distinguían a la vista: OC-2026-0032 trae dos líneas de
  50 de EPP-027.

**Corrección** (`app/(app)/recepcion/receipt-form.tsx`): cuando un producto se repite en la OC,
cada campo recibe "…, línea N de M" en su nombre accesible y la fila muestra "Línea N de M de
este producto". Un producto que aparece una vez conserva el rótulo de siempre, así que los E2E
existentes siguen igual.

**Verificación:**
- 3 tests nuevos en `receipt-form.test.tsx`: fallaban antes, ahora 26/26.
- Navegador sobre `QA_OC-GDI-DUP2` (dos líneas de 50) a 1440 px y a 390 px: nombres distintos
  en los 6 campos visibles, texto de línea visible, axe (wcag2a/2aa/21aa en `main`) sin
  violaciones y sin errores de consola.
- El E2E de guías ahora usa los nombres exactos (`exact: true`).
- E2E de recepción en chromium: `guias-despacho`, `oc-flow`, `directo-faena-flow` y
  `purchase-flow`, 9/9.
- `npm run test:fast`: 10 554 tests OK.

## Pendiente

- **Deploy**: la migración 0348 corre en el servicio `migrate`. Después de desplegar:
  - reintentar la recepción de OC-2026-0032;
  - confirmar con una consulta READ ONLY 1 recepción, 1 GDI y 8 renglones.
- Los datos `QA_OC-GDI-DUP`, `QA_OC-GDI-DUP2` y sus solicitudes `QA_` quedan en `bodega_dev`.
