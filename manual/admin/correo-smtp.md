# Configuracion de correo

Esta pantalla controla el envio de correos de la plataforma. Aunque la ruta
historica se llama `correo-smtp`, el envio actual usa Resend y la variable
`RESEND_API_KEY`.

## Como usarla

1. Entra a `Administracion > Configuracion de correo`.
2. Revisa si los correos estan habilitados.
3. Verifica el estado de Resend.
4. Activa o desactiva el envio global segun corresponda.

Si no hay `RESEND_API_KEY`, la plataforma puede funcionar, pero no enviara
invitaciones ni correos de recuperacion.

## Tipos de correo enviados

- **Invitaciones**: usan la plantilla `invitation` (editable desde Plantillas de
correo). Se envian al crear usuarios, invitar o reenviar invitaciones.
- **Notificaciones**: usan la plantilla `notification`. Se envian automaticamente
al crear notificaciones en la plataforma (aprobaciones, rechazos, nuevas
solicitudes, etc.). Cada usuario puede desactivar los correos desde su perfil.
