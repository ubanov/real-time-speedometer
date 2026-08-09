# BOM y cableado exacto del primer prototipo

Este documento define que comprar y como cablear el primer prototipo del Moto Gateway.

Objetivo del prototipo:

- Leer testigos de la moto por optoacopladores.
- Leer velocidad y RPM por optoacopladores con salida Schmitt.
- Alimentar el ESP32 con bateria independiente.
- Controlar dos reles automocion mediante salidas optoaisladas.
- Exponer datos por WiFi a la web.

No es una instalacion final homologada. Antes de conectar a la moto hay que probar cada bloque en banco con fuente limitada.

## Compra recomendada

### Controlador

Comprar:

```text
Espressif ESP32-S3-DevKitC-1-N8
```

Importante:

- Elegir `N8`, sin `R8`.
- No comprar `N8R8` para este prototipo si quieres el pinout mas limpio.
- Las versiones con `R8` llevan PSRAM y pueden reservar GPIO35, GPIO36 y GPIO37.

Para una placa final:

```text
Espressif ESP32-S3-WROOM-1-N8
```

### Bateria y alimentacion del prototipo

Opcion recomendada para empezar:

```text
Adafruit PowerBoost 1000C - Product ID 2465
Adafruit LiPo 3.7 V 2500 mAh con JST-PH - Product ID 328
```

Conexion:

```text
LiPo -> PowerBoost BAT
PowerBoost 5V -> pin 5V/VIN del ESP32-S3-DevKitC-1-N8
PowerBoost GND -> GND del ESP32
```

Esta opcion es comoda para prototipo porque carga la bateria y entrega 5 V. Para una version final de bajo consumo conviene una placa propia con cargador y regulador de muy baja corriente en reposo.

### Optoacopladores de testigos

Comprar:

```text
PC817C o LTV-817C x 8
```

Usos:

- Intermitente izquierdo.
- Intermitente derecho.
- Punto muerto.
- Luz larga.
- Motor encendido.
- Llave/contacto.
- Reserva 1.
- Reserva 2.

### Optoacopladores de velocidad/RPM

Comprar:

```text
H11L1M x 2
```

Uso:

- Velocidad.
- RPM.

El H11L1M tiene salida con disparador Schmitt, mejor para pulsos que un PC817 normal.

### Reles

Comprar:

```text
CIT A21CSQ12VDC1.6R x 2
```

Es un rele automocion SPDT, bobina 12 V, contactos hasta 40 A en NO segun ficha.

Tambien comprar:

```text
Portareles/sockets automocion compatibles x 2
Fusibles mini blade e inline holders
```

### Driver de reles

Comprar:

```text
PC817C o LTV-817C x 2
MOSFET logico N canal AO3400A x 2
```

Si prefieres montar mas facil en protoboard soldada, puedes usar MOSFET N canal through-hole tipo IRLZ44N, aunque es mucho mas grande.

### Diodos, TVS y resistencias

Comprar:

```text
1N4148 x 20
1N4007 x 10
SMBJ24CA o SMBJ24A x 2
Resistencias 4.7k 0.25 W x 20
Resistencias 2.2k 0.25 W x 10
Resistencias 10k 0.25 W x 30
Resistencias 330 ohm 0.25 W x 10
Resistencias 100 ohm 0.25 W x 10
Resistencias 100k 0.25 W x 10
Condensadores 100 nF ceramicos x 20
```

### Varios

```text
Caja estanca IP65 o similar
Conectores automocion impermeables
Cable 0.5 mm2 para senales
Cable adecuado para cargas de luz/reles segun corriente real
Termorretractil
Portafusibles
Placa perforada o protoboard soldable
Separadores y fijacion antivibracion
```

## Pinout definitivo del prototipo

| Funcion | GPIO ESP32-S3 |
| --- | ---: |
| Velocidad | 4 |
| RPM | 5 |
| Intermitente izquierdo | 6 |
| Intermitente derecho | 7 |
| Punto muerto | 8 |
| Luz larga | 9 |
| Motor encendido | 10 |
| Llave/contacto | 11 |
| Boton wake | 12 |
| Boton accion | 13 |
| Rele luz | 16 |
| Rele arranque | 17 |
| ADC voltaje moto | 1 |
| ADC bateria ESP | 2 |

No usar en este prototipo:

- GPIO0: boot.
- GPIO3, GPIO45, GPIO46: strapping/arranque.
- GPIO19 y GPIO20: USB.
- GPIO35, GPIO36, GPIO37: evitar, especialmente en placas con PSRAM.
- GPIO43 y GPIO44: UART0.

## Cableado de testigos 12 V positivos

Usar para senales que entregan +12 V cuando estan activas.

Ejemplo: luz larga o intermitente positivo.

Lado moto:

```text
Cable senal moto +12 V
  -> resistencia 4.7k
  -> pin 1/anodo PC817C
pin 2/catodo PC817C
  -> masa moto

1N4148 en antiparalelo con el LED del opto:
  catodo 1N4148 -> pin 1/anodo PC817C
  anodo 1N4148 -> pin 2/catodo PC817C
```

Lado ESP32:

```text
3V3 ESP32 -> resistencia 10k -> GPIO
GPIO -> pin 4/colector PC817C
pin 3/emisor PC817C -> GND ESP32
```

Resultado:

- Senal moto activa: GPIO lee `LOW`.
- Senal moto inactiva: GPIO lee `HIGH`.
- Firmware: `INPUT_ACTIVE_LOW = true`.

## Cableado de testigos conmutados a masa

Usar para senales donde la moto activa el testigo poniendo el cable a masa.

Ejemplo frecuente: punto muerto.

Lado moto:

```text
+12 V despues de contacto, protegido con fusible pequeno
  -> resistencia 4.7k
  -> pin 1/anodo PC817C
pin 2/catodo PC817C
  -> cable de senal que la moto conmuta a masa
```

Lado ESP32 igual que en testigos positivos.

## Cableado de velocidad

Si la senal de velocidad es un pulso de 12 V ya acondicionado:

Lado moto:

```text
Cable pulso velocidad
  -> resistencia 2.2k
  -> pin 1/anodo H11L1M
pin 2/catodo H11L1M
  -> masa moto

1N4148 antiparalelo:
  catodo -> pin 1/anodo H11L1M
  anodo -> pin 2/catodo H11L1M
```

Lado ESP32:

```text
pin 6/VCC H11L1M -> 3V3 ESP32
pin 4/GND H11L1M -> GND ESP32
pin 5/OUT H11L1M -> GPIO4
GPIO4 -> resistencia 4.7k -> 3V3 ESP32
100 nF entre VCC y GND del H11L1M, cerca del chip
```

Si la lectura sale invertida, se corrige por software.

## Cableado de RPM

No conectar directamente a bobina de encendido.

Solo usar esta entrada si tienes una senal de tacometro/ECU ya acondicionada o una senal de 12 V razonable.

Cableado igual que velocidad, pero salida a GPIO5:

```text
pin 5/OUT H11L1M -> GPIO5
GPIO5 -> resistencia 4.7k -> 3V3 ESP32
```

Si la unica senal disponible viene de bobina/alta energia, hay que disenar un acondicionador especifico antes de conectarla.

## Cableado de botones de manillar

Estos botones pertenecen solo al ESP32, no a la instalacion de 12 V de la moto.

Boton wake:

```text
GPIO12 -> boton -> GND ESP32
GPIO12 -> resistencia 10k -> 3V3 ESP32
```

Boton accion:

```text
GPIO13 -> boton -> GND ESP32
GPIO13 -> resistencia 10k -> 3V3 ESP32
```

Firmware:

- Pulsado: `LOW`.
- Suelto: `HIGH`.

## Driver optoaislado de cada rele

Repetir este circuito para `RELAY_LIGHT` y `RELAY_STARTER`.

Lado ESP32:

```text
GPIO16 o GPIO17
  -> resistencia 330 ohm
  -> pin 1/anodo PC817C
pin 2/catodo PC817C
  -> GND ESP32
```

Lado moto/rele:

```text
+12 V moto con fusible
  -> bobina rele pin 86
bobina rele pin 85
  -> drenador MOSFET N
source MOSFET N
  -> masa moto

1N4007 flyback sobre bobina:
  catodo -> +12 V / pin 86
  anodo -> drenador MOSFET / pin 85

Gate MOSFET:
  gate -> resistencia 100k -> masa moto
  +12 V moto con fusible -> resistencia 10k -> pin 4/colector PC817C
  pin 3/emisor PC817C -> resistencia 100 ohm -> gate MOSFET
```

Funcionamiento:

- GPIO alto: opto encendido, gate sube, MOSFET conduce, rele se activa.
- GPIO bajo o ESP32 apagado: gate queda a masa por 100k, rele apagado.

## Contactos del rele de luz

No meter la corriente del faro por una placa pequena.

Usar el rele automocion para cortar/habilitar el circuito de luz o la senal de mando de luz segun el esquema real de la moto.

Conexion generica:

```text
Fusible luz / alimentacion luz -> COM rele
NO rele -> circuito luz
NC rele -> sin conectar
```

Elegir fusible y seccion de cable segun la corriente real del faro.

## Contactos del rele de arranque

No pasar la corriente del motor de arranque por este rele.

Debe actuar sobre el circuito de mando, como si fuese el pulsador o una habilitacion de baja corriente.

Conexion generica:

```text
Cable 1 del pulsador/circuito de mando arranque -> COM rele
Cable 2 del pulsador/circuito de mando arranque -> NO rele
NC rele -> sin conectar
```

Condiciones de seguridad:

- Timeout siempre.
- Probar primero con el circuito de arranque fisicamente desconectado.
- Confirmar con multimetro que el rele solo cierra el circuito esperado.

## ADC de voltaje moto

Para el primer prototipo, no conectar `GPIO1` al sistema de 12 V si se quiere mantener aislamiento completo.

Si se decide medir voltaje de moto compartiendo masa, usar:

```text
+12 V moto protegido -> 100k -> GPIO1 -> 27k -> GND moto/ESP32 comun
GPIO1 -> 100 nF -> GND
GPIO1 -> zener 3.3 V a GND como proteccion secundaria
```

Pero esta opcion rompe aislamiento porque exige masa comun. Mejor dejarlo desconectado al principio.

## ADC bateria ESP

Si se quiere medir la bateria LiPo antes del PowerBoost:

```text
BAT+ LiPo -> 100k -> GPIO2 -> 100k -> GND ESP32
GPIO2 -> 100 nF -> GND ESP32
```

Con divisor 100k/100k, el ADC ve la mitad de la tension de bateria.

## Orden de montaje

1. Montar solo ESP32 + PowerBoost + bateria.
2. Flashear firmware y comprobar `http://192.168.4.1/api/v1/health`.
3. Montar un PC817C de testigo en banco con fuente de 12 V limitada.
4. Repetir los 6 testigos.
5. Montar velocidad con generador de pulsos o Arduino.
6. Montar RPM con generador de pulsos, no con la moto todavia.
7. Montar driver de rele con una lampara pequena de prueba.
8. Conectar a la moto solo para leer.
9. Activar rele de luz.
10. Dejar arranque para la ultima fase.

