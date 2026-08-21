/**
 * Puerta de recuperación de los toggles de módulo.
 *
 * Vive en su propio archivo porque la necesitan tanto el servicio (que importa
 * `@/db`) como la navegación, que se renderiza en el cliente: importar el
 * servicio desde un componente cliente arrastraría el driver de Postgres al
 * bundle.
 */
export const MODULE_TOGGLE_RECOVERY_PATH = "/admin/modulos"
