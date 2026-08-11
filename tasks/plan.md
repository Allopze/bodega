# Plan de implementación: GDI dentro de Adquisiciones

## Auditoría inicial

El flujo vivo es `/solicitudes` → `/aprobaciones` → `/compras` → `/recepcion`; la
trazabilidad transversal está en `lib/services/document-chain.ts` y las entregas
de EPP a trabajadores viven en `/entregas`, que no es el tramo Oficina → Faena.
Las OCs conservan `deliveryMode` (`via_oficina` o `directo_faena`) y contadores
`quantityOfficeReceived` / `quantityReceived` por ítem. `lib/services/receiving.ts`
ya bloquea la OC y los ítems, soporta recepciones parciales y actualiza los
estados de la OC.

La GDI existente se creó en la migración 0150. Usa `dispatch_guides` y
`dispatch_guide_items`, correlativo `GDI` vía `nextCodeTx`, estados `draft`,
`dispatched`, `received`, `cancelled`, permisos `warehouse:*_guide`, auditoría,
`status_history`, movimientos `egreso_traslado`/`ingreso_traslado` y un PDF en
`app/(print)/bodega/guias/[id]/print`. Su servicio limita el origen a la faena
configurada como Oficina CHOME y serializa el despacho con `FOR UPDATE`, pero es
independiente: no tiene FK a OC, recepción ni solicitud; permite crear líneas
desde el stock actual; mueve stock al despachar; y confirma recepción sin
cantidades cotejadas ni diferencias. La navegación independiente está en
`modules/warehouse/manifest.ts` (`/bodega/guias`).

No aparecen fixtures de inserción de `dispatch_guides` en el repositorio; las
guías históricas reales deben conservarse mediante columnas nuevas nullable y
rutas de detalle/PDF compatibles. No se elimina la tabla ni el correlativo.

## Decisiones de arquitectura

- Preparar GDI automáticamente desde la recepción en oficina, agrupando los
  ítems físicos por faena destino. No se genera para `directo_faena`, para una
  compra final en oficina ni para `products.isService`/líneas sin bien físico.
- Una recepción puede preparar varias guías y el mismo ítem de OC puede tener
  muchas líneas de GDI a través de varias guías. La disponibilidad se calcula
  como `office received - non-cancelled guide dispatched quantities`.
- La entrada de stock del bien catalogado ocurre una vez al recibirlo en
  oficina (`ingreso_oc`, referenciada a la recepción). El despacho hace la
  salida de oficina y entrada en faena (`dispatch_guide`); el cotejo no duplica
  movimientos.
- El cotejo guarda `quantityReceived`, diferencia y observación por línea.
  Una guía queda completa sólo cuando todas sus líneas fueron cotejadas; si hay
  diferencias queda parcial/con diferencia sin modificar retroactivamente lo
  despachado.
- Las GDI legacy quedan visibles por detalle, OC, Solicitud, Recepciones y
  trazabilidad. Se retira la navegación y el alta manual desde Bodega; las
  rutas legacy de detalle/PDF permanecen como compatibilidad.
- Los permisos actuales se reutilizan: recepción de oficina/faena para cada
  evento; `warehouse:create_guide` para preparar/editar; `warehouse:dispatch_guide`
  para confirmar salida; `warehouse:receive_guide` para cotejar; y
  `warehouse:cancel_guide` para anular.

## Fases y checkpoints

### Fase 1: datos y dominio

- Añadir relaciones OC/recepción/ítem a GDI y líneas de cotejo sin borrar datos.
- Centralizar estados y reglas de elegibilidad física.
- Generar una migración nueva con `db:generate`; nunca editar el journal.

### Fase 2: recepción y despacho transaccional

- Al confirmar recepción en oficina, registrar stock de bienes y preparar GDI
  idempotentemente por faena.
- Permitir seleccionar cantidades disponibles, múltiples guías y despachos
  parciales bajo lock transaccional.
- Confirmar cotejo completo/parcial con actor, timestamp y diferencia.

### Fase 3: interfaz y expediente

- Mostrar las dos etapas dentro de Recepciones y una cola por estado.
- Ofrecer la GDI heredada y sus acciones desde Recepciones, OC y Solicitud.
- Actualizar cadena documental, estados visibles y PDF.
- Retirar el ítem de navegación independiente de Bodega.

### Checkpoint final

- Tests unitarios/integración nuevos y existentes.
- Lint, `npx tsc --noEmit`, build de producción.
- Verificación de migración, PDF, permisos, cantidades, movimientos únicos y
  rutas históricas.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---:|---|
| Cambios no relacionados ya sucios en rollup/recepción/purchasing | Alto | No sobrescribirlos; revisar diffs y tocar sólo líneas necesarias |
| Guías históricas sin claves nuevas | Alto | FKs nullable y compatibilidad de lectura/PDF |
| Carrera entre dos despachos | Alto | Lock por ítem de OC en orden estable + guarda de cantidades y estado |
| Doble inventario al cotejar | Alto | Entrada oficina, traslado al despacho, cero movimiento al cotejo |
| Servicios confundidos con bienes | Medio | `products.isService` y presencia de `productId`, sin excepciones por nombre |
| Mixed OC de faenas | Alto | Agrupar/preparar una guía por `purchaseRequests.worksiteId`; nunca mezclar destinos |

## Trabajo pendiente explícito

- Verificar en el entorno conectado si existen filas históricas reales de GDI y
  hacer el backfill sólo cuando la relación pueda inferirse sin inventar datos.
- La compatibilidad de OCs históricas sin `requestItemId` no puede producir una
  GDI automática; se mantienen consultables y no se les inventa origen.
