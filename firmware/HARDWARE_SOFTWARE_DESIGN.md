# Diseno hardware/software del Moto Gateway

Este documento define una primera arquitectura razonable para conectar un ESP32 a la moto y exponer datos por WiFi a la web del velocimetro.

No es todavia un esquema electrico cerrado para fabricar PCB. Es una especificacion de trabajo para decidir entradas, protecciones, pines, API y comportamiento seguro.

## Principios

- No conectar nunca 12 V directamente a un GPIO del ESP32.
- Tratar la instalacion de la moto como entorno ruidoso: alternador, reles, motor de arranque, masas largas y picos.
- Preferir entradas aisladas con optoacoplador para testigos, llave, velocidad y RPM.
- Usar zener/TVS como proteccion, no como unico metodo de adaptacion de 12 V a 3.3 V.
- Los reles deben fallar a estado seguro: apagados al arrancar, al reiniciar o si el firmware se queda colgado.
- El rele de arranque no debe alimentar el motor de arranque directamente; debe simular/habilitar la senal de mando de baja corriente.
- Todo lo que toque alimentacion de moto debe ir fusibleado y con conectores firmes.

## ESP32 elegido

### Recomendacion

Para este proyecto se recomienda:

```text
Prototipo: ESP32-S3-DevKitC-1-N8
Diseno final: ESP32-S3-WROOM-1-N8 en placa propia
```

Motivos:

- Tiene WiFi 2.4 GHz suficiente para la API local.
- Tiene bastantes GPIO para velocidad, RPM, testigos, botones, reles y ADC.
- Tiene soporte maduro en Arduino/ESP-IDF.
- Tiene USB nativo, comodo para flashear y depurar.
- Tiene modos de bajo consumo, pero el consumo real dependera mucho de la placa, regulador, LEDs y perifericos externos.
- Deja margen para migrar velocidad/RPM a PCNT con filtro de glitch.
- Evita la reserva de GPIO35/GPIO36/GPIO37 que aparece en variantes con PSRAM Octal como las `R8`.

No se recomienda usar una placa de desarrollo completa como hardware final si el objetivo es bateria de larga duracion. Muchas devboards llevan LED de power, conversor USB-serie y reguladores con consumo en reposo que arruinan el deep sleep.

### Por que no ESP32-C3 como primera opcion

El ESP32-C3 es interesante para bajo consumo y proyectos pequenos, pero aqui vamos justos de pines. Entre velocidad, RPM, 6 testigos, 2 botones, 2 reles y 2 ADC ya estamos alrededor de 14 senales, sin contar margen para debug, I2C, SPI, wake dedicado o cambios de cableado.

### Por que no ESP32-C6 como primera opcion

El ESP32-C6 es moderno y tiene WiFi 6, pero para esta aplicacion WiFi 6 no aporta demasiado. Prefiero S3 por disponibilidad, ejemplos, placas, margen de GPIO y ecosistema mas asentado para prototipar.

### Implicacion para bateria

Para bateria, lo importante no es solo el chip:

- Elegir regulador de muy baja corriente en reposo.
- Evitar LEDs permanentes.
- Poder apagar sensores/optoacopladores externos cuando se entra en reposo.
- Despertar por boton/contacto usando un pin apto para wake.
- Usar deep sleep real cuando la moto esta apagada.
- Medir consumo con multimetro, no fiarse solo del datasheet.

## Fuentes electricas

### Alimentacion principal del ESP32

Para la v1 de solo lectura no hace falta bateria independiente. Se alimenta el ESP32 desde +12 V despues de contacto con un convertidor DC/DC 12 V a 5 V.

Bloques recomendados para v1:

```text
+12 V despues de contacto -> fusible -> TVS/proteccion -> buck 12 V a 5 V -> ESP32
```

Si mas adelante se quiere que el ESP32 funcione con la moto apagada para arranque sin llave o wake remoto, entonces si tendria sentido bateria independiente:

```text
Bateria ESP32 -> BMS/cargador -> regulador 3.3 V/5 V estable -> ESP32
```

Pendiente definir:

- Tipo de bateria independiente.
- Si se carga desde USB, desde la moto o manualmente.
- Consumo real en WiFi y en deep sleep.
- Wake fisico desde boton.

### Masa

Con optoacopladores, las entradas pueden mantenerse aisladas entre lado moto y lado ESP32.

Si algun sensor obliga a compartir masa, debe hacerse en un unico punto controlado y con proteccion. Evitar que el ESP32 se convierta en camino de retorno de corriente de la moto.

## Entradas digitales de testigos

Entradas previstas:

- Intermitente unico del cuadro.
- Punto muerto.
- Luz larga.
- Aviso motor/check engine.
- Llave/contacto.

### Conexion recomendada para senal positiva de 12 V

Usar cuando el cable del testigo entrega +12 V al activarse, por ejemplo luz larga o intermitente positivo.

```text
Cable senal moto +12 V
  -> resistencia serie 6.8k a 15k
  -> LED optoacoplador
  -> masa moto

En paralelo inverso con el LED del opto:
  -> diodo 1N4148 o 1N4007 para proteger contra tension inversa

Lado ESP32:
  3.3 V -> pull-up 10k -> GPIO
  GPIO -> colector opto
  emisor opto -> GND ESP32
```

Lectura logica:

- Opto encendido: GPIO baja.
- Opto apagado: GPIO alta.
- En firmware: `INPUT_ACTIVE_LOW = true`.

### Conexion recomendada para senal conmutada a masa

Usar cuando el testigo se activa porque la moto pone el cable a masa. Esto es frecuente en punto muerto y algunos testigos.

```text
+12 V protegido de contacto
  -> resistencia serie 6.8k a 15k
  -> LED optoacoplador
  -> cable senal conmutado a masa por la moto
```

Lado ESP32 igual que el caso anterior.

### Por que no solo divisor + zener

Un divisor resistivo con zener de 3.3 V puede funcionar en banco, pero en una moto tiene varios problemas:

- Si llega un pico, el zener puede conducir mucha corriente si no esta todo bien dimensionado.
- No aisla masas.
- El GPIO sigue expuesto a ruido y fallos de cableado.
- Un mal contacto o transitorio puede superar el maximo admisible del ESP32.

Si se quiere hacer una entrada no aislada por simplicidad, el minimo prudente seria:

```text
senal 12 V -> resistencia alta -> divisor -> resistencia serie a GPIO
GPIO -> clamp/TVS pequeno a 3.3 V/GND
filtro RC suave
masa comun bien definida
```

Aun asi, para la moto se recomienda opto.

## Velocidad y RPM

### Velocidad

La entrada de velocidad normalmente sera una senal de pulsos. Sin saber aun el sensor exacto de la Honda, tratarla como entrada ruidosa.

Opcion inicial:

```text
senal velocidad -> proteccion/resistencia -> optoacoplador rapido o Schmitt opto -> GPIO PCNT
```

Para velocidades normales, un opto tipo PC817 puede valer si los pulsos son lentos y limpios, pero para diseno mas robusto conviene un opto con salida Schmitt o acondicionar despues con un Schmitt trigger.

### RPM

La senal de RPM puede ser mucho mas agresiva si sale de bobina/encendido. No conectar nunca una senal de bobina directa al ESP32 ni a un divisor simple.

Opciones razonables:

- Tomar RPM de una salida de tacometro ya acondicionada si existe.
- Usar optoacoplador rapido con resistencia alta y proteccion TVS.
- Usar un modulo/acondicionador de tacometro automocion.

Software recomendado:

- Usar el periferico PCNT del ESP32 para contar pulsos y aplicar filtro de glitch.
- Mantener ISR solo como primera version si compila y funciona.
- Exponer `speedKmh`, `rpm` y contadores acumulados por API.

## Botones de manillar

Entradas previstas:

- `buttonWake`: despierta el modulo durante una ventana.
- `buttonAction`: accion auxiliar futura.

Si los botones solo pertenecen al ESP32 y no comparten electricidad con la moto:

```text
GPIO -> boton -> GND ESP32
GPIO -> pull-up 10k a 3.3 V
```

Notas:

- En este prototipo los botones van a GPIO12 y GPIO13.
- Se usan pull-ups externos de 10k para que el estado de reposo sea estable incluso durante arranque/deep sleep.
- Anadir filtro por software de 20-50 ms.

## Salidas de rele

Salidas previstas:

- Rele luz.
- Rele arranque/habilitacion.

El ESP32 no debe alimentar una bobina de rele directamente.

Conexion recomendada:

```text
GPIO ESP32 -> resistencia 100-330 ohm -> gate/base driver
driver MOSFET/transistor -> bobina rele
bobina rele -> alimentacion adecuada
diodo flyback en bobina si es rele DC
```

Tambien se puede usar modulo de rele optoaislado, pero hay que verificar:

- Que dispara con 3.3 V reales.
- Que los contactos soportan corriente y tension de la moto.
- Que el estado por defecto al arrancar es apagado.
- Que no activa el rele durante el boot del ESP32.

### Rele de luz

Preferible controlar una senal de mando o rele auxiliar, no meter toda la corriente del faro por un rele pequeno de placa.

Comportamiento:

- Apagado al boot.
- Si `engineOn` o `rpm > umbral`, encender tras retardo.
- Si motor apagado, apagar tras retardo.
- API permite `light: true`, `light: false`, `light: "auto"`.

### Rele de arranque

Debe ser el circuito mas conservador.

Reglas:

- Nunca alimentar el motor de arranque directamente.
- Solo simular/habilitar el pulsador o circuito de baja corriente.
- Timeout corto siempre.
- Requiere ventana de wake/contacto/condicion explicita.
- Apagado ante reinicio, bajo voltaje o perdida de estado.

## Proteccion recomendada por modulo

### Entrada de 12 V/testigo

- Resistencia serie para limitar corriente del LED del opto.
- Diodo inverso en paralelo al LED del opto.
- Filtro RC opcional si la senal rebota o mete ruido.
- TVS si el cable es largo o expuesto.

### Alimentacion desde moto

- Fusible cercano a toma de +12 V.
- Proteccion contra polaridad inversa.
- TVS automocion en entrada.
- Buck DC/DC apto para automocion.
- Condensadores y filtrado cerca del buck y del ESP32.

### Rele/cargas inductivas

- Diodo flyback en bobina DC.
- Separar pistas/cables de potencia de senales.
- Fusible acorde a la carga.
- Cableado mecanicamente asegurado.

## Pinout provisional

El firmware actual usa:

| Funcion | GPIO |
| --- | ---: |
| Velocidad | 4 |
| RPM futura / reserva | 5 |
| Intermitente unico | 6 |
| Aviso motor / check engine | 7 |
| Punto muerto | 8 |
| Luz larga | 9 |
| Reserva testigo | 10 |
| Llave/contacto | 11 |
| Boton wake | 12 |
| Boton accion | 13 |
| Rele luz | 16 |
| Rele arranque | 17 |
| Voltaje moto ADC | 1 |
| Bateria ESP ADC | 2 |

Pendiente revisar con la placa ESP32 exacta y evitar pines problematicos de arranque.

## API software

Endpoints actuales:

- `GET /` o `GET /api/v1`: indice de la API.
- `GET /api/v1/health`: salud basica.
- `GET /api/v1/status`: estado completo.
- `GET /api/v1/config`: configuracion.
- `POST /api/v1/command`: comandos.

Aliases antiguos:

- `GET /status`.
- `GET /config`.
- `POST /command`.

### Estado esperado

```json
{
  "online": true,
  "device": "MotoGateway",
  "version": "0.2.0",
  "uptimeMs": 123456,
  "speedKmh": 67.4,
  "rpm": 2450,
  "totalSpeedPulses": 1234,
  "leds": {
    "turnLeft": false,
    "turnRight": false,
    "neutral": false,
    "highBeam": false,
    "engineOn": true,
    "keyOn": true
  },
  "buttons": {
    "wake": false,
    "action": false
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

## Software pendiente

- Migrar velocidad/RPM a PCNT con filtro de glitch.
- Debounce/filtro por entrada segun tipo de senal.
- Configuracion persistente en NVS.
- Endpoint para cambiar configuracion sin recompilar.
- Deep sleep real cuando `keyOn == false`, `engineOn == false` y no hay ventana wake.
- Endpoint de eventos o WebSocket si el polling se queda corto.
- Mostrar testigos de la moto en la web.

## Prototipo recomendado por fases

1. Banco sin moto:
   - ESP32 por USB.
   - Simular testigos con 12 V de fuente limitada y optos.
   - Simular velocidad/RPM con generador de pulsos o Arduino.

2. Moto sin controlar nada:
   - Solo leer testigos.
   - Rele fisicamente desconectado.
   - Verificar que `/api/v1/status` refleja la moto.

3. Velocidad/RPM:
   - Conectar una sola entrada cada vez.
   - Comparar contra GPS/cuadro.
   - Ajustar pulsos por vuelta.

4. Rele de luz:
   - Probar primero en banco con carga pequena.
   - Luego con rele auxiliar/fusible.

5. Arranque:
   - Ultima fase.
   - Solo cuando todo lo demas este probado.
   - Timeout y condiciones de seguridad verificadas.
