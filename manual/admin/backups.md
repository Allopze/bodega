# Respaldos de base de datos

La pantalla de `Respaldos` (ubicada en `Administración > Respaldos`) permite administrar las copias de seguridad de la base de datos del sistema, garantizando la continuidad operativa y la capacidad de recuperación ante contingencias.

## Funcionalidades principales

- **Salud de respaldos**: Resumen del estado actual del sistema de copias de seguridad, fecha y hora del último respaldo y total de archivos almacenados.
- **Generación manual de respaldo**: Creación inmediata de una copia de seguridad en tiempo de ejecución.
- **Lista de respaldos**: Historial detallado con nombre de archivo, fecha de creación, tamaño e indicador de verificación integrity/checksum.
- **Configuración de automatización**: Ajuste de frecuencia de respaldos automáticos y días de retención.
- **Restauración y Descarga**: Capacidad de descargar archivos de respaldo o solicitar una restauración asistida.

## Cómo crear un respaldo manual

1. Abre el menú del usuario en la esquina superior derecha y selecciona `Administración`.
2. En el panel de Administración, entra a `Respaldos`.
3. Presiona el botón `Crear respaldo ahora`.
4. Ingresa un motivo o descripción breve de la copia de seguridad (por ejemplo: *"Antes del cierre mensual"*).
5. Confirma la acción. El sistema generará el archivo comprimido y lo registrará en la tabla.

## Cómo consultar el estado de salud

- **Tarjeta "Estado del Servicio"**: Muestra si los scripts automáticos de respaldo están activos y operando normalmente.
- **Tarjeta "Última Copia"**: Indica cuánto tiempo ha transcurrido desde la última copia exitosa. Si han pasado más de 24 horas sin respaldo en ambiente productivo, se mostrará una alerta de atención.

## Descarga y Restauración

- Para descargar una copia a tu equipo local, presiona el icono de descarga junto al archivo deseado.
- Para realizar una restauración de base de datos a partir de una copia existente, comunícate con el Administrador del Sistema. Las restauraciones requieren confirmación explícita para evitar sobreescritura accidental de datos operacionales.
