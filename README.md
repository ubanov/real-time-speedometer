# Speedometer

Aplicacion web tipo dashboard para usar en una moto desde el navegador del movil. Muestra velocidad GPS, distancia recorrida, hora, cobertura GPS, inclinacion lateral, aceleracion/frenada y controles basicos de Spotify.

Esta pensada para funcionar como una web estatica: no necesita instalacion de app nativa ni backend propio.

## Funciones

- Velocimetro digital y esfera visual inspirada en cuadros de coche.
- Lectura opcional de velocidad desde un ESP32 por WiFi.
- Distancia recorrida durante la sesion.
- Indicador de calidad de GPS.
- Inclinometro lateral con rango de `-60` a `60` grados.
- Indicador de aceleracion/frenada en `g`.
- Controles de Spotify: play/pausa, anterior, siguiente, portada, titulo, artista y progreso de la cancion.
- Iconos PWA/favicon generados desde `img/newicon.png`.

## Uso

Sirve los ficheros desde cualquier servidor web estatico y abre la URL desde el movil.

Ejemplos:

```bash
python -m http.server 8080
```

Despues abre:

```text
http://IP_DEL_SERVIDOR:8080/
```

En movil, el GPS y los sensores suelen requerir HTTPS o un origen considerado seguro. Si lo usas en local/red privada y el navegador bloquea permisos, publica la pagina en HTTPS o usala a traves de un dominio seguro.

## Configuracion de Spotify

La app usa Authorization Code + PKCE, asi que solo necesita el `Client ID` publico de Spotify. No uses nunca un `Client Secret` en esta app.

1. Crea una app en <https://developer.spotify.com/dashboard>.
2. En `Redirect URIs`, anade la URL exacta desde la que abras el velocimetro.
   Por ejemplo:

```text
https://velocimetro.tu-dominio.example/
```

3. Copia `secret.env.example` como `secret.env`.
4. Rellena tu Client ID:

```env
SPOTIFY_CLIENT_ID=tu_client_id_de_spotify
```

`secret.env` esta incluido en `.gitignore` para no subir tu configuracion personal a GitHub.

Importante: esto no da seguridad real si publicas la web. En una aplicacion estatica, cualquier fichero servido al navegador se puede ver o descargar. Esta separacion sirve para no subir tu configuracion personal al repositorio, no para ocultarla a usuarios de la pagina.

Si despliegas directamente desde GitHub, recuerda que `secret.env` no viajara con el repositorio. En ese caso Spotify quedara sin configurar salvo que copies `secret.env` manualmente al servidor donde publiques la web o uses un proceso de despliegue que lo genere alli.

## Publicacion recomendada

Para uso personal, una buena opcion es publicarla solo dentro de una red privada, por ejemplo mediante Tailscale. Asi puedes acceder desde tu movil sin exponer la pagina publicamente a internet.

Si la publicas en internet para que la use mas gente, revisa antes:

- Que `secret.env` no este subido al repositorio.
- Que el `Redirect URI` de Spotify coincida con la URL publica.
- Que la pagina se sirva por HTTPS.
- Que entiendes que el `Client ID` sera visible para cualquiera que use la web.

## ESP32 Moto Gateway

El repositorio incluye un subproyecto de firmware en:

```text
firmware/moto_gateway/moto_gateway.ino
```

El ESP32 crea un punto de acceso WiFi `MotoGateway` y expone una API HTTP:

- `GET /` o `GET /api/v1`: indice JSON de la API.
- `GET /api/v1/health`: comprobacion rapida de disponibilidad.
- `GET /api/v1/status`: velocidad, RPM, testigos, botones, reles y energia.
- `GET /api/v1/config`: configuracion activa de pulsos, rueda y timeouts.
- `POST /api/v1/command`: comandos controlados para luz y arranque.

Las rutas antiguas `/status`, `/config` y `/command` siguen disponibles como alias.

La web intenta detectar automaticamente:

```text
http://moto.local/api/v1/status
http://192.168.10.1/api/v1/status
```

Si el ESP32 responde, la velocidad y la distancia pasan a salir del gateway. Si no responde, la aplicacion sigue usando GPS como antes.

Nota: si sirves la web por HTTPS, algunos navegadores pueden bloquear peticiones HTTP al ESP32 por mixed content. Para uso privado puede tener sentido servir la web en HTTP dentro de Tailscale o hacer de puente desde tu servidor privado.

Si `secret.env` ya se habia anadido alguna vez al repo, quitale el seguimiento antes de subir:

```bash
git rm --cached secret.env
```

## Iconos

La imagen principal del icono esta en:

```text
img/newicon.png
```

El HTML usa esa imagen como favicon principal. Los demas tamanos de icono de `img/` se generan a partir de ella para compatibilidad con navegadores y PWA.

Si reinstalas la app en el movil y el icono no cambia, elimina la app de la pantalla de inicio y borra cache del navegador antes de volver a anadirla.

## Archivos principales

- `index.html`: estructura del dashboard.
- `style.css`: diseno visual y responsive.
- `main.js`: GPS, velocidad, distancia, inclinometro y acelerometro.
- `spotify.js`: autenticacion y controles de Spotify.
- `secret.env.example`: plantilla de configuracion.
- `secret.env`: configuracion local ignorada por Git.
- `manifest.json`: metadatos PWA.
- `sw.js`: service worker simple sin cache persistente.

## Notas

Los sensores del movil pueden variar segun navegador, sistema operativo y orientacion del dispositivo. Conviene probar la calibracion e inclinacion en el movil real antes de usarlo en marcha.
