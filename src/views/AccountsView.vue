<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { apiCruiseAccounts } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import AccountModal from '@/components/accounts/AccountModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { AccountStatus, Cabin, CabinAccountRow } from '@/types'

const cruiseStore = useCruiseStore()
const toast = useToastStore()
const { active: cruise } = storeToRefs(cruiseStore)

const rows = shallowRef<CabinAccountRow[]>([])
const loading = shallowRef(true)
const target = shallowRef<Cabin | null>(null)

const STATUS: Record<AccountStatus, { label: string; icon: string }> = {
  abierta: { label: 'Abierta', icon: 'fa-folder-open' },
  en_revision: { label: 'En revisión', icon: 'fa-hourglass-half' },
  aprobada: { label: 'Aprobada', icon: 'fa-shield-halved' },
  cobrada: { label: 'Cobrada', icon: 'fa-circle-check' },
}

const totals = computed(() => ({
  open: rows.value.reduce((s, r) => s + (r.status !== 'cobrada' ? r.total : 0), 0),
  review: rows.value.filter((r) => r.status === 'en_revision').length,
  approved: rows.value.filter((r) => r.status === 'aprobada').length,
}))

async function refresh() {
  if (!cruise.value) {
    loading.value = false
    return
  }
  try {
    rows.value = await apiCruiseAccounts(cruise.value._id)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await cruiseStore.loadActive(true)
  await refresh()
})

function open(row: CabinAccountRow) {
  const cabin = cruise.value?.cabins.find((c) => c.number === row.cabinNumber)
  if (cabin) target.value = cabin
}

async function onChanged() {
  await Promise.all([refresh(), cruiseStore.loadActive(true)])
  if (target.value && cruise.value) {
    target.value = cruise.value.cabins.find((c) => c.number === target.value!.number) ?? null
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">Cuentas por cabina</h1>
        <p v-if="cruise" class="subtitle">
          {{ cruise.code ? `Salida ${cruise.code}` : cruise.name }}
          <template v-if="cruise.routeFrom"> · {{ cruise.routeFrom }} → {{ cruise.routeTo }}</template>
        </p>
      </div>
      <div v-if="!loading && rows.length" class="summary">
        <span><strong>{{ formatMoney(totals.open) }}</strong> por cobrar</span>
        <span v-if="totals.review" class="chip chip--review">{{ totals.review }} en revisión</span>
        <span v-if="totals.approved" class="chip chip--ok">{{ totals.approved }} aprobadas</span>
      </div>
    </header>

    <SkeletonList v-if="loading" variant="card" :rows="9" />

    <p v-else-if="!cruise" class="empty">No hay salida activa ni programada.</p>

    <div v-else class="accounts">
      <button
        v-for="row in rows"
        :key="row.cabinNumber"
        type="button"
        class="account"
        :class="[`account--${row.status}`, { 'account--idle': !row.orders && row.status !== 'cobrada' }]"
        @click="open(row)"
      >
        <header class="account-head">
          <span class="account-chip">{{ row.cabinNumber }}</span>
          <span class="account-guest">{{ row.guestName || 'Sin pasajeros' }}</span>
          <span class="account-status">
            <i class="fa-solid" :class="STATUS[row.status].icon" aria-hidden="true" />
            {{ STATUS[row.status].label }}
          </span>
        </header>

        <template v-if="row.orders">
          <p class="account-total">{{ formatMoney(row.total) }}</p>
          <p class="account-meta">
            <span><i class="fa-solid fa-receipt" aria-hidden="true" /> {{ row.orders }} pedido(s)</span>
            <span v-if="row.pendingDeliveries" class="account-pending">
              <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
              {{ row.pendingDeliveries }} por entregar
            </span>
          </p>
        </template>
        <p v-else class="account-idle-text">
          <i class="fa-regular fa-moon" aria-hidden="true" /> Sin consumos
        </p>
      </button>
    </div>

    <AccountModal
      v-if="target && cruise"
      :cruise-id="cruise._id"
      :cabin="target"
      @close="target = null"
      @changed="onChanged"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.subtitle {
  margin: 0;
  color: var(--ink-400);
  font-weight: 600;
}

.summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  font-size: 0.9rem;
  color: var(--ink-600);
}

.chip {
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;

  &--review {
    background: rgba(185, 128, 47, 0.16);
    color: #8a5d1d;
  }

  &--ok {
    background: rgba(63, 122, 87, 0.14);
    color: var(--success);
  }
}

.empty {
  color: var(--ink-400);
}

.accounts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.75rem;
}

.account {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 1rem;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;

  &:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  &--en_revision {
    border-color: rgba(185, 128, 47, 0.6);
  }

  &--aprobada {
    border-color: rgba(63, 122, 87, 0.6);
  }

  &--idle {
    background: transparent;
    box-shadow: none;
    border-style: dashed;
  }
}

.account-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.account-chip {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-weight: 700;
  flex-shrink: 0;

  .account--idle & {
    background: var(--cream-200);
    color: var(--ink-400);
  }
}

.account-guest {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-status {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--ink-400);

  .account--en_revision & {
    color: #8a5d1d;
  }

  .account--aprobada & {
    color: var(--success);
  }

  .account--cobrada & {
    color: var(--navy-700);
  }
}

.account-total {
  margin: 0.45rem 0 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;
}

.account-meta {
  margin: 0;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: var(--ink-400);

  i {
    color: var(--gold-500);
  }
}

.account-pending {
  color: var(--warning);
  font-weight: 600;
}

.account-idle-text {
  margin: 0.7rem 0 0.2rem;
  font-size: 0.85rem;
  color: var(--ink-400);
}
</style>
