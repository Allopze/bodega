# Conciliación de cuentas corrientes TAE

La pantalla `Conciliación TAE` (ubicada en `Combustibles > Conciliación TAE`) administra las cuentas corrientes de abastecimiento de combustible en estación/terreno (TAE - Tarjeta de Abastecimiento de Electrónico / Vale de combustible).

## Funcionalidades principales

- **Importación de cartolas**: Carga de archivos de transacciones emitidas por el proveedor de combustible (ej. Copec, Shell, Enex).
- **Conciliación de transacciones**: Cruce automático entre las cargas registradas en la bitácora interna versus la cartola oficial del proveedor.
- **Detección de diferencias**: Identificación de vales no registrados, montos o litros discrepantes y cargos no autorizados.

## Cómo realizar una conciliación TAE

1. Ve a `Combustibles > Conciliación TAE`.
2. Presiona `Importar cartola TAE`.
3. Selecciona el proveedor de combustible y adjunta la planilla enviada por el proveedor.
4. El sistema procesará las filas y mostrará un resumen de la conciliación:
   - **Conciliados**: Transacciones donde la patente, fecha, litros y monto coinciden exactamente con la bitácora.
   - **Pendientes de revisión**: Cargas con pequeñas discrepancias de horómetro o fecha.
   - **Solo en cartola**: Transacciones facturadas por el proveedor pero sin voucher en el sistema.
5. Aprueba la conciliación para cerrar el periodo.
