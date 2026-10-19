import { describe, expect, test } from 'claude-code/testing'

import { beca, clasificar, contexto, cuantoFalta, evaluaciones, fechaCorta, fraseMeta, restante, tablaNotas, ventanas } from './logica'

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
