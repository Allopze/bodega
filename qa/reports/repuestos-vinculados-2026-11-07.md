# QA — Repuestos vinculados al equipo y a la OT

**Fecha:** 2026-11-07 · **Rama:** `feat/repuestos-vinculados` · **Plan:** `docs/superpowers/plans/2026-11-07-repuestos-vinculados.md` · **Diagnóstico previo:** `qa/reports/revision-flujo-oc-repuestos-2026-11-07.md`

Dos pasadas el mismo día. La primera verificó la implementación del plan. La segunda incorporó tres decisiones posteriores del usuario (umbral $200.000, borrador no cuenta como espera, costo total con mano de obra en $0) y corrigió lo que ya fallaba en main.

## Resultado final (segunda pasada)

| Puerta | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `eslint .` | PASS |
| `npm run db:verify-migrations` | PASS (380 entradas, hasta 0379) |
| `test:fast` (non-pglite) | PASS — 1262 archivos, 0 fallas |
| `test:pglite` | PASS — 361 archivos, 0 fallas |
| E2E completa (chromium) | 1097 PASS en la corrida completa; las 2 fallas eran de los specs y quedaron corregidas, y esos specs (3 tests) pasan sobre el commit final |
| Navegador (dev :3002 sobre `bodega_dev`) | PASS, 0 errores de consola, 0 respuestas 5xx |

`bodega_dev` quedó migrada a 0379 y con `db:sync-rbac`. Contiene la solicitud de prueba `REP-2026-0001` (ítem `QA_ Filtro hidráulico de retorno`, aprobada sin cotización, vinculada a `OT-BIO-0003` / KA-143).

## PASS verificado

- **Desde la OT:** «Más acciones → Pedir repuestos» abre la solicitud con faena, equipo, OT y urgencia alta precargados.
- **Formulario:** «Equipo de flota», OT abierta, «Precio unitario estimado (CLP)» y proveedor sugerido; el borrador guarda vehículo, OT, precio y `directo_faena`.
- **Umbral $200.000:** bajo el umbral se envía sin cotización y la jefa ve «Aprobar sin cotización»; sobre él, sin cotización, el envío se bloquea nombrando el monto.
- **OT:** «Repuestos pedidos» con estado, OC, entrega estimada, recibido y lo declarado en los registros. Un borrador aparece en la sección pero NO marca «Esperando repuesto»; al enviarlo a aprobación sí (E2E).
- **Nueva OC:** equipo, OT y precio estimado prellenado.
- **Control operacional:** columnas «Mano de obra / taller (OT)» y «Repuestos y servicios (OC)». El «Costo total» ya no queda «—» por falta de mano de obra: en `bodega_dev` las 25 filas de la primera página muestran total. El tile de OT dice «N esperando repuesto».
- **Fichas del equipo y del vehículo:** «Repuestos y servicios comprados».
- **Permisos:** mantención crea y envía; la aprobación sigue en jefa/administrador; el mecánico no ve «Pedir repuestos».
- **Aviso a mantención:** al llegar completo a faena, por recepción directa y por guía de despacho (PGlite).

## PRODUCT BUG corregidos

**Del trabajo de repuestos (encontrados al integrar):**
1. Un borrador con su cotización ya guardada se leía «sin cotización» y no se podía enviar.
2. El supervisor de mantención no veía la lista de sus solicitudes.
3. La recepción por guía de despacho no avisaba a mantención.

**Que ya estaban en main:**
4. **Catálogos de vehículos y proveedores con dos buscadores.** Un commit les agregó buscador propio suponiendo que la barra no busca ahí; las dos tablas sólo viven en `/admin/flota-catalogos`, donde la barra sí busca, y su filtro quedaba inerte. Vuelven a usar sólo el de la barra.
5. **Cambio de horario de septiembre.** `chileLocalDateTimeToUtc` llevaba las horas inexistentes del 6 de septiembre (00:00–00:59) al día anterior; una carga de combustible de las 00:15 de ese día quedaba registrada el 5. Ahora avanza a la primera hora válida del mismo día.

## Specs y pruebas que estaban desalineados con main (corregidos)

- Panel operacional: la tarjeta móvil y un spec seguían con «Costo combustible facturado» cuando la columna se llama «Costo combustible (proveedor)»; el spec además sembraba `fuel_loads`, y el costo del panel sale del libro del proveedor.
- Tile de documentos: tres specs esperaban siempre «vencidos», pero el tile enlaza a lo que cuenta (vencidos, por vencer o al día).
- PDF de la OC: la prueba no configuraba el origen de impresión que exige el cambio de seguridad que lo hizo sólo del entorno.

## Decisiones abiertas

- Ninguna bloqueante. Quedan fuera de este plan el centro de costo, el catálogo de repuestos y el evento `parts_requested` en la bitácora de la OT.

## COVERAGE GAP

- No se creó una OC ni una recepción desde el navegador; esos caminos están cubiertos por PGlite.
- No se recorrió en viewport móvil ni con `E2E_MOBILE_BROWSERS=1`.
- No se verificó el correo del aviso `mant_ot_parts_received` (sólo su creación y destinatarios).
- Producción no se tocó: el despliegue debe correr las migraciones 0378 y 0379 con el servicio `migrate` y `db:sync-rbac`.
