# Reserva de Aulas — CIFP Tony Gallardo

- Web: https://myappsserver.duckdns.org/reservadeaulas/
- Administración: https://myappsserver.duckdns.org/reservadeaulas/admin.html

## Cómo funciona
1. El profesorado escribe su nombre y su ciclo, elige el aula y pulsa las horas libres del calendario.
2. Puede elegir hasta 5 días con reservas a la vez (las pasadas no cuentan) y 3 horas por aula y día.
3. Cada reserva queda ligada al navegador que la hizo: solo ese equipo puede editarla o quitarla.
4. Emprendimiento requiere la aprobación de jefatura de estudios: la reserva queda «Pendiente de aprobación» hasta que se apruebe desde la administración.

## Ajustes
- **Contraseña de administración y secretos:** `api/secreto.php` (no se sube a git).
  Copia `api/secreto.ejemplo.php` y pon el hash. Para generarlo:
  `php -r 'echo password_hash("TU_CONTRASEÑA", PASSWORD_DEFAULT);'`
- **Aulas, franjas, límites, correo de contacto y ordenadores del carro:** `api/config.php`.

## Desplegar cambios
1. Crea `deploy/servidor.env` a partir de `deploy/servidor.ejemplo.env` (no se sube a git).
2. Desde Git Bash, en esta carpeta:

       bash deploy/desplegar.sh

El despliegue no toca la base de datos del servidor (`data/reservas.sqlite`).
