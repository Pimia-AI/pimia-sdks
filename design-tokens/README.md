# @pimia/design-tokens

El sistema de diseño de Pimia («los números en limpio») como paquete
**opcional** para apps de partner: tokens tipados, variables CSS y un preset de
Tailwind. Licencia MIT.

**El white-label es poder no usarlo.** Tu app vertical puede traer tu marca, tu
tipografía y tu paleta — este paquete existe para el partner que quiera el
aspecto Pimia (o su chasis) sin copiarlo a mano, y para que «powered by Pimia»
pueda verse, no solo leerse.

Fuente de verdad: el `DESIGN.md` de la plataforma (snapshot 2026-07-30). Si
diverge, gana la plataforma y este paquete se actualiza — no al revés.

## Uso

**Variables CSS (sin build, sin framework):**

```css
@import '@pimia/design-tokens/pimia.css';

.mi-boton {
  background: var(--pimia-color-primary);
  border-radius: var(--pimia-radius-control);
}
```

**Preset de Tailwind:**

```js
// tailwind.config.js
import pimiaPreset from '@pimia/design-tokens/tailwind'

export default {
  presets: [pimiaPreset],
  content: ['./src/**/*.{ts,tsx,vue}'],
}
```

Da `bg-primary`, `text-ink-muted`, `bg-success-container`, `rounded-card`,
`font-display`, `p-md`… siempre por `theme.extend` (no borra la paleta por
defecto; la disciplina de no usar `purple-*` es tuya si adoptas el sistema).

**Tokens en JS/TS:**

```ts
import { colors, typography, namedRules } from '@pimia/design-tokens'
```

Las fuentes (Plus Jakarta Sans + Inter) no van en el paquete: cárgalas
self-hosted o desde tu proveedor; los stacks declaran los fallbacks.

## Las reglas que hacen que parezca Pimia

Si adoptas el sistema, estas cinco reglas son el 90 % del resultado (el
detalle narrativo vive en el DESIGN.md de la plataforma; aquí van como
`namedRules` consultables):

1. **Una sola voz** — el violeta OKLCH 278 es la única voz de marca; nada de
   `purple-*`/`violet-*` de serie.
2. **El semáforo contable** — `success`/`warning`/`danger` hablan SOLO de
   estado de dinero y cumplimiento; el violeta jamás comunica estado.
3. **El límite del slate** — el texto legible nunca baja de `ink-muted`
   (`#475569`); `ink-subtle` es solo decorativo (no cumple AA).
4. **Plano por defecto** — profundidad por hairlines de 1 px y contraste de
   superficie; sombra máxima `shadow-sm` y siempre con borde.
5. **Números tabulares** — todo dato financiero en mono con `tabular-nums` y,
   en tablas, alineado a la derecha.

Y una prohibición sin matices: **cero emojis en la UI**.

## Qué NO es

- No es una librería de componentes (los recetarios de `components` son la
  forma canónica de botón/input/card/badge, para que montes los tuyos).
- No es obligatorio: ninguna invariante de la plataforma depende de él — las
  reglas legales y de cumplimiento viven server-side, no en el CSS.
