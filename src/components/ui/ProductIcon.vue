<script setup lang="ts">
// Catálogo por iconos, sin fotos (acuerdo de reunión): set propio en SVG.
const props = defineProps<{ icon: string; size?: number }>()

const PATHS: Record<string, string> = {
  beer: 'M7 3h7a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v4a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 4v6h2V7h-2ZM8.5 8v9m4-9v9',
  wine: 'M8 3h8c0 5-1.5 7.5-4 8v7h3v2H9v-2h3v-7c-2.5-.5-4-3-4-8Z',
  bottle: 'M10 2h4v4l1.5 2a2 2 0 0 1 .5 1.3V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9.3A2 2 0 0 1 8.5 8L10 6V2Z',
  shot: 'M7 4h10l-1.5 16a2 2 0 0 1-2 1.8h-3A2 2 0 0 1 8.5 20L7 4Zm1 5h8',
  cocktail: 'M4 4h16l-7 8v6h4v2H7v-2h4v-6L4 4Zm4 4h8',
  soda: 'M8 7h8l-1 13a2 2 0 0 1-2 1.8h-2A2 2 0 0 1 9 20L8 7Zm2-5 5 3M8 11h8',
  water: 'M12 2s6 7.5 6 12a6 6 0 0 1-12 0c0-4.5 6-12 6-12Z',
  juice: 'M7 6h10l-1.2 14a2 2 0 0 1-2 1.9H10.2a2 2 0 0 1-2-1.9L7 6Zm2-4h6l1 4H8l1-4Z',
  snack: 'M4 15c2-6 6-10 8-10s6 4 8 10c-3 2-5 3-8 3s-5-1-8-3Zm5-4 1 2m4-3 1 2',
  lime: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 2v12M6.3 8l11.4 8M6.3 16 17.7 8',
  glass: 'M7 3h10l-1 18H8L7 3Zm1 6h8',
}

const path = PATHS[props.icon] ?? PATHS.glass
</script>

<template>
  <svg
    :width="size ?? 28"
    :height="size ?? 28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="path" />
  </svg>
</template>
