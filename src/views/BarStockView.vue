<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

/**
 * BAR - STOCK (pedido del cliente, 19-nov-2026): una sola sección de
 * inventario de bebidas con una pantalla según quién entra.
 * - Bar: contar, pedir y recibir.
 * - Directora: revisar y aprobar, y el control (diferencias e historial).
 * - Tierra: comprar y enviar, y la auditoría.
 * - Gerencia: consulta general, y también puede aprobar o enviar.
 * Flujo: BAR cuenta y pide → DIRECTORA aprueba → TIERRA envía → BAR recibe.
 */
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const VIEWS = {
  bar: { label: 'Contar y pedir', icon: 'fa-list-check', component: defineAsyncComponent(() => import('@/components/barstock/StockBar.vue')) },
  pedidos: { label: 'Pedidos', icon: 'fa-stamp', component: defineAsyncComponent(() => import('@/components/barstock/StockDirector.vue')) },
  entregas: { label: 'Entregas', icon: 'fa-truck-fast', component: defineAsyncComponent(() => import('@/components/barstock/StockLand.vue')) },
  control: { label: 'Control', icon: 'fa-scale-unbalanced', component: defineAsyncComponent(() => import('@/components/barstock/StockControl.vue')) },
  auditoria: { label: 'Auditoría', icon: 'fa-clipboard-check', component: defineAsyncComponent(() => import('@/components/barstock/StockControl.vue')) },
  consulta: { label: 'Consulta general', icon: 'fa-chart-column', component: defineAsyncComponent(() => import('@/components/barstock/StockOverview.vue')) },
} as const
type ViewKey = keyof typeof VIEWS

const tabs = computed<ViewKey[]>(() => {
  switch (userStore.role) {
    case 'bartender':
      return ['bar']
    case 'direccion':
      return ['pedidos', 'control']
    case 'admin':
    case 'bodega':
      return ['entregas', 'auditoria']
    case 'duena':
      return ['consulta', 'pedidos', 'entregas']
    default:
      return []
  }
})

const active = computed<ViewKey | null>(() => {
  const asked = route.query.vista as ViewKey | undefined
  return asked && tabs.value.includes(asked) ? asked : (tabs.value[0] ?? null)
})

function go(key: ViewKey) {
  void router.replace({ query: key === tabs.value[0] ? {} : { vista: key } })
}

const LEAD: Partial<Record<string, string>> = {
  bartender: 'Cuenta lo que tienes, pide lo que falta y recibe lo que llega.',
  direccion: 'Revisa lo que pidió el bar y apruébalo. Pasa directo a Tierra.',
  admin: 'Envía lo que aprobó la directora. El barco lo suma cuando el bar lo recibe.',
  bodega: 'Envía lo que aprobó la directora. El barco lo suma cuando el bar lo recibe.',
  duena: 'Cuánto hay a bordo, lo que se agota y cómo van los pedidos.',
}
</script>

<template>
  <div class="page bar-stock-page">
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">BAR - STOCK</h1>
        <p class="page-lead">{{ LEAD[userStore.role ?? ''] }}</p>
      </div>
    </header>

    <nav v-if="tabs.length > 1" class="segs tabs" aria-label="BAR - STOCK">
      <button
        v-for="key in tabs"
        :key="key"
        type="button"
        class="segs-item"
        :class="{ 'segs-item--on': active === key }"
        :aria-current="active === key ? 'page' : undefined"
        @click="go(key)"
      >
        <i class="fa-solid" :class="VIEWS[key].icon" aria-hidden="true" /> {{ VIEWS[key].label }}
      </button>
    </nav>

    <component :is="VIEWS[active].component" v-if="active" :key="active" />
    <p v-else class="muted">Tu perfil no usa BAR - STOCK.</p>
  </div>
</template>

<style scoped lang="scss">
.bar-stock-page {
  max-width: 1180px;
}

.tabs {
  margin-bottom: 1rem;
}
</style>
