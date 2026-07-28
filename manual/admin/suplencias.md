# Suplencias temporales

La pantalla `Suplencias` (ubicada en `Administración > Suplencias`) se utiliza para delegar temporalmente la autoridad de aprobación y firmas de un usuario a otro (por ejemplo, durante vacaciones, licencias médicas o comisiones de servicio).

## Casos de uso típicos

- Un **Jefe de Mantención** sale de vacaciones y delega la aprobación de solicitudes y repuestos a un sustituto durante dos semanas.
- Una **Jefatura** se ausenta por licencia médica y requiere que otra jefatura firme sus autorizaciones operacionales.

## Cómo registrar una nueva suplencia

1. Entra a `Administración > Suplencias`.
2. Presiona el botón `Nueva suplencia`.
3. Selecciona el **Usuario titular** (quien se ausentará).
4. Selecciona el **Usuario suplente** (quien asumirá la delegación).
5. Define la **Fecha de inicio** y **Fecha de término** del periodo de suplencia.
6. Especifica el motivo de la suplencia (opcional pero recomendado).
7. Presiona `Registrar suplencia`.

## Cómo funciona durante el periodo activo

- El **usuario suplente** heredará temporalmente las atribuciones de aprobación de la cuenta titular mientras dure el rango de fechas programado.
- En los historiales y logs de auditoría, las firmas y aprobaciones realizadas por el suplente quedarán registradas indicando explícitamente: *"Aprobado por [Nombre Suplente] en suplencia de [Nombre Titular]"*.
- Al llegar la fecha y hora de término, la suplencia expira automáticamente sin requerir intervención manual.

## Finalización anticipada de suplencia

Si el titular regresa antes de tiempo:
1. Ve a `Administración > Suplencias`.
2. Ubica la suplencia activa en la lista.
3. Presiona el botón `Finalizar suplencia`.
4. El sistema revocaría de inmediato la delegación temporal.
