# QA — Repuestos vinculados al equipo y a la OT

**Fecha:** 2026-11-07 · **Rama:** `feat/repuestos-vinculados` (sin merge a main, sin push) · **Plan:** `docs/superpowers/plans/2026-11-07-repuestos-vinculados.md` · **Diagnóstico previo:** `qa/reports/revision-flujo-oc-repuestos-2026-11-07.md`

## Alcance verificado

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS (0 errores) |
| `eslint .` | PASS |
| `npm run db:verify-migrations` | PASS (380 entradas, hasta 0379) |
| `npm run check:secrets` | PASS |
| `test:fast` (non-pglite) | 1260 archivos PASS · 2 FAIL preexistentes (ver abajo) |
| `test:pglite` | 360 archivos PASS · 1 FAIL preexistente (ver abajo) |
| E2E completa (chromium, 51,8 min) | 1093 PASS · 5 skipped · 7 FAIL preexistentes (ver abajo) |
| Recorrido en navegador (dev :3002 sobre `bodega_dev` migrada) | 13 pasos PASS, 0 errores de consola reproducibles, 0 respuestas 5xx |

`bodega_dev` quedó migrada a 0379 (incluye 0375–0377 de main, que le faltaban) y con `db:sync-rbac`. El recorrido dejó en esa base la solicitud `REP-2026-0001` (ítem `QA_ Filtro hidráulico de retorno`, aprobada sin cotización, vinculada a `OT-BIO-0003` / KA-143).

## PASS verificado

- **Desde la OT:** «Más acciones → Pedir repuestos» abre `/solicitudes/nueva?tipo=repuestos&ot=…` con faena, equipo (KA-143), OT y urgencia alta precargados.
- **Formulario:** combobox «Equipo de flota», select de OT abierta, «Precio unitario estimado (CLP)», proveedor sugerido; el borrador guarda `vehicle_id`, `work_order_id`, `estimated_unit_price` y `directo_faena` (comprobado en BD).
- **Umbral:** bajo $500.000 se envía sin cotización y aparece «Aprobar sin cotización»; sobre el umbral sin cotización el envío se bloquea con «Sobre $500.000 se necesita al menos una cotización adjunta.» (E2E).
- **Aprobación sin cotización:** diálogo con justificación opcional; la solicitud queda «Aprobada sin cotización».
- **OT:** sección «Repuestos pedidos» con solicitud, estado en español, OC, entrega estimada, recibido `0/2` y «Declarados en los registros»; la lista de OT muestra «Esperando repuesto» con el chip «Repuestos: pendientes».
- **Nueva OC:** ítem con «Equipo: KA-143 · SJFC-66 · OT OT-BIO-0003» y precio $15.000 prellenado con origen «estimado».
- **Control operacional:** columnas «Mano de obra / taller (OT)» y «Repuestos y servicios (OC)»; detalle del tile de OT con «N esperando repuesto».
- **Fichas:** «Repuestos y servicios comprados» en la ficha del equipo (mantención) y del vehículo (flota).
- **Admin:** «Monto bajo el cual no se exigen cotizaciones (CLP)» en Parámetros operativos.
- **Permisos:** `jefe_mantencion`, `supervisor_mantencion` y `admin_contrato` crean y envían repuestos (y ven las propias); la aprobación sigue sólo en jefa/administrador; el mecánico no ve «Pedir repuestos» (E2E).
- **Aviso a mantención:** recepción completa en faena de un repuesto de OT, por recepción directa y por guía de despacho (PGlite).

## PRODUCT BUG (encontrado y corregido en esta rama)

1. **Borrador con cotización ya guardada se leía «sin cotización».** El aviso de la regla nueva sólo contaba las cotizaciones en subida, no las del panel; el botón «Enviar a aprobación» quedaba bloqueado en el cliente. Lo destapó la E2E de adjudicación. Corregido en `8cc57096c` con prueba unitaria.
2. **Supervisor de mantención sin lista de solicitudes.** Podía crear desde la OT pero `/solicitudes` le daba `/forbidden`. Corregido (`requests:view_own` + alta puntual) en `b7a526c26`.
3. **Guía de despacho no avisaba a mantención.** Una OC vía oficina llega a faena por la guía y ese camino no avisaba. Corregido en `b7a526c26` con dos pruebas.

## FAIL preexistentes (se reproducen igual en main `8a611f79d`, sin estos cambios)

- **E2E `catalogs-migrated` y `modal-alto-estable` (3):** `/admin/flota-catalogos/vehiculos` tiene ahora su buscador «Buscar en la tabla» y los specs filtran con el de la barra superior; `E2E-FUEL-1` no aparece en la primera página.
- **E2E `control-operacional-combustible` (1):** el spec busca la columna «Costo combustible facturado»; la tabla de main se llama «Costo combustible (proveedor)».
- **E2E tiles de documentos (3, en `control-operacional-navegacion` y `densidad-kpi`):** la base E2E no trae documentos de flota vencidos a la fecha; el tile enlaza a «al día».
- **`oc-pdf-route-engine.test.ts` (4 casos):** `PDF_ORIGIN_NOT_CONFIGURED` en el entorno de prueba.
- **`fuel-past-load-pglite.test.ts` (1 caso):** la ventana de 62 días depende de la hora de la corrida.

## INCONSISTENCY / decisiones a revisar

- **«Costo total» por equipo** es nulo si el equipo no tiene OT cerrada con costo de mano de obra en el período (semántica heredada de antes de este cambio, ahora más visible con tres series).
- **Un borrador de repuestos cuenta como «esperando repuesto»** en la OT (el plan incluye `draft` en los estados pendientes).
- **El tile «OT abiertas» sigue enlazando a todas las abiertas**, no al filtro de repuestos: llevarlo al filtro mostraría menos filas que la cifra del tile (A1).
- **La copia de una solicitud de repuestos (`?desde=`)** ya perdía el N.° de parte antes de este cambio; no se tocó.

## COVERAGE GAP

- No se creó una OC ni una recepción desde el navegador; esos caminos quedan cubiertos por PGlite (OC, compra parcial, recepción directa y por guía, aviso).
- No se recorrió en viewport móvil ni con `E2E_MOBILE_BROWSERS=1`.
- No se verificó el correo del aviso `mant_ot_parts_received` (sólo su creación y destinatarios).
- Producción no se tocó: falta `db:migrate` (servicio `migrate`) y `db:sync-rbac` en el deploy.

## Seguimientos fuera de este plan

- Centro de costo nunca asignado en solicitudes ni OC.
- Catálogo mínimo de repuestos (N.° de parte, historial de precios, conciliación por SKU).
- Evento `parts_requested` en la bitácora de la OT.
- Corregir los 7 E2E y 2 pruebas preexistentes listados arriba.
