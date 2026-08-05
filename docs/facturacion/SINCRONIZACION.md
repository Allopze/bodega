# Sincronización

## Garantías

| Propiedad | Cómo se cumple |
|---|---|
| **Idempotente** | Identidad tributaria + `(provider, external_id)`. Dos corridas iguales dejan la base igual. Probado en `sync-integration.test.ts`. |
| **Segura ante concurrencia** | Índice único parcial: una sola corrida `running` por (proveedor, alcance, período). La segunda se salta, no compite. |
| **Reanudable** | El `cursor` de la última página queda en la corrida. |
| **Observable** | Cada corrida registra leídos/creados/actualizados/sin cambios, duplicados, conflictos, errores y un `correlation_id`. |
| **Acotada** | Siempre por período, con piso histórico (`BILLING_HISTORY_FLOOR`). Rechaza períodos futuros. |
| **Con modo simulación** | `dryRun` consulta y cuenta sin escribir nada. |
| **Independiente de la sesión web** | No lee la sesión; el actor se pasa como parámetro. Por eso el cron funciona igual. |
| **Tolerante a fallos parciales** | Un documento que falla no aborta la corrida: se cuenta y se reporta. |

## Formas de ejecutarla

### Automática (cron)
```
GET /api/cron/billing-sales-sync
Authorization: Bearer $CRON_SECRET
```
Sincroniza el **mes en curso**. Requiere `BILLING_SALES_SYNC_ENABLED=true`.
Endpoint separado del de compras (`/api/cron/dte-portal-sync`) a propósito: son
alcances distintos y un fallo de uno no debe apagar el otro.

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
| `partial` | Terminó, pero algo no se pudo procesar: revisar `error_summary`. Las causas típicas son documentos sin RUT resuelto o un total declarado distinto al recibido. |
| `failed` | La corrida no pudo completarse. |
| `skipped` | No se ejecutó: proveedor deshabilitado, sin configurar, o ya había una corrida activa del período. |

| Métrica | Qué mirar |
|---|---|
| `conflictsDetected` | Documentos que **no se insertaron** por falta de RUT de contraparte. Suele indicar que el XML no estuvo disponible. |
| `duplicatesDetected` | El proveedor entregó la misma fila dos veces en una respuesta. |
| `recordsUnchanged` | Normal en corridas repetidas: la fuente no cambió. |

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
