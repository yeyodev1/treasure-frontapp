<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { cruiseRouteText, legStyle, loadCruiseLook } from '@/utils/cruiseLook'

/** Crucero con el color de su tipo y de dónde a dónde va (pedido de Gerencia, 26-nov-2026). */
const props = withDefaults(defineProps<{ code: string; route?: boolean }>(), { route: true })
onMounted(loadCruiseLook)
const routeText = computed(() => (props.route ? cruiseRouteText(props.code) : ''))
</script>

<template>
  <span class="ct">
    <span class="ct-code" :style="legStyle(code)">{{ code }}</span>
    <small v-if="routeText" class="ct-route">{{ routeText }}</small>
  </span>
</template>

<style scoped>
.ct {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.2rem 0.4rem;
  min-width: 0;
}

.ct-code {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.85em;
  white-space: nowrap;
}

.ct-route {
  color: var(--ink-600);
  font-weight: 400;
  font-size: 0.8em;
}
</style>
