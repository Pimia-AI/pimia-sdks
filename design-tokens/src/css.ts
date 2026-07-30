/**
 * Variables CSS a partir de los tokens: la vía de adopción sin build ni
 * framework. `cssVariables()` devuelve el bloque `:root`; el build lo vuelca
 * además a `dist/pimia.css` para importarlo tal cual.
 */
import { colors, fontFamilies, radius, spacing } from './tokens.js'

const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

export function cssVariables(): string {
  const lines: string[] = [':root {']

  for (const [name, value] of Object.entries(colors)) {
    lines.push(`  --pimia-color-${kebab(name)}: ${value};`)
  }
  for (const [name, value] of Object.entries(fontFamilies)) {
    const stack = value.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ')
    lines.push(`  --pimia-font-${kebab(name)}: ${stack};`)
  }
  for (const [name, value] of Object.entries(radius)) {
    lines.push(`  --pimia-radius-${kebab(name)}: ${value};`)
  }
  for (const [name, value] of Object.entries(spacing)) {
    lines.push(`  --pimia-space-${name}: ${value};`)
  }

  lines.push('}')
  return lines.join('\n') + '\n'
}
