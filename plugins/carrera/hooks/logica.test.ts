import { describe, expect, test } from 'claude-code/testing'

import { beca, clasificar, contexto, restante } from './logica'

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
