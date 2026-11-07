<script setup lang="ts">
import { computed } from 'vue'
import type { ServingIconKind } from '@/types'

/**
 * Vaso o envase con que se sirve la bebida (Especificación de color e iconos ·
 * Pantalla Bar, 7-nov-2026). Trazo currentColor de 2,2 en 48×48; el líquido es
 * la misma forma rellena al 30 %, así toma el color de su categoría.
 */
const props = withDefaults(defineProps<{ kind: ServingIconKind; size?: number }>(), { size: 44 })

type Shape =
  | { d: string }
  | { rect: [x: number, y: number, w: number, h: number, rx: number] }
  | { circle: [cx: number, cy: number, r: number] }

/** La primera forma de cada icono es el líquido. */
const ICONS: Record<ServingIconKind, Shape[]> = {
  martini: [
    { d: 'M12.5 12h23L24 25z' },
    { d: 'M8 8h32L24 27z' },
    { d: 'M24 27v13M16 40h16' },
    { d: 'M32 3l-4.5 10' },
    { circle: [27, 14, 2.2] },
  ],
  alto: [
    { d: 'M15.4 18h17.2l-1.5 22.5H16.9z' },
    { d: 'M14 6h20l-2.5 36h-15z' },
    { d: 'M29 2l-3.5 20' },
    { d: 'M18.5 22.5h5v5h-5z' },
  ],
  corto: [
    { d: 'M11.2 24h25.6l-1.4 14.5H12.6z' },
    { d: 'M9 14h30l-2.6 26H11.6z' },
    { rect: [17, 19, 8, 8, 1.6] },
    { rect: [25, 23, 7, 7, 1.4] },
  ],
  copa: [
    { d: 'M15.2 11h17.6c-.6 6-3.9 9.6-8.8 9.6s-8.2-3.6-8.8-9.6z' },
    { d: 'M14 5h20c0 11-4.5 17-10 17S14 16 14 5z' },
    { d: 'M24 22v18M16 40h16' },
  ],
  flauta: [
    { d: 'M19.4 10h9.2c-.4 8-2 11.6-4.6 11.6S19.8 18 19.4 10z' },
    { d: 'M19 4h10c0 13-2 19-5 19s-5-6-5-19z' },
    { d: 'M24 23v17M18 40h12' },
    { circle: [23, 14, 0.9] },
    { circle: [25.4, 17, 0.9] },
    { circle: [24, 11, 0.9] },
  ],
  botvino: [
    { d: 'M15 27h18v15a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2z' },
    { d: 'M20 3h8v9c0 3 5 4.5 5 10v20a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2V22c0-5.5 5-7 5-10z' },
    { d: 'M20 7h8' },
    { rect: [18.5, 30, 11, 8, 1.2] },
  ],
  botlicor: [
    { d: 'M13 23h22v19a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2z' },
    { d: 'M19 3h10v6l6 5v28a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V14l6-5z' },
    { rect: [17, 27, 14, 10, 1.4] },
  ],
  mini: [
    { d: 'M18 30h12v11a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z' },
    { d: 'M21.5 12h5v5c0 2 3.5 3 3.5 7v17a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V24c0-4 3.5-5 3.5-7z' },
    { d: 'M21.5 15h5' },
    { d: 'M36 8v6M33 11h6' },
  ],
  cerveza: [
    { d: 'M18 21h12v21a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z' },
    { d: 'M21 3h6v8l3 5v26a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V16l3-5z' },
    { d: 'M21 6h6' },
    { d: 'M18 26h12v8H18z' },
  ],
  lata: [
    { d: 'M13.5 18h21v13h-21z' },
    { d: 'M15 8h18l1.5 3v26l-1.5 3H15l-1.5-3V11z' },
    { d: 'M13.5 13h21M13.5 35h21' },
    { d: 'M21 8V5.5h6' },
  ],
  agua: [
    { d: 'M13 27h22a11 11 0 0 1-22 0z' },
    { d: 'M24 5c6 8 11 14 11 21a11 11 0 0 1-22 0c0-7 5-13 11-21z' },
    { d: 'M18.5 28a5.5 5.5 0 0 0 5.5 5.5' },
  ],
  descorche: [
    { rect: [10, 5, 28, 6, 3] },
    { d: 'M24 11v6' },
    { d: 'M24 17c-5 2 5 4 0 6s5 4 0 6s5 4 0 6' },
    { d: 'M24 35v6' },
  ],
}

const shapes = computed(() => ICONS[props.kind] ?? ICONS.alto)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-for="(s, i) in shapes" :key="i">
      <circle v-if="'circle' in s" :cx="s.circle[0]" :cy="s.circle[1]" :r="s.circle[2]" fill="currentColor" stroke="none" />
      <rect
        v-else-if="'rect' in s"
        :x="s.rect[0]"
        :y="s.rect[1]"
        :width="s.rect[2]"
        :height="s.rect[3]"
        :rx="s.rect[4]"
        v-bind="i === 0 ? { fill: 'currentColor', 'fill-opacity': 0.3, stroke: 'none' } : {}"
      />
      <path v-else :d="s.d" v-bind="i === 0 ? { fill: 'currentColor', 'fill-opacity': 0.3, stroke: 'none' } : {}" />
    </template>
  </svg>
</template>
