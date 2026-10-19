// Pruebas del lector de bloques: `claude plugin test <carpeta del mod>`
import { expect, test } from 'claude-code/testing'

import { adelanto, extraerBloques } from './bloques'

const RESPUESTA = [
  'Si contesta, puedes agradecerle con alguno de estos:',
  '',
  '📋 **Versión 1 — corta**',
  '',
  '```text',
  'Profesor, muchas gracias. Lo presento hoy.',
  '```',
  '',
  '📋 **Versión 2 — larga**',
  '',
  '```text',
  'Profesor, muchas gracias por reabrir el quiz.',
  '',
  'Saludos,',
  'Ana',
  '```',
  '',
  'Y un bloque sin 📋, que no cuenta:',
  '',
  '```bash',
  'ls',
  '```',
].join('\n')

test('saca los bloques con 📋, en orden, sin las negritas del título', async () => {
  const b = extraerBloques(RESPUESTA)
  expect(b.length).toBe(2)
  expect(b[0]).toEqual({ titulo: 'Versión 1 — corta', texto: 'Profesor, muchas gracias. Lo presento hoy.' })
  expect(b[1].titulo).toBe('Versión 2 — larga')
  expect(b[1].texto).toBe('Profesor, muchas gracias por reabrir el quiz.\n\nSaludos,\nAna')
})

test('una respuesta sin 📋 no tiene bloques', async () => {
  expect(extraerBloques('Hola\n\n```text\nalgo\n```').length).toBe(0)
})

test('el adelanto va en un renglón y se corta con …', async () => {
  expect(adelanto('uno\ndos')).toBe('uno dos')
  expect(adelanto('a'.repeat(60), 10)).toBe('aaaaaaaaa…')
})
