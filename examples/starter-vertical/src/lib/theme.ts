/**
 * Las pieles de la app — la demostración literal del white-label.
 *
 * La MISMA app compila y funciona con dos identidades:
 *
 *  - `partner`: «Cuadrilla», una marca inventada de partner. Color propio,
 *    tipografía propia, cero dependencia del sistema de diseño de Pimia.
 *    Es la piel por defecto: el white-label es que TU marca sea la normal.
 *  - `pimia`: la piel oficial, montada sobre `@pimia/design-tokens`. Un
 *    partner que quiera parecerse al panel de Pimia activa esta y ya.
 *
 * Se conmuta con `NEXT_PUBLIC_THEME=partner|pimia` (variable de build: tras
 * cambiarla, reinicia `next dev` o recompila). El mecanismo es deliberadamente
 * tonto: `data-theme` en <html> y variables CSS semánticas que cada piel
 * rellena a su manera (ver src/app/themes/).
 */

export type ThemeId = 'partner' | 'pimia'

export interface Theme {
  id: ThemeId
  /** Nombre de marca que ve el usuario (cabecera, <title>, pie). */
  brand: string
  /** Una línea bajo la marca en la portada. */
  claim: string
}

// Las familias tipográficas de cada piel se declaran con next/font en
// src/app/layout.tsx (auto-hospedadas) y cada piel las referencia por su
// variable CSS en src/app/themes/*.css.
const THEMES: Record<ThemeId, Theme> = {
  partner: {
    id: 'partner',
    brand: 'Cuadrilla',
    claim: 'Presupuestos y facturación para empresas de reformas, sin dolores.',
  },
  pimia: {
    id: 'pimia',
    brand: 'Dawn',
    claim: 'La app vertical de referencia de Pimia.',
  },
}

export function activeTheme(): Theme {
  return THEMES[process.env.NEXT_PUBLIC_THEME === 'pimia' ? 'pimia' : 'partner']
}
