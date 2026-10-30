import { describe, expect, test } from 'claude-code/testing'

import { beca, clasificar, enCurso, escalones, fraccionPara, fraseEscalones, iconoCalendario, leerAgenda, contexto, cuantoFalta, evaluaciones, fechaCorta, fraseMeta, restante, tablaNotas, techo, ventanas } from './logica'

const AHORA = Date.parse('2026-10-18T15:00:00-05:00') // un domingo a las 3 p. m., UTC−5

describe('clasificar', () => {
  test('saca entregas, bloques y semana; ignora lo marcado e informativo', async () => {
    const c = clasificar([
      { summary: 'Semana 12', start: { date: '2026-10-19T00:00:00Z' }, end: { date: '2026-10-26T00:00:00Z' }, transparency: 'transparent' },
      { summary: 'Semana 11', start: { date: '2026-10-12T00:00:00Z' }, end: { date: '2026-10-19T00:00:00Z' }, transparency: 'transparent' },
      { summary: 'Entrega proyecto final', start: { date: '2026-10-19T00:00:00Z' }, end: { date: '2026-10-20T00:00:00Z' } },
      { summary: '✅ Taller entregado', start: { date: '2026-10-19T00:00:00Z' }, end: { date: '2026-10-20T00:00:00Z' } },
      { summary: '✍️ Hacer: proyecto', start: { dateTime: '2026-10-18T13:00:00-05:00' }, end: { dateTime: '2026-10-18T18:00:00-05:00' } },
      { summary: 'Clase de la materia', start: { dateTime: '2026-10-20T18:00:00-05:00' }, end: { dateTime: '2026-10-20T20:00:00-05:00' } },
    ], AHORA)
    expect(c.semana).toBe(11)
    expect(c.entregas.map(x => x.titulo)).toEqual(['Entrega proyecto final'])
    expect(c.entregas[0]?.cierra).toBe(Date.parse('2026-10-19T23:59:59-05:00'))
    expect(c.bloques.map(x => x.titulo)).toEqual(['proyecto'])
  })
})

test('restante', async () => {
  expect(restante(45 * 60000)).toBe('45m')
  expect(restante(28 * 3600_000)).toBe('1d 4h')
})

test('contexto avisa cuando el puntero quedó atrás', async () => {
  const md = '16 semanas de clase\n| CORTE I | 28 jul – 5 sep |\n| CORTE II | 7 sep – 24 oct |\n| CORTE III | 26 oct – 21 nov |\n'
  const c = contexto('2nd SEMESTER', 'CORTE II', md, Date.parse('2026-10-26T09:00:00-05:00'))
  expect(c.esperado).toBe('CORTE III')
  expect(c.semanas).toBe(16)
  expect(c.finClases).toBe(Date.parse('2026-11-21T23:59:59-05:00'))
})

test('beca promedia lo que hay y marca ≈ si faltan créditos', async () => {
  const md = [
    '| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |',
    '|---|---|---|---|---|',
    '| Materia A | | | 27 | |',
    '| Materia B | | 9,7/10 | | |',
    '| Materia C | | | | |',
  ].join('\n')
  const b = beca(md)
  expect(b?.materias).toBe(2)
  expect(b?.total).toBe(3)
  expect(b?.aproximado).toBe(true)
  expect(Math.round((b?.promedio ?? 0) * 100)).toBe(935)
})

describe('ventanas', () => {
  const dia = (f: string) => Date.parse(`${f}T00:00:00-05:00`)
  const cierre = (f: string) => Date.parse(`${f}T23:59:59-05:00`)
  // Quiz que abre el lunes 9 y cierra el lunes 16 de noviembre
  const quiz = { titulo: 'Quiz U3', abre: dia('2026-11-09'), cierra: cierre('2026-11-16') }
  const en = (f: string, hora = '10:00') => Date.parse(`${f}T${hora}:00-05:00`)

  test('lee la línea «🪟 Abre:» de la descripción del evento', async () => {
    const c = clasificar([
      { summary: 'Quiz U3', description: 'Quiz (7 pts)\n🪟 Abre: 2026-11-09\nAVA', start: { date: '2026-11-16' }, end: { date: '2026-11-17' } },
      { summary: 'Taller sin ventana', start: { date: '2026-11-16' }, end: { date: '2026-11-17' } },
    ], en('2026-11-10'))
    expect(c.entregas.find(x => x.titulo === 'Quiz U3')?.abre).toBe(dia('2026-11-09'))
    expect(c.entregas.find(x => x.titulo === 'Taller sin ventana')?.abre).toBeNull()
  })

  test('sin «🪟 Abre:», la ventana arranca el día en que se creó el evento (menos en las evaluaciones)', async () => {
    const c = clasificar([
      { summary: 'Entrega Taller CONIITI a mano', created: '2026-10-20T13:46:37Z', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
      { summary: 'Quiz U3', description: '🪟 Abre: 2026-10-15', created: '2026-10-20T13:46:37Z', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
      { summary: 'PARCIAL Corte II — DPOO', created: '2026-10-18T09:00:00Z', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
    ], en('2026-10-21'))
    expect(c.entregas.find(x => x.titulo.startsWith('Entrega Taller'))?.abre).toBe(dia('2026-10-20'))
    expect(c.entregas.find(x => x.titulo === 'Quiz U3')?.abre).toBe(dia('2026-10-15'))
    expect(c.entregas.find(x => x.titulo.startsWith('PARCIAL'))?.abre).toBeNull()
    expect(ventanas(c.entregas, en('2026-10-21', '14:00')).map(v => v.titulo).sort()).toEqual(['Entrega Taller CONIITI a mano', 'Quiz U3'])
  })

  test('avisa el día que abre, calla hasta la mitad, insiste después y el último día', async () => {
    expect(ventanas([quiz], en('2026-11-08'))).toEqual([])
    expect(ventanas([quiz], en('2026-11-09')).map(v => v.tipo)).toEqual(['abrio'])
    expect(ventanas([quiz], en('2026-11-11'))).toEqual([])
    expect(ventanas([quiz], en('2026-11-13', '14:00')).map(v => v.tipo)).toEqual(['sigue'])
    expect(ventanas([quiz], en('2026-11-16')).map(v => v.tipo)).toEqual(['cierra'])
  })

  test('sin «🪟 Abre:» no hay aviso, y van de la que cierra primero a la última', async () => {
    const taller = { titulo: 'Taller', abre: dia('2026-11-10'), cierra: cierre('2026-11-14') }
    const sinVentana = { titulo: 'Proyecto', abre: null, cierra: cierre('2026-11-13') }
    expect(ventanas([quiz, sinVentana, taller], en('2026-11-14')).map(v => v.titulo)).toEqual(['Taller', 'Quiz U3'])
  })

  test('fechaCorta', async () => {
    expect(fechaCorta(en('2026-11-16'))).toBe('lun 16 nov')
  })
})

/** Redondeo a 3 decimales, para comparar promedios sin ruido de coma flotante. */
const r3 = (x: number | null | undefined) => (x == null ? x : Math.round(x * 1000) / 1000)

describe('evaluaciones', () => {
  const cierre = (f: string) => Date.parse(`${f}T23:59:59-05:00`)
  test('parciales, sustentaciones y exámenes de los próximos 7 días, aparte de las ventanas', async () => {
    const lista = evaluaciones([
      { titulo: 'Sustentación proyecto', cierra: cierre('2026-10-23'), abre: null },
      { titulo: 'PARCIAL Corte II — Teoría de la Computación', cierra: cierre('2026-10-19'), abre: null },
      { titulo: 'Examen final', cierra: cierre('2026-10-30'), abre: null }, // a más de 7 días
      { titulo: 'Taller 4', cierra: cierre('2026-10-20'), abre: null }, // no es evaluación
      { titulo: 'Quiz parcial U3', cierra: cierre('2026-10-21'), abre: cierre('2026-10-10') }, // tiene 🪟: va con las ventanas
    ], AHORA)
    expect(lista.map(x => x.titulo)).toEqual(['PARCIAL Corte II — Teoría de la Computación', 'Sustentación proyecto'])
  })

  test('exposiciones y sustentaciones con «🪟 Abre:» van a la lista 📖 y no se repiten en las ventanas', async () => {
    const en = (f: string, h = '12:00') => Date.parse(`${f}T${h}:00-05:00`)
    const dia = (f: string) => Date.parse(`${f}T00:00:00-05:00`)
    // Los casos reales del 26 oct 2026
    const expo = { titulo: 'Exposición Propiedades de las Expresiones Regulares — Teoría', abre: dia('2026-10-21'), cierra: cierre('2026-10-26') }
    const naval = { titulo: 'Entrega y sustentación Batalla Naval — DPOO', abre: dia('2026-10-20'), cierra: cierre('2026-10-26') }
    const quiz = { titulo: 'Quiz parcial U3', abre: dia('2026-10-20'), cierra: cierre('2026-10-26') }
    for (const h of ['2026-10-24', '2026-10-26']) {
      expect(evaluaciones([expo, naval, quiz], en(h)).map(x => x.titulo)).toEqual([expo.titulo, naval.titulo])
      expect(ventanas([expo, naval, quiz], en(h)).map(x => x.titulo)).toEqual(['Quiz parcial U3'])
    }
    // El día que se asigna, si ya está a 7 días o menos, solo sale en 📖
    expect(ventanas([expo], en('2026-10-21'))).toEqual([])
    expect(evaluaciones([expo], en('2026-10-21')).length).toBe(1)
    // Asignada con más de 7 días: ese día solo el aviso 📬 «Abrió hoy»; ya dentro de los 7, solo 📖
    const lejana = { titulo: 'Exposición plan lector', abre: dia('2026-09-03'), cierra: cierre('2026-10-29') }
    expect(ventanas([lejana], en('2026-09-03')).map(v => v.tipo)).toEqual(['abrio'])
    expect(evaluaciones([lejana], en('2026-09-03'))).toEqual([])
    expect(ventanas([lejana], en('2026-10-25'))).toEqual([])
    expect(evaluaciones([lejana], en('2026-10-25')).length).toBe(1)
  })
})

describe('cuantoFalta', () => {
  // Las notas reales al 18 oct 2026: corte I de todas y el corte II de Álgebra
  const md = [
    '| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |',
    '|---|---|---|---|---|',
    '| Álgebra Lineal | | 18 | 27 | |',
    '| Cálculo Diferencial | | 29 | | |',
    '| Introducción a la Teoría de la Computación | 3 | 28 | | |',
    '| Diseño y Programación Orientados a Objetos | | 17 | | |',
    '| Comunicación Corporativa | | 29 | | |',
    '| Cuida tu Bolsillo | | 30 | | |',
    '| Antropología Filosófica | | 27 | | |',
  ].join('\n')

  test('cuántos puntos faltan de los que quedan, y el máximo posible', async () => {
    const m = cuantoFalta(md, 9.3)
    expect(m?.ponderado).toBe(false)
    expect(r3(m?.necesita)).toBe(446)
    expect(m?.quedan).toBe(460)
    expect(r3(m?.maximo)).toBe(9.5)
  })

  test('por materia: lo que lleva y lo máximo a lo que llega', async () => {
    const m = cuantoFalta(md, 9.3)
    const algebra = m?.materias.find(x => x.materia === 'Álgebra Lineal')
    expect(r3(algebra?.lleva)).toBe(7.5)
    expect(r3(algebra?.maximo)).toBe(8.5)
    const dpoo = m?.materias.find(x => x.materia.startsWith('Diseño'))
    expect(r3(dpoo?.maximo)).toBe(8.7)
  })

  test('con «x/y» solo cuenta como evaluado lo que va del corte', async () => {
    const m = cuantoFalta('| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |\n|---|---|---|---|---|\n| A | | 9/10 | | |', 9)
    // Obtuvo 9 de 10 evaluados: quedan 90 puntos posibles, máximo 9,9
    expect(m?.quedan).toBe(90)
    expect(r3(m?.maximo)).toBe(9.9)
    expect(m?.necesita).toBe(81)
  })

  test('ponderado por créditos cuando todas los tienen', async () => {
    const m = cuantoFalta([
      '| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |',
      '|---|---|---|---|---|',
      '| A | 3 | 30 | | |',
      '| B | 1 | 0 | | |',
    ].join('\n'), 9)
    expect(m?.ponderado).toBe(true)
    // (30·3 + 0·1) obtenidos; meta 90 puntos × 4 créditos = 360 → faltan 270 de 280 posibles
    expect(m?.necesita).toBe(270)
    expect(m?.quedan).toBe(280)
  })
})

describe('fraseMeta y tablaNotas', () => {
  const md = [
    '| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |',
    '|---|---|---|---|---|',
    '| Álgebra Lineal | | 18 | 27 | |',
    '| Cálculo Diferencial | | 29 | | |',
    '| Introducción a la Teoría de la Computación | 3 | 28 | | |',
    '| Diseño y Programación Orientados a Objetos | | 17 | | |',
    '| Comunicación Corporativa | | 29 | | |',
    '| Cuida tu Bolsillo | | 30 | | |',
    '| Antropología Filosófica | | 27 | | |',
  ].join('\n')

  test('la frase del pie con las notas reales', async () => {
    const m = cuantoFalta(md, 9.3)
    expect(m && fraseMeta(m, 9.3)).toBe('🎯 Para 9,3: necesitas 446 de los 460 puntos que quedan (97 %) · máximo posible 9,50')
  })

  test('meta asegurada y meta imposible', async () => {
    const cabeza = '| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |\n|---|---|---|---|---|\n'
    const llena = cuantoFalta(cabeza + '| A | | 30 | 30 | 40 |', 9.3)
    expect(llena && fraseMeta(llena, 9.3)).toBe('🎯 El 9,3 ya está asegurado')
    const baja = cuantoFalta(cabeza + '| A | | 10 | 10 | |', 9.3)
    expect(baja && fraseMeta(baja, 9.3)).toBe('🎯 El 9,3 ya no se alcanza · máximo posible 6,00')
  })

  test('/notas: una fila por materia, de mayor a menor, con aviso donde ya no llega', async () => {
    const m = cuantoFalta(md, 9.3)
    const b = beca(md)
    const t = m ? tablaNotas(m, b, 9.3) : ''
    const filas = t.split('\n')
    expect(filas[0]).toBe('🎓 Beca — meta 9,3 · promedio actual ≈ 8,69 (con 7 de 7 materias)')
    const materias = filas.filter(f => /^(Cuida|Cálculo|Comunicación|Introducción|Antropología|Álgebra|Diseño)/.test(f))
    expect(materias.length).toBe(7)
    expect(materias[0]).toContain('Cuida tu Bolsillo')
    expect(materias[6]).toContain('Diseño')
    expect(materias[6]).toContain('⚠️ ya no llega a 9,3 sola')
    expect(materias.find(f => f.startsWith('Álgebra'))).toContain('⚠️')
    expect(materias.find(f => f.startsWith('Cuida'))).not.toContain('⚠️')
    expect(t).toContain('🎯 Para 9,3: necesitas 446 de los 460 puntos que quedan (97 %).')
    expect(t).toContain('Máximo posible si sacas todo perfecto: 9,50.')
    expect(t).toContain('Sin ponderar')
  })
})

test('enCurso deja solo lo que está pasando, sin los ✍️, y el que termina primero arriba', () => {
  const a = { titulo: 'Clase', calendario: 'University', color: '#4ca8df', inicio: 0, fin: 100 }
  const b = { titulo: 'Gym', calendario: 'Gym', color: '#fd7941', inicio: 10, fin: 50 }
  const c = { titulo: '✍️ Hacer: algo', calendario: 'University', color: null, inicio: 0, fin: 100 }
  const d = { titulo: 'Después', calendario: 'Books', color: null, inicio: 200, fin: 300 }
  expect(enCurso([a, b, c, d], 20).map(x => x.titulo)).toEqual(['Gym', 'Clase'])
})

test('leerAgenda lee la respuesta de gcal-extended y descarta fechas rotas', () => {
  const r = { content: [{ type: 'text', text: JSON.stringify({ events: [
    { summary: 'Gym', calendar: 'Gym', color: '#fd7941', start: '2026-10-18T14:30:00-05:00', end: '2026-10-18T16:00:00-05:00' },
    { summary: 'Roto', calendar: 'X', start: 'nada', end: 'nada' },
  ] }) }] }
  const ev = leerAgenda(r)
  expect(ev.length).toBe(1)
  expect(ev[0].color).toBe('#fd7941')
  expect(iconoCalendario('Gym')).toBe('🏋️')
  expect(iconoCalendario('Otro')).toBe('⏱️')
})

describe('escalones de beca', () => {
  const md = [
    '> **Escalones de beca (estimado):** 25 % 9,02 · 50 % 9,12 · 75 % 9,25 · 100 % 9,45',
    '| Materia | Créditos | Corte I (/30) | Corte II (/30) | Corte III (/40) |',
    '|---|---|---|---|---|',
    '| A | 3 | 28 | 30 | |',
    '| B | 2 | 25 | 25 | |',
  ].join('\n')

  test('lee la línea y los ordena del más bajo al más alto', () => {
    expect(escalones(md)).toEqual([
      { pct: 25, umbral: 9.02 }, { pct: 50, umbral: 9.12 }, { pct: 75, umbral: 9.25 }, { pct: 100, umbral: 9.45 },
    ])
    expect(escalones('sin nada')).toEqual([])
  })

  test('cuánto pide cada uno y hasta cuál se alcanza', () => {
    // obtenido = 58·3 + 50·2 = 274 · quedan = 40·5 = 200 · pesos = 5 → máx. 9,48
    const m = cuantoFalta(md, 9.3)!
    expect(m.escalones.length).toBe(4)
    expect(Math.abs(fraccionPara(m, 9.02) - (451 - 274) / 200) < 1e-9).toBe(true)
    expect(techo(m)?.pct).toBe(100)
    expect(fraseEscalones(m)).toBe('🎯 Promedio por materia en lo que queda: 25 % → 35,4/40 · 50 % → 36,4/40 · 75 % → 37,7/40 · 100 % → 39,7/40 · máx. 9,48')
    const t = tablaNotas(m, beca(md), 9.3)
    expect(t).toContain('🪜 Escalones de beca')
    expect(t).toContain('  100 %  9,45  →  39,7/40 · puedes perder 0,3 por materia')
  })

  test('sin línea de escalones, /notas queda como antes', () => {
    const m = cuantoFalta(md.split('\n').slice(1).join('\n'), 9.3)!
    expect(tablaNotas(m, null, 9.3)).not.toContain('🪜')
  })
})
