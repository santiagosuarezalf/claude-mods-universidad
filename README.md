# claude-mods-universidad

Tres mods de [Claude Code](https://claude.com/claude-code) para llevar la universidad desde la terminal.
Están pensados para una carpeta de carrera organizada por semestre, materia y corte (abajo se explica la estructura).

## carrera

Un renglón en el pie, junto a la etiqueta del modo de permisos, que cambia cada 5 s entre:

- **📌 Próxima entrega:** `📌 Próxima entrega: proyecto final · cierra en 1d 4h`. El tiempo se pone
  amarillo cuando faltan menos de 48 h y rojo cuando faltan menos de 12. Toma los eventos **de día
  completo** de tu calendario de Google y salta los que empiezan por ✅ o ❌, así que marcar ✅ al
  entregar hace avanzar el contador.
- **🗓️ Semestre:** `🗓️ 2º semestre · CORTE II · semana 11 de 16 · faltan 35 días`.
- **🎓 Promedio** frente a tu meta, leído de `<SEMESTRE>/NOTAS.md`:
  `🎓 Promedio aprox. 8,69 · meta de beca 9,3 (faltan 0,61) · calculado con 7 de 7 materias`.
- **🎯 Cuánto falta para la meta:** `🎯 Para 9,3: necesitas 446 de los 460 puntos que quedan (97 %) ·
  máximo posible 9,50`. Cada materia vale 100 puntos (30 + 30 + 40); con créditos en todas, va ponderado.

El renglón tiene ancho fijo para no empujar lo que haya a la derecha del pie. Sobre el prompt, solo
cuando hace falta:

- una línea roja si el puntero de corte quedó desactualizado;
- **📬 ventanas de entrega:** si la descripción del evento trae la línea `🪟 Abre: AAAA-MM-DD`, avisa el
  día que abre (amarillo), desde la mitad de la ventana si sigue sin ✅ (naranja) y el día que cierra
  (rojo, con notificación). Muestra las 3 que cierran primero y cuenta el resto. El evento sigue siendo
  de un solo día: la ventana va en la descripción. Si no trae esa línea, la ventana arranca el día en que
  se creó el evento;
- **📖 parciales, sustentaciones y exámenes** de los próximos 7 días, en violeta. Con espacio (≥ 110
  columnas) van en una columna a la derecha y las entregas 📬 a la izquierda, en los mismos renglones;
- **el evento en curso de cualquier calendario**, al final de la columna derecha, con una barra del color
  de su calendario: `🏋️ Gym  ━━━━━──── 35m de 1h 30m · quedan 55m`. Si no hay nada en curso, el que sigue:
  `⏭️ Próximo: 🎓 Clase · 18:00 (en 2h 15m)`. Necesita un servidor MCP llamado
  `gcal-extended` con una herramienta `list_timed_events` que devuelva `{ events: [{ summary, calendar,
  color, start, end }] }`; sin él, simplemente no aparece;
- **✍️ el bloque de trabajo en curso** (los eventos con hora que empiezan por ✍️ avisan al arrancar y
  llevan una barra con el tiempo hecho, el total y cuánto queda).

El calendario se lee cada 10 minutos **solo mientras escribes**: tras `pausaMinutos` (30 por defecto) sin
mensajes se detiene, y el siguiente mensaje lo vuelve a leer. Así no quedan llamadas colgadas con el
equipo dormido.

**`/notas`** muestra la tabla de `NOTAS.md` por materia: lo que lleva, el máximo al que todavía puede
llegar (⚠️ si ya no alcanza la meta) y cuánto falta para la meta del promedio.

Necesita el conector de **Google Calendar** de claude.ai conectado en Claude Code.

| Opción | Por defecto | Qué es |
|---|---|---|
| `calendario` | `University` | Nombre del calendario con las entregas |
| `metaPromedio` | `9.3` | Promedio objetivo, en escala 0–10 |
| `utcOffset` | `-5` | Horas respecto a UTC de tu zona horaria |

## guardian-entregables

Cuando Claude va a crear un PDF, DOCX, PPTX o XLSX **nuevo** en `Entregables/`, lo frena si:

- quedaría suelto, fuera de `CORTE I/II/III`;
- no lleva tu código en el nombre (`Trabajo - <código>.ext`, o `Trabajo - <código>, ID2, ID3.ext` si es grupal);
- trae un código de 8 dígitos que no aparece en `<SEMESTRE>/companeros.md`.

Los borradores, el código, los archivos que empiezan por `Reparto` y las subcarpetas de proyecto pasan
sin revisión. Si el guardián falla por algún motivo, deja pasar el archivo en vez de bloquear.

| Opción | Por defecto | Qué es |
|---|---|---|
| `codigo` | *(vacío)* | Tu código de estudiante. Vacío: solo revisa la carpeta |

## copiables

Cuando Claude te entrega textos para pegar en otro lado (un correo, un foro, un mensaje), cada uno va en
un bloque de código con un título que empieza por 📋:

````
📋 **Versión 1 — corta**

```text
El texto que se pega.
```
````

Al terminar la respuesta aparece una franja encima del prompt con los textos numerados y el comienzo de
cada uno, y `/copiar N` copia el número N al portapapeles, sin la barra `│` ni los saltos de línea de la
terminal (con un solo texto basta `/copiar`). Una respuesta nueva sin textos 📋 quita la franja. `/copy`
sigue funcionando igual.

Para que Claude entregue los textos así, pídeselo una vez y que lo guarde en su memoria o en tu `CLAUDE.md`.

| Opción | Por defecto | Qué es |
|---|---|---|
| `color` | `yellow` | Color de la franja (nombre de color de terminal o un hex) |

## Instalar

En una sesión de Claude Code:

```
/plugin install carrera --marketplace santiagosuarezalf/claude-mods-universidad
/plugin install guardian-entregables --marketplace santiagosuarezalf/claude-mods-universidad
/plugin install copiables --marketplace santiagosuarezalf/claude-mods-universidad
```

Desde una terminal:

```
claude plugin install carrera --marketplace santiagosuarezalf/claude-mods-universidad
claude plugin install guardian-entregables --marketplace santiagosuarezalf/claude-mods-universidad
claude plugin install copiables --marketplace santiagosuarezalf/claude-mods-universidad
```

Responde `y` para agregar el marketplace y elige el alcance (usuario). Las opciones se cambian con
`/plugin configure <mod>`.

## Estructura que espera

```
<raíz de la carrera>/
├── CLAUDE.md            ← con  **SEMESTRE ACTIVO: `2nd SEMESTER`**  y  **CORTE ACTIVO: `CORTE II`**
└── 2nd SEMESTER/
    ├── CLAUDE.md        ← «16 semanas de clase» y la tabla de límites de corte:
    │                       | CORTE I | 28 jul – 5 sep |
    │                       | CORTE II | 7 sep – 24 oct |
    │                       | CORTE III | 26 oct – 21 nov |
    ├── NOTAS.md         ← | Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |
    ├── companeros.md    ← códigos de 8 dígitos; las filas tachadas (~~…~~) no cuentan
    └── 01_Materia/Entregables/CORTE II/…
```

En `NOTAS.md`, cada celda es un número (puntos sobre lo que vale el corte), `x/y` (lo obtenido sobre lo
evaluado hasta ahora) o vacía. Si a alguna materia le faltan créditos, el promedio sale sin ponderar y se
marca con `≈`.

## Desarrollo

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

MIT

> ¿Practicas inglés mientras trabajas? El mod de la English note vive aparte:
> [claude-mod-english-note](https://github.com/santiagosuarezalf/claude-mod-english-note).
