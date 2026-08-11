# Hardware final instalable del Moto Gateway

Este documento define el hardware que merece la pena instalar una sola vez en la moto, aunque el firmware inicial use solo una parte.

Objetivo:

- Instalar un ESP32 con WiFi.
- Leer testigos del cuadro.
- Leer velocidad.
- Dejar preparados botones, bateria auxiliar y reles.
- Empezar con firmware solo lectura.
- Activar luz/arranque mas adelante solo cambiando software y terminando conexiones de mando.

## Decision principal

Para evitar desmontar y rehacer cableado, el hardware final debe incluir desde el principio:

```text
ESP32-S3
alimentacion desde moto
bateria auxiliar/cargador para mantener el ESP32 vivo con contacto apagado
entradas optoaisladas
entrada velocidad Schmitt-opto
2 botones de manillar
2 drivers de rele
2 reles automocion
conectores para luz/arranque, inicialmente sin uso o desconectados
```

El firmware inicial no activara arranque ni luz automatica. Los reles pueden quedar fisicamente instalados pero con los contactos sin conectar a funciones criticas hasta que se pruebe todo.

## Si hace falta bateria auxiliar

Si solo queremos lectura con la moto encendida, no hace falta bateria auxiliar.

Si queremos preparar el hardware para:

- despertar el ESP32 con la moto apagada,
- abrir WiFi un rato sin contacto,
- habilitar arranque sin llave en el futuro,
- no depender del consumo permanente de la bateria principal,

entonces si conviene bateria auxiliar.

La recomendacion es:

```text
+12 V despues de contacto -> fusible -> buck 12 V a 5 V -> cargador/boost LiPo -> ESP32
LiPo auxiliar -> cargador/boost -> ESP32
```

Asi:

- Con contacto encendido, la moto alimenta el sistema y carga la bateria auxiliar.
- Con contacto apagado, la bateria auxiliar mantiene vivo o despierta el ESP32.
- La bateria principal de la moto no alimenta el ESP32 en reposo.
- El firmware decidira deep sleep para que la bateria auxiliar dure.

## Compra exacta recomendada

### Controlador

```text
1x Espressif ESP32-S3-DevKitC-1-N8
```

No comprar `N8R8` para este pinout. En variantes con PSRAM pueden quedar reservados GPIO35/GPIO36/GPIO37.

### Alimentacion desde moto

```text
1x Pololu D36V28F5 5 V / 3.2 A, entrada hasta 50 V
1x portafusible mini blade o inline
fusible 0.5 A o 1 A para alimentacion electronica
1x TVS SMBJ24CA o SMBJ24A
1x condensador 100 nF
1x condensador electrolitico 47 uF a 220 uF, minimo 35 V
```

### Bateria auxiliar

Opcion sencilla:

```text
1x Adafruit PowerBoost 1000C
1x LiPo 3.7 V 2500 mAh JST-PH protegida
```

Conexion prevista:

```text
+12 V contacto -> fusible -> Pololu D36V28F5 -> 5 V
5 V Pololu -> entrada USB/5V del PowerBoost 1000C
LiPo -> BAT del PowerBoost
5 V salida PowerBoost -> pin 5V/VIN del ESP32-S3
GND PowerBoost -> GND ESP32
```

Nota: la bateria auxiliar alimenta solo electronica de control, no cargas de moto.

Si se quiere simplificar al maximo la primera prueba, se puede no montar PowerBoost/LiPo y alimentar el ESP32 directamente desde el Pololu. Pero si la caja ya se instala definitiva, dejaria sitio y conector para PowerBoost + LiPo.

### Entradas de testigos

```text
7x PC817C o LTV-817C
```

Uso:

- 5 entradas de moto: intermitente unico, aviso motor, neutro, luz larga, contacto.
- 2 salidas opto para drivers de rele.

Comprar 10 unidades es razonable por repuestos.

### Entrada de velocidad/RPM

```text
2x H11L1M
```

Uso:

- Velocidad actual.
- RPM futura/reserva.

### Reles y drivers

```text
2x rele automocion CIT A21CSQ12VDC1.6R o equivalente SPDT 12 V
2x portareles/sockets compatibles
2x MOSFET N logico AO3400A
```

Si se prefiere soldar mas facil:

```text
2x IRLZ44N en lugar de AO3400A
```

IRLZ44N es grande, pero comodo en prototipo/perforada.

### Diodos, resistencias y condensadores

```text
20x 1N4148
10x 1N4007
20x resistencias 4.7k
10x resistencias 2.2k
30x resistencias 10k
10x resistencias 330 ohm
10x resistencias 100 ohm
10x resistencias 100k
20x condensadores 100 nF
```

### Mecanica y cableado

```text
caja IP65 o similar
conectores impermeables multipin
cable fino 0.35-0.5 mm2 para senales
cable adecuado para reles/luz segun corriente real
termorretractil
bridas
soporte antivibracion
etiquetas para cables
```

## Pinout ESP32 definitivo

| Funcion | GPIO |
| --- | ---: |
| Velocidad | 4 |
| RPM futura/reserva | 5 |
| Intermitente unico | 6 |
| Aviso motor/check | 7 |
| Neutro | 8 |
| Luz larga | 9 |
| Reserva testigo | 10 |
| Contacto/llave | 11 |
| Boton wake | 12 |
| Boton accion | 13 |
| Rele luz | 16 |
| Rele arranque/habilitacion | 17 |
| ADC voltaje moto | 1 |
| ADC bateria auxiliar | 2 |

## Conectores propuestos

### J1 Alimentacion moto

```text
J1-1: +12 V despues de contacto
J1-2: GND moto
J1-3: +12 V bateria permanente, opcional solo para futuros reles/arranque
```

Para la primera fase usar solo:

```text
J1-1 y J1-2
```

### J2 Cuadro/testigos

```text
J2-1: intermitente unico
J2-2: aviso motor/check
J2-3: neutro
J2-4: luz larga
J2-5: contacto/llave
J2-6: masa cuadro, si se necesita para medir
```

Cada entrada pasa por su PC817 antes de llegar al ESP32.

### J3 Velocidad/RPM

```text
J3-1: senal velocidad
J3-2: masa/senal referencia velocidad si hace falta
J3-3: RPM futura
J3-4: masa/senal referencia RPM si hace falta
```

Velocidad y RPM pasan por H11L1M.

### J4 Botones

```text
J4-1: boton wake
J4-2: GND ESP32
J4-3: boton accion
J4-4: GND ESP32
```

### J5 Reles, preparado pero no activo al principio

```text
J5-1: contacto comun rele luz
J5-2: contacto NO rele luz
J5-3: contacto comun rele arranque
J5-4: contacto NO rele arranque
```

En la primera fase, dejar J5 sin conectar a la moto o conectado solo a una carga de prueba.

## Alimentacion exacta

### Con bateria auxiliar instalada

```text
+12 V despues de contacto
  -> fusible 0.5 A / 1 A
  -> TVS SMBJ24CA/SMBJ24A entre +12 y GND
  -> VIN+ Pololu D36V28F5

GND moto
  -> VIN- Pololu D36V28F5

VOUT+ Pololu 5 V
  -> entrada 5 V/USB del PowerBoost 1000C

VOUT- Pololu
  -> GND PowerBoost

LiPo 3.7 V
  -> conector BAT PowerBoost

5 V salida PowerBoost
  -> pin 5V/VIN ESP32

GND PowerBoost
  -> GND ESP32
```

### Sin bateria auxiliar

```text
+12 V despues de contacto
  -> fusible
  -> TVS
  -> Pololu D36V28F5
  -> 5V/VIN ESP32
```

Esta opcion es suficiente para lectura con la moto encendida, pero no permite wake con moto apagada sin tirar de la bateria principal.

## Entradas de testigos con PC817

Para cada LED del cuadro hay que medir si es positivo o conmutado a masa.

### Caso A: testigo entrega +12 V al encender

```text
Cable testigo +12 V activo
  -> resistencia 4.7k
  -> anodo PC817
catodo PC817
  -> GND moto

1N4148 antiparalelo:
  catodo -> anodo PC817
  anodo -> catodo PC817
```

Lado ESP32:

```text
3V3 ESP32 -> 10k -> GPIO
GPIO -> colector PC817
emisor PC817 -> GND ESP32
```

### Caso B: testigo se activa conectando a masa

```text
+12 V despues de contacto
  -> resistencia 4.7k
  -> anodo PC817
catodo PC817
  -> cable testigo conmutado a masa
```

Lado ESP32 igual.

## Velocidad con H11L1M

```text
senal velocidad
  -> resistencia 2.2k
  -> anodo H11L1M
catodo H11L1M
  -> masa/referencia de la senal de velocidad

1N4148 antiparalelo:
  catodo -> anodo H11L1M
  anodo -> catodo H11L1M

VCC H11L1M -> 3V3 ESP32
GND H11L1M -> GND ESP32
OUT H11L1M -> GPIO4
GPIO4 -> 4.7k -> 3V3 ESP32
100 nF entre VCC y GND del H11L1M
```

No conectar si no se sabe que tipo de senal es. Si es sensor inductivo o senal rara, hay que acondicionarla antes.

## Driver de rele preparado

Cada rele se controla asi:

```text
GPIO16 o GPIO17
  -> resistencia 330 ohm
  -> anodo PC817
catodo PC817
  -> GND ESP32
```

Lado rele:

```text
+12 V moto con fusible
  -> bobina rele pin 86
pin 85 bobina
  -> drenador MOSFET
source MOSFET
  -> GND moto

1N4007 flyback:
  catodo -> pin 86 / +12 V
  anodo -> pin 85 / drenador MOSFET

gate MOSFET
  -> 100k -> GND moto

+12 V moto con fusible
  -> 10k
  -> colector PC817
emisor PC817
  -> 100 ohm
  -> gate MOSFET
```

Fase inicial:

- Rele fisicamente montado.
- Bobina puede quedar sin alimentacion o firmware sin activar.
- Contactos J5 sin conectar a circuitos criticos.

## Arranque sin llave, preparado pero bloqueado

El hardware puede dejar un rele preparado, pero no se debe conectar al circuito de arranque hasta identificar exactamente los dos cables del pulsador o circuito de mando.

Reglas:

- El rele no alimenta el motor de arranque.
- Solo cierra un circuito de mando de baja corriente.
- Requiere timeout por firmware.
- Requiere condiciones: wake, contacto/estado seguro, bateria suficiente.
- Primera prueba con multimetro, no con el motor conectado.

## Fases recomendadas

### Fase 1: firmware y WiFi

- ESP32 alimentado por USB.
- Flashear firmware.
- Ver `http://192.168.10.1/api/v1/health`.

### Fase 2: alimentacion de moto

- Montar buck y fusible.
- Alimentar ESP32 desde +12 V despues de contacto.
- Sin conectar testigos todavia.

### Fase 3: testigos

- Conectar contacto/keyOn.
- Conectar luz larga.
- Conectar neutro.
- Conectar intermitente unico.
- Conectar aviso motor.

### Fase 4: velocidad

- Medir senal.
- Si es compatible, conectar H11L1M.
- Ajustar pulsos por vuelta en firmware.

### Fase 5: bateria auxiliar

- Montar PowerBoost + LiPo.
- Medir consumo en reposo.
- Implementar deep sleep.

### Fase 6: reles

- Probar rele de luz con carga de banco.
- Probar rele de arranque solo como continuidad de mando.
- Activar funciones por firmware cuando todo este medido.

