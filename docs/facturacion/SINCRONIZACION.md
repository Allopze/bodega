# Sincronización

## Garantías

| Propiedad | Cómo se cumple |
|---|---|
| **Idempotente** | Identidad tributaria + `(provider, external_id)`. Dos corridas iguales dejan la base igual. Probado en `sync-integration.test.ts`. |
| **Segura ante concurrencia** | Índice único parcial: una sola corrida `running` por (proveedor, alcance, período). La segunda se salta, no compite. |
| **Reanudable** | FacturaEnLínea y Chipax guardan cursor durable por proveedor/alcance/período; avanza sólo después de confirmar el lote y se conserva si la corrida queda parcial o interrumpida. |
| **Observable** | Cada corrida registra leídos/creados/actualizados/sin cambios, duplicados, conflictos, errores y un `correlation_id`. |
| **Acotada** | Siempre por período, con piso histórico (`BILLING_HISTORY_FLOOR`). Rechaza períodos futuros y limita páginas/respuestas del proveedor. |
| **Con modo simulación** | `dryRun` consulta y cuenta sin escribir nada. |
| **Independiente de la sesión web** | No lee la sesión; el actor se pasa como parámetro. Por eso el cron funciona igual. |
| **Tolerante a fallos parciales** | Un documento que falla no aborta la corrida: se cuenta y se reporta. |

## Estado de los proveedores: comprobación bajo demanda

La pantalla **no llama a ningún servicio externo al renderizar**. Un
`healthCheck()` cuesta un scraping real del portal (timeout 120 s) o un login
real contra Chipax; ejecutarlo en cada carga significaba golpear ambos servicios
por cada visita, con la página colgada mientras tanto y con riesgo de throttle o
bloqueo de cuenta.

En su lugar:

- **«Probar conexión»**, en la tarjeta de cada proveedor, ejecuta la
  comprobación y **persiste** el resultado en `system_settings`
  (`billing.health.<proveedor>`): solo `ok`, un detalle ya redactado y la fecha.
  Nunca credenciales.
- La pantalla muestra ese último estado **rotulado con su fecha**. Un estado de
  hace una hora, dicho como tal, es más honesto y muchísimo más barato que uno
  fresco que nadie pidió.

### Los seis estados posibles

| Estado | Cuándo | Tono |
|---|---|---|
| **Inactivo** | Apagado por feature flag | neutro |
| **Sin configurar** | Habilitado pero sin credenciales | advertencia |
| **Sin comprobar** | Configurado, nadie probó la conexión todavía | neutro |
| **Operativo** | Última comprobación exitosa | éxito |
| **Comprobación vencida** | Última comprobación exitosa tiene más de 24 horas | advertencia |
| **Con problema** | Última comprobación fallida | peligro |

**«Sin configurar» no es «con problema».** Un proveedor que nunca se configuró
tiene una tarea pendiente, no una falla; pintarlo de rojo junto a una caída real
enseña a ignorar el rojo. Los seis estados se distinguen por **texto**, no solo
por color (verificado en `health.test.ts`).

La carga manual **no aparece** en esta grilla: no es una fuente que se
sincronice, sino la vía para tipear una factura o importar su XML. Se menciona
aparte para no hacerla pasar por un proveedor degradado.

## Formas de ejecutarla

### Automática (cron)
```
GET /api/cron/billing-sales-sync
Authorization: Bearer $CRON_SECRET
```
Sincroniza el **mes en curso y el anterior** bajo el mismo `correlation_id`.
Requiere `BILLING_SALES_SYNC_ENABLED=true`. El cron interno usa un runner Node
con timeout, redirects manuales y contrato JSON acotado; no imprime token ni
cuerpos de respuesta.
Endpoint separado del de compras (`/api/cron/dte-portal-sync`) a propósito: son
alcances distintos y un fallo de uno no debe apagar el otro.

Para Chipax el endpoint es:

```
GET /api/cron/chipax-sync
Authorization: Bearer $CRON_SECRET
```

Cuando `BILLING_CHIPAX_SYNC_ENABLED=true` ejecuta ventas del mes actual y
anterior más cartolas del mes actual a las 09:00 Chile, bajo una sola
correlación. `BILLING_CHIPAX_ENABLED=true` por sí solo no activa el scheduler.

### Manual
`/facturacion/sincronizacion` → elegir proveedor y período → **Simular** o
**Sincronizar**. Sincronizar un período distinto al mes en curso pide
confirmación explícita.

## Carga histórica

**No existe un botón de "importar todo".** El procedimiento es deliberadamente
manual y por etapas:

1. **Simular** el período más antiguo que interese. La corrida informa cuántos
   documentos llegarían, cuántos son duplicados y cuántos quedarían sin RUT
   resuelto — sin escribir nada.
2. Revisar el resultado: formatos de fecha, moneda, montos.
3. Sincronizar **ese mismo período** de verdad y comparar contra el portal.
4. Repetir mes a mes hacia adelante. Cada mes es una corrida independiente y
   reanudable.

El piso `BILLING_HISTORY_FLOOR` (default `2024-01`) evita que un error de tipeo
dispare una descarga de años.

## Interpretar el resultado

| Estado | Significa |
|---|---|
| `success` | Todo lo que llegó se procesó. |
| `partial` | Terminó, pero algo no se pudo procesar: revisar `error_summary`. Las causas típicas son documentos sin RUT resuelto, XML pendientes/reintentables o un total declarado distinto al recibido. |
| `failed` | La corrida no pudo completarse. |
| `skipped` | No se ejecutó: proveedor deshabilitado, sin configurar, o ya había una corrida activa del período. |

La ingesta DTE y su conciliación son estados distintos: `dte_sync_runs.status`
describe la lectura del portal; `reconciliation_status` puede ser
`not_run`, `success`, `partial` o `failed`. Una ingesta `success` con
conciliación `partial` conserva `status=success`, pero degrada health y debe
revisarse.

| Métrica | Qué mirar |
|---|---|
| `conflictsDetected` | Documentos que **no se insertaron** por falta de RUT de contraparte. Suele indicar que el XML no estuvo disponible. |
| `duplicatesDetected` | El proveedor entregó la misma fila dos veces en una respuesta. |
| `recordsUnchanged` | Normal en corridas repetidas: la fuente no cambió. |

En cartolas, `partial` también significa que el proveedor rectificó fecha o
monto de un movimiento ya imputado: se conserva la cartola original y el
mensaje operativo diferencia **sin RUT**, **conflicto de monto/fecha** y
**error técnico**. No se sobrescribe una imputación sin decisión humana.

Las respuestas Chipax se validan antes de persistir. Ante `429` se respeta
`Retry-After` una sola vez, acotado a 30 segundos; un segundo `429` queda como
`RATE_LIMITED`. Los XML de compras, enriquecimiento de ventas y caché local
tienen un límite de 10 MiB, también cuando se leen desde disco.

## Cuando algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `skipped` con "no está configurado" | Faltan credenciales del portal | Administración › Sincronización DTE |
| `skipped` con "ya hay una sincronización en curso" | Corrida previa abierta | Esperar; si lleva más de 1 h se marca `failed` sola en la siguiente ejecución |
| `partial` con muchos conflictos | El portal no entregó el XML | Reintentar más tarde; el documento se resuelve en la siguiente corrida |
| `partial` con "declaró N y entregó M" | El portal empezó a paginar | Revisar `parser.ts`: la suposición de "sin paginación" dejó de valer |
| `failed` con error de conexión | TLS o portal caído | Probar conexión desde la pantalla de sincronización |

Ninguno de estos casos se oculta: todos quedan visibles en el historial con su
`correlation_id` para cruzar con los logs del servidor.
