<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { apiCabinAccount, apiOrders } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import CollectModal from '@/components/accounts/CollectModal.vue'
import type { AccountSummary, Cabin, Order } from '@/types'

const cruiseStore = useCruiseStore()
const toast = useToastStore()
const { active: cruise, cabins } = storeToRefs(cruiseStore)

const openOrders = ref<Order[]>([])
const loading = shallowRef(false)

const collectTarget = shallowRef<{ cabin: Cabin; account: AccountSummary } | null>(null)

/** Total abierto por cabina, calculado desde los pedidos sin cobrar. */
const totalsByCabin = computed(() => {
  const totals = new Map<number, { total: number; orders: number }>()
  for (const order of openOrders.value) {
    const entry = totals.get(order.cabinNumber) ?? { total: 0, orders: 0 }
    entry.total += order.total
    entry.orders += 1
    totals.set(order.cabinNumber, entry)
  }
  return totals
})

async function refresh() {
  if (!cruise.value) return
  loading.value = true
  try {
    openOrders.value = await apiOrders({ cruiseId: cruise.value._id, status: 'abierta' })
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await cruiseStore.loadActive()
  await refresh()
})

async function openCollect(cabin: Cabin) {
  if (!cruise.value) return
  try {
    const account = await apiCabinAccount(cruise.value._id, cabin.number)
    if (!account.orders.length) {
      toast.push(`La cabina ${cabin.number} no tiene consumos abiertos`)
      return
    }
    collectTarget.value = { cabin, account }
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

async function onCollected() {
  const cabinNumber = collectTarget.value?.cabin.number
  collectTarget.value = null
  toast.success(`Cuenta de cabina ${cabinNumber} cobrada`)
  await refresh()
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">Cuentas por cabina</h1>
    <p v-if="cruise" class="subtitle">{{ cruise.name }}</p>

    <div class="accounts">
      <article
        v-for="cabin in cabins"
        :key="cabin.number"
        class="card account"
        :class="{ 'account--empty': !totalsByCabin.get(cabin.number) }"
      >
        <header class="account-head">
          <span class="account-number">Cabina {{ cabin.number }}</span>
          <span class="account-guest">{{ cabin.guestName || 'Sin huésped' }}</span>
        </header>

        <p class="account-total">
          {{ formatMoney(totalsByCabin.get(cabin.number)?.total ?? 0) }}
        </p>
        <p class="account-orders">
          {{ totalsByCabin.get(cabin.number)?.orders ?? 0 }} pedidos abiertos
        </p>

        <button
          type="button"
          class="btn btn-primary account-collect"
          :disabled="!totalsByCabin.get(cabin.number)"
          @click="openCollect(cabin)"
        >
          Ver cuenta y cobrar
        </button>
      </article>
    </div>

    <CollectModal
      v-if="collectTarget && cruise"
      :cruise-id="cruise._id"
      :cabin="collectTarget.cabin"
      :account="collectTarget.account"
      @close="collectTarget = null"
      @collected="onCollected"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.subtitle {
  margin: -0.5rem 0 1rem;
  color: var(--ink-400);
  font-weight: 600;
}

.accounts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: repeat(3, 1fr);
  }

  @include desktop {
    grid-template-columns: repeat(3, 1fr);
    max-width: 900px;
  }
}

.account {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  &--empty {
    opacity: 0.65;
  }
}

.account-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}

.account-number {
  font-weight: 800;
}

.account-guest {
  font-size: 0.8rem;
  color: var(--ink-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-total {
  margin: 0.4rem 0 0;
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--navy-800);
}

.account-orders {
  margin: 0 0 0.6rem;
  font-size: 0.8rem;
  color: var(--ink-400);
}

.account-collect {
  width: 100%;
}
</style>
