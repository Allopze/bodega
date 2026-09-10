# Integridad operacional de compras, recepción y stock

**Base:** `docs/audits/COMPARATIVA_ODOO_ERPNEXT_BODEGA_2026-09-07.md`,
piloto A y hallazgos P0 de compras, stock y health checks.

## Problema

Bodega ya conserva OC, recepciones en oficina/faena, documentos tributarios,
kardex y saldo físico, pero tres límites impiden cerrar el ciclo con la misma
claridad cuantitativa que los mejores patrones observados en Odoo y ERPNext:

1. una línea documental sólo puede apuntar a una línea de OC, por lo que no se
   puede representar una división legítima N:N;
2. el stock visible es físico y no explica demanda pendiente ni entradas
   esperadas por faena;
3. existen detectores específicos de trazabilidad, pero no un expediente común
   para incoherencias de compras, recepción, conciliación y kardex.

## Objetivo

Entregar conjuntamente tres capacidades nativas de Bodega:

- asignaciones auditables de cantidad y subtotal entre líneas de factura/NC y
  líneas de OC;
- una proyección informativa de stock por producto-variante y faena;
- un ledger de hallazgos operacionales con detección, evidencia, verificación y
  navegación al módulo responsable de corregirlos.

La entrega no integra Odoo ni ERPNext, no introduce otro runtime y no cambia la
fuente de verdad de stock ni las reglas regulatorias actuales.

## Enfoques considerados

### A. Módulos de dominio con ledger común de hallazgos — elegido

`purchase-invoice-allocation` y `stock-availability` mantienen sus invariantes
dentro del dominio. `operational-integrity` normaliza solamente la persistencia,
el fingerprint, la severidad, la verificación y el DTO visible de hallazgos.

Es el enfoque con mayor profundidad: los consumidores aprenden interfaces
pequeñas, mientras que el locking, agregación y seguridad permanecen dentro de
sus módulos.

### B. Ampliar directamente `traceability_integrity`

Requiere menos archivos, pero obliga a volver opcional `requestItemId` y mezcla
reglas de solicitudes, facturas y kardex en un módulo cuyo vocabulario actual es
específico de entregas trazables.

### C. Motor genérico de reglas

Permitiría declarar detectores mediante metadata, pero agrega configuración,
callbacks y validación sin una necesidad demostrada. Se descarta para no crear
un metaframework.

## Arquitectura

### Asignaciones de líneas documentales

`purchase_order_invoice_item_allocations` será la fuente de verdad nueva para
los vínculos cuantitativos. Cada fila contendrá línea documental, línea de OC,
cantidad asignada, subtotal asignado, origen y actor cuando exista.

La interfaz transaccional reemplazará todas las asignaciones de una línea en
una sola operación. Releerá las filas desde PostgreSQL, bloqueará primero la
línea documental y luego las líneas de OC ordenadas por ID, y comprobará:

- todos los destinos pertenecen a la misma OC de la factura;
- no se repite el par línea documental/línea OC;
- cantidad y subtotal no son cero y conservan el signo de factura o NC;
- la magnitud de la suma asignada no supera la magnitud de cantidad ni subtotal
  de la línea documental;
- una asignación declarada como completa cuadra exactamente dentro de una
  tolerancia de `0.000001` para cantidad y `$1 CLP` para subtotal;
- la UOM normalizada coincide; no habrá conversiones implícitas.

El `purchaseOrderItemId` 1:1 actual permanecerá durante este release como espejo
de compatibilidad: tendrá valor sólo cuando exista una asignación única y
completa. Ningún lector nuevo lo usará como fuente de verdad. Su eliminación
requiere otro release y una verificación previa de consumidores.

El conciliador puro recibirá `allocations[]`, agregará cantidad/subtotal por
línea OC y calculará el fingerprint sobre esas asignaciones ordenadas. Un
fingerprint vencido impedirá guardar o aceptar diferencias. Los aliases de
proveedor sólo podrán aprenderse cuando una línea documental quede asignada
íntegramente a un único producto.

### Disponibilidad proyectada

`stock-availability` será un read model calculado, no una tabla de saldos:

- `onHand`: `worksite_stock.quantity`;
- `pendingDemand`: cantidad aprobada aún no entregada de solicitudes activas;
- `incoming`: cantidad de OC activa aún no recibida en la faena final;
- `projectedBalance`: `onHand + incoming - pendingDemand`.

Se excluyen solicitudes rechazadas/cerradas/anuladas, OC o líneas anuladas,
productos de servicio y entregas anuladas. La demanda exige producto concreto y
conserva su variante completa. Las OC vía oficina se proyectan en la faena final;
no se sumarán balances proyectados entre faenas porque una unidad puede estar
físicamente en oficina y simultáneamente pendiente de llegar a su destino.

La proyección es estrictamente informativa: un saldo negativo no impide crear
solicitudes, emitir OC, recibir ni entregar stock.

### Ledger de integridad

El ledger tendrá tres tablas:

- caso estable por dominio, código, entidad y faena;
- observaciones append-only por fingerprint y snapshot;
- eventos append-only de reconocimiento o resolución verificada.

Los detectores producirán `OperationalIntegrityFinding` mediante una interfaz
común, pero conservarán su implementación en cada dominio. La primera entrega
incluye exactamente cinco códigos:

1. `STOCK_MOVEMENT_CHAIN_BREAK`;
2. `STOCK_BALANCE_MISMATCH`;
3. `RECEIPT_DISPOSITION_EXCEEDS_LIMIT`;
4. `INVOICE_ALLOCATION_INVALID`;
5. `INVOICE_RECONCILIATION_STALE`.

El escaneo no corrige datos. Reconocer un caso conserva la deuda. Resolverlo
exige ejecutar nuevamente su detector y comprobar que el hallazgo desapareció;
la evidencia de esa verificación queda en un evento separado.

## Experiencia y permisos

- La pestaña Facturación de `/compras/[id]` mostrará cobertura por línea y un
  editor “Dividir línea”. El servidor recibirá IDs y porciones, nunca registros
  confiados desde el cliente.
- `/bodega` mostrará físico, demanda pendiente, entrada esperada y saldo
  proyectado por faena. El agrupado por producto mantendrá sólo el total físico.
- `/bodega/trazabilidad` añadirá la vista `integridad`; allí se moverán también
  los casos históricos existentes para evitar dos bloques de alerta.
- `warehouse:view_traceability` permite ver hallazgos de la faena autorizada.
  Los hallazgos de factura exigen además `purchasing:view`.
- Escanear, reconocer y verificar exige `warehouse:reconcile_integrity`.
- Modificar asignaciones o aceptar diferencias conserva
  `purchasing:send_order`; actualizar catálogo conserva `admin:products`.

La vista de integridad tendrá hasta cuatro métricas accionables y filtros de
dominio, severidad, estado y faena. Cada caso mostrará sólo un DTO redactado con
resumen, fecha, identidad concreta del producto cuando corresponda y CTA hacia
la OC, recepción, kardex o ajuste. El snapshot completo nunca se pasa a un
Client Component.

## Errores y concurrencia

- Toda edición N:N es atómica: una validación fallida revierte el reemplazo
  completo.
- Dos ediciones concurrentes usan fingerprint y locks; sólo la primera basada
  en la evidencia vigente puede confirmar.
- Los detectores toleran cero filas, pero un error de consulta produce un fallo
  explícito del escaneo; no se informa “sin hallazgos”.
- Un caso fuera del scope se responde como inexistente.
- La resolución genérica nunca crea ajustes ni modifica documentos; el CTA
  lleva al flujo existente y luego “Verificar corrección” reejecuta el detector.

## Rollout y compatibilidad

Aunque se publique como una entrega, el despliegue sigue cuatro gates:

1. expandir esquema;
2. backfill idempotente de vínculos 1:1;
3. verificar conteos, sumas y referencias;
4. activar lectores/escritores nuevos en la aplicación.

La migración se genera desde Drizzle y sólo agrega SQL idempotente al archivo
nuevo; no se modifica el journal ni una migración previa. Antes de rollback se
debe contar líneas con más de una asignación: la versión anterior las verá como
no vinculadas, nunca como un vínculo 1:1 inventado.

## Fuera de alcance

- reservas transaccionales o bloqueos basados en saldo proyectado;
- conversión UOM, valoración contable o reorden automático;
- distribución automática de IVA, flete u otros cargos de cabecera;
- corrección automática de stock, recepciones o facturas;
- `job_runs`, registry de importaciones, actividad enriquecida, i18n y
  onboarding del benchmark general;
- integración, sincronización o ejecución de Odoo/ERPNext.

## Criterios de aceptación

- El backfill reproduce todos los vínculos 1:1 sin cambiar cantidades ni
  subtotales.
- Un reparto `6 + 4` sobre una línea de `10` se concilia; `6 + 5`, cross-OC,
  UOM distinta y fingerprint vencido se rechazan sin escritura parcial.
- Facturas y NC conservan signos y neteo correctos.
- La proyección excluye terminales, servicios y entregas anuladas, respeta
  faena/variante y no bloquea ninguna operación.
- Los cinco detectores crean observaciones deduplicadas y sólo cierran un caso
  tras verificación negativa.
- No existe filtración entre faenas ni exposición de snapshots completos.
- Tests puros, PGlite, PostgreSQL real, typecheck, lint, medición de consultas
  y E2E quedan verdes. La auditoría completa se ejecuta cuando el repositorio
  vuelva a exponer su script; mientras tanto su ausencia se documenta como
  brecha de cobertura y nunca se presenta como éxito.
