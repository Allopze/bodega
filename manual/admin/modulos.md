# Gestión de módulos (Feature Toggles)

La pantalla `Gestión de módulos` (ubicada en `Administración > Módulos`) permite activar o desactivar dinámicamente los distintos módulos operacionales de la plataforma en tiempo de ejecución.

## Para qué sirve

- **Activación progresiva**: Habilitar módulos a medida que la organización los adopte (por ejemplo, habilitar *Combustibles* o *Prevención SST*).
- **Personalización de la interfaz**: Ocultar del menú lateral y de la paleta ⌘K aquellas herramientas que no estén en uso en la organización, simplificando la experiencia de los usuarios.
- **Modo de mantenimiento por módulo**: Deshabilitar temporalmente un módulo específico mientras se realizan configuraciones o migraciones masivas.

## Cómo activar o desactivar un módulo

1. Ve a `Administración > Módulos`.
2. Revisa el listado de módulos registrados en el sistema (por ejemplo: Adquisiciones, Combustibles, Prevención, Flota, etc.).
3. Ubica el interruptor (toggle) junto al módulo que deseas modificar.
4. Cambia el estado a **Activo** o **Inactivo**.
5. Presiona `Guardar cambios` si la pantalla requiere confirmación explícita.

## Qué ocurre cuando se desactiva un módulo

- **Ocultamiento en la barra lateral**: Los ítems de navegación vinculados al módulo dejan de aparecer en el menú para todos los usuarios.
- **Búsqueda ⌘K**: Las páginas del módulo deshabilitado se remueven de los resultados de la paleta de comandos.
- **Protección de rutas**: Si un usuario intenta ingresar directamente por enlace URL a una ruta de un módulo inactivo, la plataforma mostrará un aviso informando que el módulo no está disponible.
- **Conservación de datos**: Desactivar un módulo **nunca borra datos** de la base de datos; únicamente deshabilita el acceso a la interfaz.
