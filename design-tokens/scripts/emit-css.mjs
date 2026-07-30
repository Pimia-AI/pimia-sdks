// Vuelca las variables CSS a dist/pimia.css tras compilar (parte del build).
import { writeFileSync } from 'node:fs'
import { cssVariables } from '../dist/css.js'

const header = `/* @pimia/design-tokens — variables CSS del sistema de diseño de Pimia.\n * Generado del build; no editar a mano. Fuente: src/tokens.ts. */\n`
writeFileSync(new URL('../dist/pimia.css', import.meta.url), header + cssVariables())
console.log('dist/pimia.css escrito')
