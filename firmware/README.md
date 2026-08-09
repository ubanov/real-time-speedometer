# Subproyecto ESP32 Moto Gateway

Este subproyecto define el hardware y firmware de un modulo ESP32 para leer senales de la moto y exponerlas por WiFi a la aplicacion web del velocimetro.

La idea principal es evitar una aplicacion nativa: el ESP32 publica una API sencilla y la web actual la consume si el dispositivo esta disponible. Si no esta disponible, la web puede seguir funcionando con GPS y sensores del telefono.

El diseno hardware/software detallado esta en:

```text
firmware/HARDWARE_SOFTWARE_DESIGN.md
```

## Objetivo

Crear un modulo independiente conectado a la moto que proporcione:

- Velocidad real de la moto.
- RPM del motor.
- Estado de leds/testigos.
- Estado de llave/contacto.
- Botones de manillar.
- Control de dos reles.
- Modo de bajo consumo cuando la moto esta apagada.

## Filosofia

- La app principal sigue siendo una web.
- El ESP32 no depende de una app iOS nativa.
- La comunicacion se hace por WiFi usando HTTP/WebSocket.
- El ESP32 debe poder funcionar con bateria propia para no descargar ni comprometer la bateria principal.
- El firmware debe fallar de forma conservadora: ante duda, no activar arranque ni luces automaticamente.

## Entradas previstas

### Pulsos

- `speed`: entrada de pulsos de velocidad.
- `rpm`: entrada de pulsos de RPM.

Estas entradas deberian ir protegidas y acondicionadas antes de llegar al ESP32. La moto puede generar ruido, picos y tensiones incompatibles con GPIO de 3.3 V.

### Testigos / leds

- `turnLeft` / `turnRight` o una entrada combinada de intermitentes.
- `neutral`: punto muerto.
- `highBeam`: luz larga.
- `engineOn`: motor encendido o testigo equivalente.
- `keyOn`: llave/contacto encendido.

Pendiente decidir si algunos testigos llegan como 12 V, masa conmutada, señal ya filtrada o si conviene usar optoacopladores.

### Botones de manillar

- `buttonWake`: despierta el ESP32 durante un tiempo aunque la moto este apagada.
- `buttonAction`: accion auxiliar configurable.

Uso inicial previsto:

- Boton 1: despertar el modulo y permitir durante un tiempo el arranque sin llave.
- Boton 2: reservado para accion futura o confirmacion.

## Salidas previstas

### Rele de luz

Controla la electricidad de la luz.

Comportamiento deseado:

- Mientras el motor no este arrancado, la luz permanece apagada.
- Cuando el motor arranca, la luz puede encenderse tras un pequeno retardo.
- Al apagar el motor, la luz se apaga tras un retardo configurable.

### Rele de arranque/contacto auxiliar

Permite habilitar el arranque sin llave durante una ventana limitada.

Comportamiento deseado:

- Por defecto apagado.
- Solo se activa si el ESP32 esta despierto y se pulsa el boton correspondiente.
- Debe tener timeout corto.
- Debe desactivarse automaticamente ante error, bajo voltaje o perdida de control.

## Energia y bajo consumo

El ESP32 tendra una bateria independiente.

Estados propuestos:

- `sleep`: moto apagada, ESP32 en bajo consumo.
- `wakeWindow`: ESP32 despierto temporalmente por boton de manillar.
- `standby`: llave/contacto detectado, modulo despierto esperando actividad.
- `running`: motor encendido, telemetria activa.

Reglas iniciales:

- Si `engineOn == false` y `keyOn == false`, entrar en bajo consumo tras un timeout.
- Si se pulsa `buttonWake`, despertar durante una ventana configurable.
- Si se detecta `keyOn` o `engineOn`, mantener el modulo despierto.
- Reducir WiFi o apagarlo en `sleep` si el consumo lo requiere.

## API implementada inicialmente

La API debe ser facil de consumir desde la web.

El firmware actual crea por defecto un punto de acceso WiFi:

```text
SSID: MotoGateway
PASS: moto12345
URL:  http://192.168.4.1/api/v1/status
```

Tambien intenta publicar mDNS en:

```text
http://moto.local/api/v1/status
```

Si se rellenan `WIFI_SSID` y `WIFI_PASS` en el `.ino`, el ESP32 mantiene el AP y ademas intenta conectarse a esa red como cliente.

### `GET /` o `GET /api/v1`

Devuelve un indice JSON de la API, version, endpoints disponibles e IPs actuales.

### `GET /api/v1/health`

Devuelve una comprobacion ligera para saber si el modulo esta vivo.

Ejemplo:

```json
{
  "ok": true,
  "device": "MotoGateway",
  "version": "0.2.0",
  "apiVersion": "v1",
  "uptimeMs": 123456
}
```

### `GET /api/v1/status`

Devuelve el ultimo estado conocido.

Ejemplo:

```json
{
  "online": true,
  "uptimeMs": 123456,
  "speedKmh": 67.4,
  "rpm": 2450,
  "leds": {
    "turnLeft": false,
    "turnRight": true,
    "neutral": false,
    "highBeam": false,
    "engineOn": true,
    "keyOn": true
  },
  "relays": {
    "light": true,
    "lightAuto": true,
    "starter": false
  },
  "power": {
    "batteryMv": 4100,
    "bikeVoltage": 12.8,
    "mode": "running"
  }
}
```

### `GET /api/v1/config`

Devuelve configuracion activa:

- Pulsos por vuelta/rueda.
- Diametro o circunferencia de rueda.
- Retardo de luz.
- Timeouts.
- Version de firmware.

### `POST /api/v1/command`

Ejecuta acciones controladas.

Ejemplos:

```json
{ "starterEnableMs": 5000 }
```

```json
{ "light": "auto" }
```

Por seguridad, los comandos que activen reles deben validar estado y tener timeout.

### `GET /events` o WebSocket `/ws`

Canal para actualizaciones frecuentes.

La web podria usar:

- WebSocket si esta disponible.
- Polling de `/api/v1/status` como fallback.

Este canal aun no esta implementado. La primera version usa polling HTTP contra `/api/v1/status`.

## Integracion con la web actual

La web intentara detectar el ESP32 al arrancar.

Posibles URLs:

- `http://moto.local/api/v1/status`
- `http://192.168.4.1/api/v1/status`
- URL configurable en localStorage.

Si el ESP32 responde:

- La velocidad de la moto puede sustituir al GPS.
- Los leds se muestran en el dashboard.
- La distancia puede calcularse desde la velocidad/pulsos del ESP32.

Si no responde:

- La web sigue usando GPS como ahora.

Nota importante: si la web se sirve por HTTPS, el navegador puede bloquear llamadas HTTP al ESP32 por mixed content. Hay que decidir una de estas estrategias:

- Servir la web desde el propio ESP32.
- Usar HTTP en red privada.
- Hacer que el servidor privado haga de puente.
- Configurar HTTPS tambien para el endpoint del ESP32, si fuese viable.

## Hardware pendiente de definir

- Modelo exacto de ESP32.
- Alimentacion y cargador de la bateria independiente.
- Proteccion de entradas de 12 V.
- Aislamiento con optoacopladores o divisores protegidos.
- Tipo de reles o MOSFET/rele solido.
- Fusibles.
- Caja y resistencia a vibraciones/agua.
- Conectores.

## Riesgos y seguridad

Este modulo interactua con electricidad de la moto y con funciones sensibles como luces y arranque.

Reglas de seguridad:

- Nunca conectar 12 V directamente a GPIO del ESP32.
- Proteger todas las entradas contra picos.
- Los reles deben tener estado seguro al arrancar o si el ESP32 se cuelga.
- El arranque sin llave debe tener timeout y condiciones estrictas.
- Probar primero en banco con fuente limitada antes de montar en la moto.
- Documentar claramente que pin controla cada funcion.

## Estado actual

Actualmente el firmware base ya se ha convertido a WiFi:

```text
firmware/moto_gateway/moto_gateway.ino
```

Incluye:

- Punto de acceso `MotoGateway`.
- Servidor HTTP en el puerto `80`.
- CORS abierto para que la web pueda consultar la API desde otro origen.
- `GET /api/v1`.
- `GET /api/v1/health`.
- `GET /api/v1/status`.
- `GET /api/v1/config`.
- `POST /api/v1/command`.
- Aliases antiguos `/status`, `/config` y `/command`.
- Calculo provisional de velocidad y RPM por pulsos.
- Estado de testigos, botones, reles y alimentacion.
- Control automatico provisional del rele de luz.
- Activacion temporizada del rele de arranque.

La web principal intenta consultar automaticamente:

- `http://moto.local/api/v1/status`
- `http://192.168.4.1/api/v1/status`

Si responde, usa la velocidad del ESP32 como fuente principal. Si no responde, sigue usando GPS.

Importante: los pines son provisionales. Las entradas de `GPIO34` y `GPIO35` no tienen pull-up interno en ESP32, asi que los botones necesitan pull-up/pull-down externo si se mantienen esos pines.

## Siguientes pasos

1. Validar que compila en el modelo exacto de ESP32.
2. Probar `/api/v1/status` desde el movil conectado al AP `MotoGateway`.
3. Simular pulsos de velocidad/RPM en banco.
4. Ajustar `SPEED_PULSES_PER_WHEEL_REV`, `WHEEL_CIRCUMFERENCE_M` y `RPM_PULSES_PER_REV`.
5. Definir el acondicionamiento electrico real de entradas de 12 V.
6. Implementar bajo consumo real/deep sleep.
7. Anadir visualizacion de leds en el dashboard.
