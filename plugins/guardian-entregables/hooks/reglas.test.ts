import { expect, test } from 'claude-code/testing'

import { codigos, revisar } from './reglas'

// Códigos de ejemplo, inventados
const PROPIO = '10000001'
const BASE = '/u/2nd SEMESTER/01_Materia/Entregables'
const CONOCIDOS = codigos('| Ana | 20000002 |\n| ~~Retirado~~ | 30000003 |\n| Luis | 40000004 |', PROPIO)

test('deja pasar entregas bien nombradas y archivos de trabajo', async () => {
  expect(revisar(`${BASE}/CORTE II/Taller - 10000001, 20000002, 40000004.pdf`, CONOCIDOS, PROPIO)).toBe(null)
  expect(revisar(`${BASE}/CORTE II/Reparto Taller.pdf`, CONOCIDOS, PROPIO)).toBe(null)
  expect(revisar(`${BASE}/CORTE II/borrador.md`, CONOCIDOS, PROPIO)).toBe(null)
  expect(revisar(`${BASE}/Actividad Aplicada/CORTE II/Analisis/figura.pdf`, CONOCIDOS, PROPIO)).toBe(null)
  expect(revisar('/u/2nd SEMESTER/01_Materia/Material de Clase/x.pdf', CONOCIDOS, PROPIO)).toBe(null)
})

test('frena lo que rompe la convención', async () => {
  expect(revisar(`${BASE}/Taller - 10000001.pdf`, CONOCIDOS, PROPIO)).toContain('suelto')
  expect(revisar(`${BASE}/CORTE II/Taller final.pdf`, CONOCIDOS, PROPIO)).toContain('convención')
  expect(revisar(`${BASE}/CORTE II/Taller - 10000001, 30000003.pdf`, CONOCIDOS, PROPIO)).toContain('30000003')
})

test('sin código configurado solo revisa la carpeta', async () => {
  expect(revisar(`${BASE}/CORTE II/Taller final.pdf`, CONOCIDOS, '')).toBe(null)
  expect(revisar(`${BASE}/Taller final.pdf`, CONOCIDOS, '')).toContain('suelto')
})
