# Operación

## Puesta en marcha

1. **Aplicar la migración**
   ```bash
   npm run db:migrate          # aplica 0136_billing_module
   npm run db:verify-migrations
   ```
2. **Sincronizar permisos**
   ```bash
   npm run db:sync-rbac        # crea los 12 permisos billing:* y sus grants
   ```
3. **Registrar el maestro comercial** en `/facturacion/clientes`: al menos un
   cliente con su RUT y su plazo de pago. Sin clientes, las facturas se
   sincronizan igual pero no se pueden atribuir.
4. **Configurar la sincronización de ventas**: usa las mismas credenciales del
   portal DTE ya configuradas para Compras.
   ```
   BILLING_SALES_SYNC_ENABLED=true
   ```
5. **Primera corrida**: `/facturacion/sincronizacion` → *Simular* el mes anterior
   → revisar → *Sincronizar*.

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
| Facturas sin RUT resuelto | Reintentar la corrida: el XML suele estar disponible después. |
| Pago confirmado por error | *Revertir* con motivo. El saldo vuelve y queda registrado quién revirtió. |
| Vínculo equivocado | *Descartar*. No se borra: queda `rejected` en el historial. |
| Propuesta aprobada por error | Anular y crear una nueva. Una aprobada no se edita: cambiarle los montos invalidaría la aprobación. |
| Cifras del resumen que no cuadran | Verificar que las facturas tengan vínculo **confirmado**: los rankings por cliente y faena solo cuentan lo atribuido. |
