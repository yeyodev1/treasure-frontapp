<script setup lang="ts">
import { computed, defineAsyncComponent, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { todayKey } from '@/utils/format'

/**
 * Resumen del negocio (solo Gerencia; el servidor también lo restringe).
 * Desde el 21-nov-2026 va por pestañas y con gráficos, sin scroll infinito:
 * Año (evaluar el negocio), Mes, Crucero (la unidad de información) y, aparte,
 * las pantallas de control que ya existían (cuentas, comisiones). El 23-nov-2026
 * se quitó «Registro y paras» (repetía Año y Mes; las paras se marcan en Año)
 * y lo repetido entre pestañas.
 */
const route = useRoute()
const router = useRouter()

const TABS = {
  ano: {
    label: 'Año',
    icon: 'fa-chart-column',
    component: defineAsyncComponent(() => import('@/components/owner/OwnerYear.vue')),
  },
  mes: {
    label: 'Mes',
    icon: 'fa-calendar',
    component: defineAsyncComponent(() => import('@/components/owner/OwnerMonth.vue')),
  },
  crucero: {
    label: 'Crucero',
    icon: 'fa-ship',
    component: defineAsyncComponent(() => import('@/components/owner/OwnerCruise.vue')),
  },
  cuentas: {
    label: 'Cuentas y margen',
    icon: 'fa-sack-dollar',
    component: defineAsyncComponent(() => import('@/components/owner/OwnerPanel.vue')),
  },
  comisiones: {
    label: 'Comisiones y agencias',
    icon: 'fa-percent',
    component: null,
  },
} as const
type Tab = keyof typeof TABS
const KEYS = Object.keys(TABS) as Tab[]

const BartenderCommissions = defineAsyncComponent(() => import('@/components/owner/BartenderCommissions.vue'))
const AgencyBilling = defineAsyncComponent(() => import('@/components/owner/AgencyBilling.vue'))

const tab = computed<Tab>(() => (KEYS.includes(route.query.vista as Tab) ? (route.query.vista as Tab) : 'ano'))
function go(next: Tab) {
  void router.replace({ query: next === 'ano' ? {} : { vista: next } })
}

// Lo elegido se conserva al pasar de una pestaña a otra (año → mes → crucero).
const year = shallowRef(Number(todayKey().slice(0, 4)))
const month = shallowRef(todayKey().slice(0, 7))
const cruise = shallowRef('')

function openMonth(key: string) {
  month.value = key
  go('mes')
}
function openCruise(id: string) {
  cruise.value = id
  go('crucero')
}
</script>

<template>
  <div class="page">
    <header class="dash-head">
      <h1 class="page-title">Resumen del negocio</h1>
      <p class="subtitle">Elige el nivel: el año, un mes o un crucero. Toca un gráfico para bajar al detalle.</p>
    </header>

    <nav class="segs tabs" aria-label="Resumen del negocio">
      <button
        v-for="key in KEYS"
        :key="key"
        type="button"
        class="segs-item"
        :class="{ 'segs-item--on': tab === key }"
        :aria-current="tab === key ? 'page' : undefined"
        @click="go(key)"
      >
        <i class="fa-solid" :class="TABS[key].icon" aria-hidden="true" />
        {{ TABS[key].label }}
      </button>
    </nav>

    <component :is="TABS.ano.component" v-if="tab === 'ano'" v-model:year="year" @month="openMonth" @cruise="openCruise" />
    <component :is="TABS.mes.component" v-else-if="tab === 'mes'" v-model:month="month" @cruise="openCruise" />
    <component :is="TABS.crucero.component" v-else-if="tab === 'crucero'" v-model:cruise="cruise" />
    <template v-else-if="tab === 'comisiones'">
      <BartenderCommissions />
      <AgencyBilling />
    </template>
    <component :is="TABS[tab].component" v-else />
  </div>
</template>

<style scoped lang="scss">
.dash-head {
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.subtitle {
  margin: 0;
  font-size: 1rem;
  color: var(--ink-600);
}

.tabs {
  margin-bottom: 1.25rem;
}
</style>
