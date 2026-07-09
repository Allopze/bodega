# Notificaciones

La pantalla **Notificaciones** permite auditar y limpiar notificaciones internas
del sistema.

## Como usarla

1. Entra a `Administracion > Notificaciones`.
2. Revisa el estado general.
3. Usa las acciones de diagnostico o limpieza si tu rol lo permite.

Esta pantalla no reemplaza el correo: sirve para revisar notificaciones dentro
de la plataforma.

## Correo electronico

Cuando se crea una notificacion en la plataforma, el sistema automaticamente
envia un correo electronico al usuario destinatario usando la plantilla
`notification`. Esto ocurre para todos los tipos de notificacion:
aprobaciones, rechazos, devoluciones, nuevas solicitudes, etc.

Cada usuario puede desactivar el envio de correos desde su perfil
(checkbox "Notificaciones por correo"). El campo `email_notifications` en
la tabla `users` controla este comportamiento.

El envio de correos tambien depende de:
- Que el envio global este habilitado (Administracion > Configuracion de correo).
- Que exista una `RESEND_API_KEY` configurada en el entorno.
