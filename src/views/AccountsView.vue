<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { apiCabinAccount, apiOrders } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import CollectModal from '@/components/accounts/CollectModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useSound } from '@/composables/useSound'
import type { AccountSummary, Cabin, Order } from '@/types'

const cruiseStore = useCruiseStore()
const toast = useToastStore()
const { active: cruise, cabins } = storeToRefs(cruiseStore)

const { play } = useSound()

const openOrders = ref<Order[]>([])
const loading = shallowRef(true)

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
  if (!cruise.value) {
    loading.value = false
    return
  }
  try {
    const data = await apiOrders({ cruiseId: cruise.value._id, status: 'abierta', limit: 300 })
    openOrders.value = data.orders
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
  play('cash')
  toast.success(`Cuenta de cabina ${cabinNumber} cobrada`)
  await refresh()
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">Cuentas por cabina</h1>
    <p v-if="cruise" class="subtitle">{{ cruise.name }}</p>

    <SkeletonList v-if="loading" variant="card" :rows="9" />
    <div v-else class="accounts">
      <article
        v-for="cabin in cabins"
        :key="cabin.number"
        class="card account"
        :class="{ 'account--empty': !totalsByCabin.get(cabin.number) }"
      >
        <header class="account-head">
          <span class="account-chip">{{ cabin.number }}</span>
          <span class="account-guest">{{ cabin.guestName || 'Sin huésped' }}</span>
        </header>

        <template v-if="totalsByCabin.get(cabin.number)">
          <p class="account-total">
            {{ formatMoney(totalsByCabin.get(cabin.number)!.total) }}
          </p>
          <p class="account-orders">
            <i class="fa-solid fa-receipt" aria-hidden="true" />
            {{ totalsByCabin.get(cabin.number)!.orders }}
            {{ totalsByCabin.get(cabin.number)!.orders === 1 ? 'pedido abierto' : 'pedidos abiertos' }}
          </p>
          <button type="button" class="btn btn-gold account-collect" @click="openCollect(cabin)">
            <i class="fa-solid fa-file-invoice-dollar" aria-hidden="true" />
            Ver cuenta y cobrar
          </button>
        </template>

        <p v-else class="account-idle">
          <i class="fa-regular fa-moon" aria-hidden="true" />
          Sin consumos aún
        </p>
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
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  }
}

.account {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  transition: box-shadow 0.18s ease, transform 0.18s ease;

  // Cabina sin consumo: tarjeta ligera, sin botón, para que las que sí
  // tienen cuenta salten a la vista.
  &--empty {
    background: transparent;
    box-shadow: none;
    border: 1.5px dashed var(--cream-200);
  }

  &:not(.account--empty):hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
}

.account-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.account-chip {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--navy-800);
  color: var(--cream-100);
  font-weight: 700;
  flex-shrink: 0;

  .account--empty & {
    background: var(--cream-200);
    color: var(--ink-400);
  }
}

.account-guest {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--ink-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .account--empty & {
    color: var(--ink-400);
    font-weight: 500;
  }
}

.account-total {
  margin: 0.45rem 0 0;
  font-size: 1.65rem;
  font-weight: 800;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;
}

.account-orders {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  color: var(--ink-400);

  i {
    margin-right: 0.3rem;
    color: var(--gold-500);
  }
}

.account-collect {
  width: 100%;
}

.account-idle {
  margin: 0.8rem 0 0.4rem;
  font-size: 0.85rem;
  color: var(--ink-400);

  i {
    margin-right: 0.35rem;
  }
}
</style>
