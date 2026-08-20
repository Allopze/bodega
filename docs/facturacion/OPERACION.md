# Operación

## Puesta en marcha

1. **Ejecutar el preflight y aplicar la migración**
   ```bash
   npm run db:preflight-dte-single-link
   npm run db:migrate          # vuelve a ejecutar el preflight antes de migrar
   npm run db:verify-migrations
   ```
   El preflight bloquea la creación del índice único si encuentra un DTE
   vinculado simultáneamente a OC y combustible o más de un DTE para la misma
   factura de OC.
2. **Si hay duplicados históricos, reparar explícitamente**
   ```bash
   npm run db:repair-dte-single-link
   npm run db:repair-dte-single-link -- --apply --mapping ./mapping-dte.json --actor usuario@chome.cl
   ```
   El primer comando sólo reporta. El segundo exige una decisión por cada fila,
   bloquea y valida que la selección no haya cambiado, desvincula sólo lo
   indicado y deja auditoría con actor, fecha, DTE conservado y DTE retirado.
   Nunca elige un ganador automáticamente. Repetir el preflight hasta obtener
   cero conflictos antes de migrar.
3. **Sincronizar permisos**
   ```bash
   npm run db:sync-rbac        # crea los 12 permisos billing:* y sus grants
   ```
4. **Registrar el maestro comercial** en `/facturacion/clientes`: al menos un
   cliente con su RUT y su plazo de pago. Sin clientes, las facturas se
   sincronizan igual pero no se pueden atribuir.
5. **Configurar la sincronización de ventas**: usa las mismas credenciales del
   portal DTE ya configuradas para Compras.
   ```
   BILLING_SALES_SYNC_ENABLED=true
   ```
6. **Primera corrida**: `/facturacion/sincronizacion` → *Simular* el mes anterior
   → revisar → *Sincronizar*.
   Para Chipax, separar disponibilidad de automatización:
   ```
   BILLING_CHIPAX_ENABLED=true
   BILLING_CHIPAX_SYNC_ENABLED=true   # 09:00 America/Santiago
   ```
   El cron de Chipax cubre ventas y cartolas del mes actual y del anterior:
   pedir cartolas sólo del mes en curso perdía los movimientos del último día
   del mes anterior. Conserva cursores durables y es sólo lectura.

   Ambos flags y las credenciales también se cargan sin desplegar desde la
   tarjeta de Chipax en `/facturacion/sincronizacion` → *Credenciales*. Lo
   guardado ahí gana sobre el `.env`. Ver [CHIPAX.md](CHIPAX.md).

## Uso diario

| Quiero… | Voy a |
|---|---|
| Ver cuánto se facturó y cuánto se cobró | `/facturacion` |
| Saber qué falta facturar | `/facturacion/pendientes` |
| Preparar un cobro | `/facturacion/propuestas` → *Nueva propuesta* |
| Aprobar un cobro preparado por otra persona | `/facturacion/propuestas` → *Aprobar* |
| Ver una factura y a qué contrato pertenece | `/facturacion/facturas` → detalle |
| Atribuir una factura a cliente/contrato/faena | Detalle → panel *Datos internos* |
| Llamar a un cliente y dejar registro | `/facturacion/cobranza` → *Registrar gestión* |
| Registrar que llegó un pago | `/facturacion/cobranza` → *Registrar pago* |
| Revisar coincidencias propuestas | `/facturacion/cobranza` → panel de sugerencias |
| Ver si la sincronización está sana | `/facturacion/sincronizacion` |

## Ciclo completo de un cobro

```
1. El período del contrato cierra
   → aparece en Pendientes de facturar

2. Alguien prepara la propuesta (create_proposal)
   → borrador → enviar a revisión

3. Otra persona la aprueba (approve_proposal)
   → aprobada → lista para facturar
   ⚠ Aprobar NO emite ningún documento tributario

4. Se emite la factura en el portal (manual, fuera de la plataforma)

5. La sincronización trae la factura
   → aparece en Facturas emitidas

6. Se relaciona la propuesta con la factura
   → la factura queda atribuida a cliente/contrato/faena/período
   → la propuesta pasa a "relacionada con factura"
   → si los montos difieren, la plataforma lo informa

7. Gestión de cobranza: llamadas, compromisos, disputas

8. Llega el pago
   → se registra a mano, o se confirma una sugerencia (confirm_payments)
   → recién ahí baja el saldo y sube el "cobrado"
```

## Preguntas que responde el módulo, y dónde

| Pregunta | Dónde |
|---|---|
| ¿Qué servicios están pendientes de facturar? | `/facturacion/pendientes` |
| ¿Qué facturas fueron emitidas? | `/facturacion/facturas` |
| ¿A qué cliente, contrato y faena pertenece cada factura? | Detalle → *Relación con la operación* |
| ¿Qué período cubre cada factura? | `service_period` del vínculo |
| ¿Qué facturas están pendientes de pago o vencidas? | `/facturacion/cobranza`, grupos *Vencidas* y *Pendientes* |
| ¿Cuáles se pagaron parcial o totalmente? | Estado de pago derivado de pagos confirmados |
| ¿Cuánto se facturó por cliente, contrato y faena? | `/facturacion` → rankings; filtros en el listado |
| ¿Cuánto se cobró realmente? | *Cobrado del período* — solo pagos confirmados |
| ¿Qué movimientos podrían corresponder a facturas? | Panel de sugerencias en cobranza |
| ¿Hay facturas sin relación con los registros internos? | Alerta en el resumen + `sinVinculo=1` |
| ¿Hay trabajos sin facturar? | `/facturacion/pendientes` (con el alcance declarado ahí) |
| ¿Difieren el monto preparado, emitido y cobrado? | Al relacionar propuesta↔factura se informa la diferencia; el detalle muestra total vs. cobrado |

## Limitación que hay que conocer

La plataforma **no registra servicios ejecutados uno por uno** (no hay módulo de
órdenes de trabajo). "Pendiente de facturar" se deriva de:

1. contratos con ciclo **mensual** vigentes, sin factura ni propuesta del período;
2. propuestas aprobadas sin factura relacionada.

Un servicio prestado fuera de un contrato mensual **no aparece solo**: alguien
tiene que crear la propuesta. La pantalla lo dice en su encabezado para que nadie
la lea como un inventario completo del trabajo realizado.

## Recuperación ante fallos

| Situación | Acción |
|---|---|
| Corrida colgada en `running` | Se marca `failed` sola tras 1 h, en la siguiente ejecución del mismo alcance. |
| Corrida `partial` de Chipax | Revisar el cursor durable y `error_summary`; la siguiente ejecución retoma sin volver silenciosamente a página 1. |
| Conciliación DTE `partial` o `failed` | Revisar `reconciliation_status`/`reconciliation_error`; no confundirlo con la ingesta y no declarar health operativo. |
| Facturas sin RUT resuelto | Reintentar la corrida: el XML suele estar disponible después. |
| Cartola rectificada | Mantener la imputación original; resolver la diferencia de monto/fecha de forma auditada, no sobrescribirla desde el cron. |
| XML demasiado grande | Se rechaza sobre 10 MiB tanto en descarga como en caché; revisar el documento en origen. |
| Pago confirmado por error | *Revertir* con motivo. El saldo vuelve y queda registrado quién revirtió. |
| Vínculo equivocado | *Descartar*. No se borra: queda `rejected` en el historial. |
| Propuesta aprobada por error | Anular y crear una nueva. Una aprobada no se edita: cambiarle los montos invalidaría la aprobación. |
| Cifras del resumen que no cuadran | Verificar que las facturas tengan vínculo **confirmado**: los rankings por cliente y faena solo cuentan lo atribuido. |
