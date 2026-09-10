# ADR-002: La unidad documental ausente informa, no bloquea la conciliación

## Estado

Aceptada

## Fecha

2026-09-09

## Contexto

El conciliador OC-factura comparaba la unidad de medida de cada línea antes de comparar su precio. Si a alguno de los dos lados le faltaba la unidad, emitía el issue `missing_unit` y **abandonaba la línea** sin evaluar el precio. `missing_unit` contaba como issue duro, así que la orden quedaba en `needs_review`.

Dos hechos del dominio hacen que esa regla no midiera lo que decía medir:

- `UnmdItem` es un campo **opcional** del DTE. Que un emisor no lo declare es lo normal, no una anomalía.
- Del lado de la OC, `purchase_order_items.unit_of_measure` es `NOT NULL DEFAULT 'unidad'`. El valor puede no haberlo elegido nadie.

O sea que la comparación enfrentaba un campo que el SII no exige contra un default de base de datos, y detenía la orden cuando alguno de los dos faltaba. En la base de desarrollo eso tenía a **14 de 14** órdenes con factura en `needs_review`: un estado que aplica a todo no distingue nada.

El daño no era solo ruido. Al abandonar la línea, el precio **no se comparaba**, pero la tabla de la ficha calculaba su columna "Diferencia" por otra vía —`subtotal / cantidad`, sin mirar unidades— e imprimía `$0 (0.0%)` en gris tranquilo. La ficha afirmaba como verificado exactamente aquello que el motor se había negado a comparar. Y la única salida ofrecida era "Aceptar diferencias": firmar una excepción comercial, con motivo obligatorio, por un dato faltante que la firma no completa.

## Decisión

Separar los dos casos que la regla anterior confundía:

- **Unidades conocidas y distintas** (`unit_mismatch`) son evidencia contradictoria. Comparar $/caja contra $/unidad no informa nada: el precio no se evalúa, el issue sigue siendo duro y la celda "Diferencia" dice `No comparable` en vez de un cero que nadie calculó.
- **Unidad ausente** (`missing_unit`) es evidencia incompleta, no una discrepancia. Se deja constancia y **la comparación de precio sigue corriendo**. Apagarla dejaba sin control justamente a las líneas peor documentadas.

Para sostenerlo se introduce la noción de *issue blando* (`isSoftInvoiceReconciliationIssue`): describe una limitación de la evidencia, aparece en la ficha como nota informativa, y no cuenta para `hardIssues` ni para las advertencias que explican por qué una orden está detenida. Hoy `missing_unit` es el único.

`INVOICE_RECONCILIATION_VERSION` sube de 2 a 3. La versión prefija la huella, de modo que una aceptación firmada cuando el precio de esa línea no se evaluaba deja de cubrir una comparación que ahora sí corre.

## Alternativas consideradas

### Dejar que un operador declare la unidad en la línea de factura

Rechazada. Fabrica una afirmación documental que el documento no hace, y contradice el criterio ya escrito en `dte-parser.ts`: la ausencia de `UnmdItem` es información y no se reemplaza por una suposición. Poner esa suposición en un input no la convierte en evidencia, solo le pone encima el nombre de un operador.

### Asumir en silencio que las unidades coinciden

Rechazada. Es la misma comparación que ahora se hace, pero sin decirlo. La nota informativa existe para que quien lea la tabla sepa bajo qué supuesto se comparó.

### Dejar la regla y arreglar solo la tabla

Rechazada. Corrige la afirmación falsa pero conserva el bloqueo permanente y sin salida, que es el problema de fondo.

## Consecuencias

- Una orden cuyo único hallazgo sea la unidad ausente queda `matched`. En la base de desarrollo, 5 de 14 órdenes salen de `needs_review` (3 a `matched`, 2 a `partially_invoiced`); las 9 restantes se quedan por motivos reales —`unlinked_line`, `invoice_without_lines`, `unit_mismatch`—, que es lo que hace informativo al estado.
- Una variación de precio en una línea sin unidad declarada ahora **sí** se detecta. Antes pasaba sin control.
- El salto de huella deja históricas las aceptaciones vigentes. Las órdenes que pasan a `matched` no necesitan refirmarse —el estado no depende de la revisión—; solo vuelven a pedir firma las que conservan un issue duro, que es cuando corresponde.

## Operación

El estado se persiste en `purchase_orders.invoice_reconciliation_status` y alimenta el listado de OC y la bandeja de pendientes. La ficha de detalle calcula en vivo, pero las listas quedan con el valor viejo hasta recalcular:

```bash
npm run db:preflight-invoice-reconciliation   # diagnóstico, solo lectura
npm run db:backfill-invoice-reconciliation    # recalcula la proyección
```

`npm run db:prepare-rollback-invoice-reconciliation` es la vía de vuelta.
