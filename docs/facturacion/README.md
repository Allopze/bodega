# Facturación y Cobranza

Módulo de **cuentas por cobrar** de Servicios Industriales Chome: qué corresponde
facturar, qué se facturó, qué se cobró y qué sigue pendiente.

## Qué hace

- Sincroniza las **facturas de venta** desde FacturaEnLínea y las guarda en un
  modelo interno normalizado, con soporte para varias fuentes externas por
  documento.
- Relaciona cada factura con **cliente, contrato, faena y período de servicio**.
- Detecta **pendientes de facturar** a partir de los contratos mensuales vigentes
  y de las propuestas aprobadas.
- Gestiona **propuestas de facturación**: preparación, revisión y aprobación
  interna, con separación entre quien prepara y quien aprueba.
- Lleva el **estado de cobro** derivado de pagos confirmados, con soporte para
  pagos parciales, y la **gestión de cobranza** (llamadas, compromisos, disputas).
- Importa **movimientos bancarios** desde Chipax y **sugiere** conciliaciones
  con evidencia y confianza; solo una persona autorizada las convierte en cobro.

## Qué NO hace

| No hace | Por qué |
|---|---|
| Emitir documentos tributarios (DTE) | La emisión sigue siendo manual en el portal. Aprobar una propuesta **no** emite nada. |
| Aceptar o rechazar documentos recibidos (Ley 19.983) | Tiene efecto tributario; requiere decisión y autorización expresas. |
| Contabilidad, libro de compras/ventas oficial, declaraciones | Eso vive en los sistemas contables. |
| Escribir en Chipax | La integración es de **solo lectura**. `POST /gastos`, `POST /notas-venta` y `POST /clientes` existen en su contrato y no se usan. |
| Reemplazar el módulo de Compras | Las facturas de proveedor siguen en `/compras`. Acá se separan por `direction`. |
| Confirmar un pago automáticamente | Una coincidencia de monto no es un pago. |

## Documentos

| Archivo | Contenido |
|---|---|
| [AUDITORIA_ESTADO_ACTUAL.md](AUDITORIA_ESTADO_ACTUAL.md) | Estado del proyecto antes de implementar: arquitectura, FacturaEnLínea, riesgos. |
| [ARQUITECTURA.md](ARQUITECTURA.md) | Capas, flujo de datos y decisiones de diseño. |
| [MODELO_DATOS.md](MODELO_DATOS.md) | Tablas, relaciones e invariantes. |
| [INTEGRACIONES.md](INTEGRACIONES.md) | Capa de proveedores y cómo agregar uno nuevo. |
| [FACTURAENLINEA.md](FACTURAENLINEA.md) | Cómo funciona la integración con el portal y su fragilidad. |
| [CHIPAX.md](CHIPAX.md) | Estado real de la integración y qué falta para activarla. |
| [SINCRONIZACION.md](SINCRONIZACION.md) | Operación de la sincronización, modo simulación y carga histórica. |
| [DEDUPLICACION.md](DEDUPLICACION.md) | Cómo se evita duplicar una factura entre fuentes. |
| [PERMISOS.md](PERMISOS.md) | Permisos, perfiles y alcance por faena. |
| [OPERACION.md](OPERACION.md) | Uso diario, resolución de problemas y recuperación. |
| [PRUEBAS.md](PRUEBAS.md) | Qué se prueba y cómo correrlo. |
| [ROLLBACK.md](ROLLBACK.md) | Cómo revertir la implementación. |

## Pantallas

| Ruta | Qué muestra | Permiso |
|---|---|---|
| `/facturacion` | Resumen: facturado, cobrado, pendiente, vencido, antigüedad, clientes y faenas | `billing:view` |
| `/facturacion/pendientes` | Períodos de contrato y propuestas sin factura | `billing:view` |
| `/facturacion/propuestas` | Preparación interna del cobro y su flujo de aprobación | `billing:view` |
| `/facturacion/facturas` | Facturas emitidas con filtros y totales por moneda | `billing:view` |
| `/facturacion/facturas/[id]` | Detalle, con datos externos e internos claramente separados | `billing:view` |
| `/facturacion/cobranza` | Facturas agrupadas por situación de cobro + sugerencias de pago | `billing:view` |
| `/facturacion/duplicados` | Pares de facturas que podrían ser el mismo documento | `billing:manage_invoices` |
| `/facturacion/clientes` | Maestro de clientes y contratos | `billing:manage_clients` |
| `/facturacion/sincronizacion` | Proveedores, capacidades reales e historial de corridas | `billing:manage_sync` |

## Principios que rigen el módulo

1. **Nada automático sobrescribe una decisión humana.** Un vencimiento fijado a
   mano o un vínculo confirmado sobreviven a cualquier sincronización posterior.
2. **Una sugerencia no es un hecho.** Vínculos y pagos propuestos por la
   plataforma nacen `suggested` y no afectan ninguna cifra hasta que se confirman.
3. **Nunca se suman monedas distintas.** Todo total agregado viene por moneda.
4. **Un dato faltante se muestra como faltante.** No se inventa un RUT para poder
   insertar un registro, ni se muestra `$0` cuando lo que hay es "sin datos".
5. **Los errores de sincronización se ven.** Una corrida parcial o fallida queda
   visible en el centro de sincronización, nunca degradada a "sin resultados".
