# QA — Catálogo de repuestos (fase 2), integración 2026-11-09

Rama `feat/catalogo-repuestos` (worktree `bodega-wt/catalogo-repuestos`). Base `main` 42c56a61f.
Puertas corridas sobre 34b0ffc4a (código final); los dos commits posteriores sólo tocan
`e2e/repuestos-catalogo.spec.ts` y se verificaron con la spec otra vez.

## Puertas deterministas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK (0 errores). La primera corrida dio 5 errores, corregidos en 34b0ffc4a (ver abajo). |
| `npm run lint` | OK, 0 errores y 0 avisos. |
| `npm run test:fast` | 1313 archivos pasan, 32 omitidos (1345); 19 820 pruebas pasan, 277 omitidas. |
| `npm run test:pglite` (suite completa, una vez) | 371/371 archivos; 4790 pruebas pasan, 1 omitida. Sin fallas, no hubo que repetir ninguna. |
| `npm run db:verify-migrations` | OK: 386 entradas hasta `0385_spare_parts_catalog`, checksums verificados. |
| `npm run check:secrets` | OK. |

## E2E (Playwright, worktree desechable `bodega-wt/e2e-34b0ffc4a`, BD `bodega-e2e-postgres` :55432)

- **Suite completa, chromium**: 1121 pruebas → **1115 pasan, 1 falla, 5 omitidas** (51,2 min).
  La única falla es la prueba nueva (`repuestos-catalogo.spec.ts:153`), por un localizador de la
  propia spec: `TableRoot` nombra su contenedor desplazable (rol `region`), no la tabla. La
  aplicación había registrado bien el precio (verificado en la BD: `product_supplier_price_history`
  con `source = purchase_order`, $45.000, y el snapshot de la página mostraba la fila).
  - Una corrida anterior de la suite se cortó al reiniciarse la sesión del editor tras 620
    pruebas (618 pasan, 2 omitidas, 0 fallas). Se descartó y se volvió a correr completa.
- **Re-ejecución de la spec tras los arreglos** (`E2E_SKIP_BUILD=true`, BD resembrada):
  `repuestos-catalogo.spec.ts` **3/3 pasan**. El segundo arreglo fue otro localizador: el rótulo de
  la cantidad a recibir suma los atributos pedidos («… · N° de Parte: …»).
- **Regresión del texto libre** (`ot-repuestos`, `repuestos-servicios-oc-flow`,
  `repuestos-servicios-flow`) y `control-operacional-navegacion` (orden nuevo del menú): pasan en la
  corrida completa.
- **Fallas preexistentes**: ninguna en chromium.
- **Móvil** (`E2E_MOBILE_BROWSERS=1`):
  - `mobile-chrome`: 40/40 pasan (su alcance fijo, `MOBILE_FIELD_FLOWS`).
  - `mobile-safari`: 40/40 fallan al **lanzar el navegador**: al host le faltan librerías de WebKit
    (`libgtk-4.so.1`, `libevent-2.1.so.7`, `libavif.so.16`…). Es del entorno, no de la app.
  - `repuestos-catalogo.spec.ts` no está en `MOBILE_FIELD_FLOWS`: `--project=mobile-chrome` sobre
    ella responde «No tests found». La corrí aparte con un config temporal (Pixel 7) y fallan las 3,
    todas por supuestos de escritorio de la spec: el menú lateral está plegado (el enlace del menú
    no es visible) y la lista de OT se pinta como tarjetas, no como filas. La prueba 3 llegó, en
    móvil, a crear la OT, pedir con el buscador, guardar y enviar la solicitud antes de tropezar con
    el localizador por filas. **Cobertura móvil del flujo nuevo: parcial, no certificada.**

### Lo que la prueba nueva verifica (pasos 2–5 del plan)
2. Desde una OT, «Pedir repuestos» → el buscador muestra primero `QA_Filtro petróleo RCE2E`
   con «Para este equipo», aunque `QA_Aceite…` va antes por nombre; precio precargado (31 990);
   segunda línea en texto libre; envío sin cotización bajo el umbral; la OT pasa a «esperando repuesto».
3. Admin aprueba sin cotización; en `/compras/nueva` sólo la línea libre ofrece «Catalogar»; «Crear
   uno nuevo» llega prellenado (nombre y N° de parte); OC con 2 ítems; la BD confirma `product_id`
   en el ítem de solicitud **y** en la línea de OC.
4. Al emitir: la ficha del repuesto nuevo muestra Proveedor E2E a $45.000 y una fila de historial
   «Orden de compra».
5. Recepción en faena (directo, sin etapa de oficina) → ambos ítems `delivered`, 0 filas en
   `inventory_movements` y `worksite_stock` para los dos repuestos, la solicitud dice «Entregado» y
   la OT sale de `?repuestos=pendientes`.

## Arreglos de integración

| Ítem | Arreglo | Commit |
|---|---|---|
| (a) | La ficha de la OC (lectura de factura y DTE candidatos) pasa `partNumber` al matcher; `assessDteCandidates` (etapa `sku`) compara también el N° de parte. Prueba unitaria nueva. La página no leía `products.part_number` (lo detectó el typecheck). | df3ab4316, 34b0ffc4a |
| (b) | Excluyen repuestos: `/api/bodega/opciones` (ajuste, baja, conteo: lo usa la hoja de movimientos), entregables de `/entregas`, reposición desde Bodega (`?producto=`), listado y Excel de `/admin/productos` (con nota en la descripción). Además, editar un repuesto desde admin o pisarlo con la importación de EPP se rechaza con mensaje. La lista genérica de solicitudes ya estaba filtrada (línea C); los selectores EPP sólo leen `is_epp`, que el CHECK hace incompatible con repuesto. | 9d0396093 |
| (d) | `resolveCatalogItemQuantitiesTx` (camino común de crear, borrador y editar ítem de EPP/«otro») rechaza un repuesto: «Ítem N: «X» es un repuesto de catálogo; pídelo en una solicitud de repuestos». PGlite nueva en `create-submitted-request-service.test.ts`. | 866202641 |
| (e) | Revisados ~45 lectores de `productNameFree`: todos los que nombran ítems ya hacen `products.name ?? productNameFree` (exportes, PDF, notificaciones, colas, aprobaciones, recepción, trazabilidad, conciliación). `dte-parser.matchDteItemsToOcItems` sólo mira el texto libre, pero **no tiene llamadores en producción** (sólo su test): no se tocó. | — |
| (f) | `repuestosModule` se registra después de `mantencionEquiposModule`: «Catálogo de repuestos» queda **al final** del grupo Mantención (tras Órdenes de trabajo, Panel, Registros, Equipos, Pautas y Dispositivos; el registro no permite ponerlo justo tras Panel). Sin efecto en permisos (los ids son fijos), seeds ni rutas de interruptores (se ordenan por largo de prefijo). Tests de navegación y E2E actualizados. | ccb58e0f7 |
| (g) | `scripts/capture-all-routes.ts`: `/mantencion/repuestos` y `/mantencion/repuestos/rpt-audit-1` con su fixture. Sin esto fallaba `capture-all-routes.test.ts` en `test:fast`. | 38ea7942f |
| (h) | Pasos 2–5 en `e2e/repuestos-catalogo.spec.ts`; sembrado en `e2e/fixtures/repuestos-catalogo-setup.ts` (2 repuestos `QA_`, precio preferido y una compra previa para el primer equipo de Biodiversa). | 026b0cf32, b36b4640c, 1d3adf8a4 |

## Lo que no se verificó

- Recorrido manual en `bodega_dev` (migrar 0385 + `db:sync-rbac`) y consola/red en escritorio y
  móvil: no se hizo. La evidencia de navegador es sólo la de las E2E.
- WebKit/Safari: no se puede ejecutar en este host.
- La spec nueva en viewport móvil (ver arriba).
- OC `via_oficina` que mezcla bienes con stock y repuestos (pendiente (c), diferido): sin cambios ni pruebas.
- Auditoría de navegador asistida (MonkeyTest): no se corrió.

## Observaciones

- **UX menor**: en la recepción, una línea catalogada desde la OC sigue mostrando el atributo
  pedido «N° de Parte: …» de la solicitud además del producto. No es incorrecto, pero duplica el
  dato que ya trae el repuesto.
- El buscador de la solicitud carga todo el catálogo en el cliente (riesgo de escala ya anotado en el plan).
