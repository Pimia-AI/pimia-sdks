/**
 * Los tests codifican las reglas con nombre de DESIGN.md que se pueden
 * comprobar mecánicamente: la voz única de marca (matiz 278), las parejas
 * semánticas con contenedor, las fuentes vetadas y la salida CSS/Tailwind.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  colors,
  cssVariables,
  fontFamilies,
  forbiddenFonts,
  radius,
  spacing,
  tailwindPreset,
  tokens,
  typography,
} from '../dist/index.js'

test('la marca es OKLCH matiz 278 en toda la familia primary', () => {
  for (const name of ['primary', 'primaryHover', 'primaryContainer', 'primaryContainerSubtle']) {
    assert.match(colors[name], /^oklch\(.* 278\)$/, `${name} debe ser oklch(... 278)`)
  }
})

test('cada color del semáforo tiene su pareja -container', () => {
  for (const base of ['success', 'warning', 'danger']) {
    assert.ok(colors[base], `falta ${base}`)
    assert.ok(colors[`${base}Container`], `falta ${base}Container`)
  }
})

test('las fuentes vetadas no aparecen en ningún stack', () => {
  const stacks = JSON.stringify(fontFamilies).toLowerCase()
  for (const font of forbiddenFonts) {
    assert.ok(!stacks.includes(font.toLowerCase()), `${font} está vetada por DESIGN.md §3`)
  }
})

test('la tipografía de familia: Jakarta titula, Inter trabaja, mono del sistema', () => {
  assert.equal(fontFamilies.display[0], 'Plus Jakarta Sans')
  assert.equal(fontFamilies.body[0], 'Inter')
  assert.equal(fontFamilies.mono[0], 'ui-monospace')
  assert.equal(typography.headline.fontFamily[0], 'Plus Jakarta Sans')
  assert.equal(typography.body.fontFamily[0], 'Inter')
})

test('radios por rol: control 0.5rem, card 0.75rem, badge 0.375rem', () => {
  assert.equal(radius.control, '0.5rem')
  assert.equal(radius.card, '0.75rem')
  assert.equal(radius.badge, '0.375rem')
  assert.equal(radius.pill, '9999px')
})

test('cssVariables() emite un bloque :root con los prefijos --pimia-*', () => {
  const css = cssVariables()
  assert.ok(css.startsWith(':root {'))
  assert.ok(css.trimEnd().endsWith('}'))
  assert.match(css, /--pimia-color-primary: oklch\(48% 0\.20 278\);/)
  assert.match(css, /--pimia-color-muted-ink: #475569;/)
  assert.match(css, /--pimia-font-display: 'Plus Jakarta Sans', system-ui, sans-serif;/)
  assert.match(css, /--pimia-radius-card: 0\.75rem;/)
  assert.match(css, /--pimia-space-md: 1rem;/)
  // Un token nuevo sin kebab-case correcto rompería aquí.
  assert.ok(!css.includes('--pimia-color-primaryHover'), 'los nombres van en kebab-case')
})

test('el preset de Tailwind extiende sin purple/violet y con las escalas del sistema', () => {
  const extend = tailwindPreset.theme.extend
  assert.ok(!('purple' in extend.colors) && !('violet' in extend.colors))
  assert.equal(extend.colors.primary.DEFAULT, colors.primary)
  assert.equal(extend.colors.danger.container, colors.dangerContainer)
  assert.equal(extend.fontFamily.display[0], 'Plus Jakarta Sans')
  assert.equal(extend.borderRadius.control, '0.5rem')
  assert.deepEqual(extend.spacing, { ...spacing })
})

test('el objeto tokens agrupa todas las escalas', () => {
  assert.deepEqual(Object.keys(tokens).sort(), [
    'colors',
    'components',
    'fontFamilies',
    'radius',
    'spacing',
    'typography',
  ])
})
