# Pruebas

## Cómo correrlas

```bash
npm test                                    # suite completa
npm run test:fast                           # sin las suites PGlite
npm run test:pglite                         # solo las de Postgres en memoria
npx vitest run lib/services/billing         # solo este módulo
npm run test:e2e                            # Playwright (requiere PGHOST=/var/run/postgresql)
```

Las suites que usan PGlite están declaradas en `tests/pglite-files.ts` y corren en
serie (cada una levanta su propia base y aplica las 137 migraciones).

## Qué cubre cada archivo

### Unitarias (sin base de datos)

| Archivo | Qué demuestra |
|---|---|
| `money.test.ts` | Aritmética exacta: `0.1 + 0.2 === 0.3`, sumas largas sin deriva, multiplicación por cantidad, IVA, comparación al centavo, tolerancias, montos negativos, techo de `numeric(14,2)`, y que **no se pueden sumar monedas distintas**. |
| `dte-xml.test.ts` | Lectura del XML DTE: identidad tributaria, **RUT del receptor** (que el listado no trae), **FchVenc**, exento, ítems, RUT extranjero, y descarte de documentos incompletos o con fecha en formato inesperado. |
| `invoice-rules.test.ts` | Hash de payload determinista y sensible solo a lo tributario; precedencia del vencimiento (manual > documento > contrato > cliente); aritmética de fechas; tramos de antigüedad sin solapes; estado de pago derivado, incluidos parcial, sobrepago y notas de crédito. |
| `providers.test.ts` | Coherencia capacidad↔método en **todos** los proveedores registrados; que ninguno declare escritura; que Chipax no declare capacidades ni se considere configurado; conversión de XML a documento normalizado. |
| `proposals.test.ts` | Máquina de estados completa; permiso exigido por transición; **quien prepara no aprueba**; motivo obligatorio para observar/rechazar; no marcar lista con documentos faltantes; totales con exentos; detección de períodos pendientes incluyendo cruce de año. |
| `reconciliation.test.ts` | Cuándo el motor propone y cuándo **no**; que no cruza monedas; tolerancias; confianza degradada por advertencias; pagos parciales y un movimiento repartido; folio en glosa sin falsos positivos; comparación laxa de nombres; clasificación de cobranza. |
| `duplicates.test.ts` | Clasificación de pares sospechosos: probable, posible y conflicto; que no cruza contrapartes, monedas ni direcciones; tolerancia de redondeo bancario; ventana de fechas. |

### Integración (Postgres real vía PGlite, con las migraciones aplicadas)

| Archivo | Qué demuestra |
|---|---|
| `sync-integration.test.ts` | Idempotencia real; actualización sin duplicar; duplicado dentro de una respuesta; documento sin RUT reportado como conflicto y **no insertado**; modo simulación que no escribe; cursor entre páginas; detección de total declarado ≠ entregado; proveedor sin configurar; piso histórico y período futuro; **corrida concurrente que se salta**; dos fuentes → una factura con dos referencias; **vencimiento manual y datos internos que sobreviven a la sincronización**; ítems que una fuente sin desglose no borra; venta y compra con el mismo folio como documentos distintos. |
| `queries-scope.test.ts` | Alcance por faena en listado, detalle y resumen; **un vínculo sugerido no otorga visibilidad**; anuladas excluidas de la facturación válida pero consultables; totales separados por moneda; filtros; paginación con tope; facturas sin relación operacional; indicadores del resumen; diferencias entre fuentes. |
| `payments-integration.test.ts` | Sugerencias que **no mueven el saldo**; idempotencia del motor; una sugerencia descartada que no reaparece; confirmación que mueve el saldo y reversión que lo devuelve; dos parciales que cierran la factura; la base rechazando un pago confirmado sin autor; un movimiento repartido entre dos facturas sin sobregirarse; vista de cobranza agrupada. |

### End-to-end (Playwright)

`e2e/facturacion.spec.ts`: navegación del módulo, control de permisos por rol y
estados vacíos útiles.

## Invariantes verificadas en la base

Además de las pruebas, la migración se aplicó sobre una base desechable y se
verificó con `psql` que la base **rechaza**:

- una segunda factura con la misma identidad tributaria;
- una moneda que no sea ISO 4217 de 3 letras;
- un proveedor fuera del vocabulario;
- un pago o vínculo `confirmed` sin autor y fecha;
- un vínculo que no apunte a nada;
- dos referencias del mismo proveedor a la misma factura.

## Datos de prueba

Todos los fixtures son **ficticios**. No se usan credenciales reales ni datos de
producción. El RUT `78023530-6` aparece como emisor porque es el de la empresa en
la documentación pública del portal ya existente en el repositorio; los clientes
(`76543210-K`, `76111111-1`) son inventados.
