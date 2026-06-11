# Chome Solicitudes y Bodega — Producto

## Propósito

Chome Solicitudes y Bodega es un sistema interno para gestionar el ciclo
de abastecimiento operativo en faenas. Coordina pedidos, aprobaciones,
compras, facturación, recepción, entregas y trazabilidad, reemplazando
planillas dispersas con un único flujo trazable.

## Usuarios y roles

| Rol                      | Faenas visibles    | Puede                                      |
|--------------------------|--------------------|--------------------------------------------|
| `administrador`          | Todas              | Configurar sistema, usuarios, auditoría    |
| `jefa_chome`             | Todas              | Aprobar, comprar, recibir, despachar       |
| `secretaria`             | Todas              | Aprobar, comprar, recibir, despachar       |
| `prevencionista`         | Todas              | Aprobar ítems EPP                          |
| `solicitante_faena`      | Solo asignadas     | Crear y enviar solicitudes de sus faenas   |

Notas:

- El rol `solicitante_faena` siempre está scoped a una o más faenas
  explícitas. Nunca tiene visibilidad global.
- Los roles de liderazgo operativa (`jefa_chome`, `secretaria`,
  `prevencionista`) ven todas las faenas pero su alcance operativo se
  controla por permisos (`approvals:approve`, `purchasing:create_order`,
  etc.) y no por visibilidad de faena.
- El sistema no incluye un rol `finanzas` ni módulo contable: las
  facturas son archivos anexos al documento de compra, no transacciones
  financieras.

## Flujo principal

```
Prevencionista faena  →  Aprobación  →  Compras (OC)  →  Recepción  →  Entrega  →  Trazabilidad
   (faena)       (jefatura/sec/   (secretaría/     (prevencionista (bodega →    (matriz +
                 prevencionista) jefa_chome)      o bodega)      faena)       reportes)
```

1. **Maestros.** El administrador configura faenas, centros de costo,
   proveedores, productos, bodegas, usuarios y roles.
2. **Solicitud.** El prevencionista faena crea una solicitud con ítems
   catalogados o libres. La solicitud queda en `draft` y se envía a
   aprobación.
3. **Aprobación.** Los roles autorizados aprueban, rechazan, devuelven
   o modifican la cantidad de cada ítem. La transición es por ítem, no
   por solicitud, y cada decisión queda registrada con `approvalDecisions`.
4. **Compra.** El equipo de compras agrupa ítems aprobados en una OC por
   proveedor. La OC pasa por `draft → issued → sent`.
5. **Factura.** El personal autorizado anexa la factura del proveedor
   como archivo (PDF/JPG/PNG/WebP) con número, fecha y monto. La
   factura se concilia contra la OC.
6. **Recepción.** La mercadería se registra primero como llegada a
   oficina Chome y luego como recepción en bodega/faena, que dispara el
   ingreso de stock.
7. **Entrega.** Desde bodega se despachan productos a faena. La entrega
   puede asociarse a un ítem de solicitud para mantener la trazabilidad.
8. **Trazabilidad y reportes.** La matriz de trazabilidad muestra el
   estado de cada ítem de extremo a extremo. Los reportes cubren gasto
   por faena, ítems sin OC, OC por estado y facturas pendientes.

## Estados clave

### Solicitud (`purchase_requests.status`)

`draft | submitted | in_review | partially_approved | approved | rejected |
returned | in_purchasing | closed | cancelled`

### Ítem (`purchase_request_items.status`)

Máquina de estados con transiciones explícitas en
`lib/services/item-state.ts`. Estados terminales: `rejected`, `delivered`.

### OC (`purchase_orders.status`)

`draft | issued | sent | supplier_confirmed | partially_received |
received | closed | cancelled`

### Recepción (`receipts.status`)

`open | closed`

### Factura anexa (`invoice_attachments.status`)

`registered | observed | reconciled`

## Principios

- **Trazabilidad primero.** Cada cambio de estado, cada acción, cada
  movimiento de stock deja un registro. La auditoría es transaccional.
- **Scoping por faena.** Las consultas siempre filtran por las faenas
  visibles del usuario (en SQL, no en memoria).
- **Estados explícitos.** El estado de cualquier entidad es un campo
  tipado y validado; las transiciones pasan por una máquina
  verificada.
- **Acciones chicas y reversibles.** No se borra; se anula o
  devuelve. Las cantidades se reciben en pasos, no se sobreescriben.
- **Cero código de stock negativo.** `applyMovement` rechaza
  movimientos que llevarían el stock a menos de cero.

## Decisiones de no-objetivo

- **No es un ERP.** No maneja contabilidad, ni tributación, ni cuentas
  corrientes de proveedores. La factura es un anexo, no un documento
  financiero.
- **No es un marketplace.** Los proveedores se cargan manualmente.
- **No es mobile-first.** El uso principal es desktop en oficina. Hay
  aprobaciones rápidas desde celular, pero las tablas densas no se
  reescriben para táctil.
- **No es multi-tenant.** La instalación es por organización. No hay
 隔离 entre empresas dentro del mismo despliegue.

## Glosario

- **Faena** — Obra o proyecto físico donde se entregan los productos.
- **Centro de costo** — Unidad contable dentro de una faena.
- **EPP** — Elemento de protección personal. Requiere aprobación de
  Prevención.
- **Prevencionista oficina** — Persona que valida ítems de seguridad.
- **Trazabilidad** — Capacidad de seguir un ítem desde la solicitud
  hasta la entrega en faena.
