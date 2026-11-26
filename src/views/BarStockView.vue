<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, shallowRef } from 'vue'
import { apiBarStockSettings, apiCurrentClosingCount } from '@/services/api'
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
  controlbar: { label: 'Control del bar', icon: 'fa-gauge-high', component: defineAsyncComponent(() => import('@/components/barstock/ControlBar.vue')) },
  controladmin: { label: 'Control de Administración', icon: 'fa-clipboard-check', component: defineAsyncComponent(() => import('@/components/barstock/AdminControl.vue')) },
  conteo: { label: 'Conteo', icon: 'fa-clipboard-list', component: defineAsyncComponent(() => import('@/components/barstock/ClosingCount.vue')) },
  bar: { label: 'Pedido', icon: 'fa-list-check', component: defineAsyncComponent(() => import('@/components/barstock/StockBar.vue')) },
  pedidos: { label: 'Pedidos', icon: 'fa-stamp', component: defineAsyncComponent(() => import('@/components/barstock/StockDirector.vue')) },
  compras: { label: 'Compras', icon: 'fa-cart-shopping', component: defineAsyncComponent(() => import('@/components/barstock/StockPurchase.vue')) },
  entregas: { label: 'Entregas', icon: 'fa-truck-fast', component: defineAsyncComponent(() => import('@/components/barstock/StockLand.vue')) },
  control: { label: 'Control', icon: 'fa-scale-unbalanced', component: defineAsyncComponent(() => import('@/components/barstock/StockControl.vue')) },
  auditoria: { label: 'Auditoría', icon: 'fa-clipboard-check', component: defineAsyncComponent(() => import('@/components/barstock/StockAudit.vue')) },
  consulta: { label: 'Stock', icon: 'fa-chart-column', component: defineAsyncComponent(() => import('@/components/barstock/StockOverview.vue')) },
} as const
type ViewKey = keyof typeof VIEWS

/**
 * Conteo de cierre abierto (Bar-stock, 24-nov-2026): el bar y la directora
 * entran directo a contar, y el bartender no ve el stock mientras cuenta a ciegas.
 */
const countOpen = shallowRef<string>('')
/** Esta semana compra esta persona (Bar-stock: por defecto Administración; lo asigna Gerencia). */
const buyer = shallowRef('')
onMounted(async () => {
  const [count, settings] = await Promise.allSettled([apiCurrentClosingCount(), apiBarStockSettings()])
  countOpen.value = count.status === 'fulfilled' ? (count.value.count?.status ?? '') : ''
  buyer.value = settings.status === 'fulfilled' ? (settings.value.purchaseResponsible?.id ?? '') : ''
})
const buys = computed(() => Boolean(buyer.value) && buyer.value === userStore.user?.id)

const tabs = computed<ViewKey[]>(() => {
  switch (userStore.role) {
    case 'bartender': {
      const base: ViewKey[] = countOpen.value === 'borrador' ? ['conteo', 'bar'] : countOpen.value ? ['conteo', 'bar', 'consulta'] : ['bar', 'conteo', 'consulta']
      return buys.value ? [...base, 'compras'] : base
    }
    case 'direccion': {
      const base: ViewKey[] = countOpen.value === 'enviado' ? ['conteo', 'pedidos', 'control', 'consulta'] : ['pedidos', 'conteo', 'control', 'consulta']
      return buys.value ? [...base, 'compras'] : base
    }
    // Administración: solo Compras (cuando es la responsable) y su control cada 2 semanas (Bar-stock, 24-nov-2026).
    case 'admin':
    case 'bodega':
      return ['compras', 'controladmin']
    // Gerencia siempre cae en Control del bar › Crucero en curso (especificación del 26-nov-2026).
    case 'duena':
      return ['controlbar', 'conteo', 'consulta', 'pedidos', 'compras']
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
  admin: 'Compras semanales: registra lo comprado y envíalo al barco.',
  bodega: 'Compras semanales: registra lo comprado y envíalo al barco.',
  duena: 'Cómo va el crucero actual y solo lo que necesita tu autorización.',
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
