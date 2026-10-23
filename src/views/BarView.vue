<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useConfirmStore } from '@/stores/confirm'
import { usePosCart } from '@/composables/usePosCart'
import { useSound } from '@/composables/useSound'
import { apiCreateOrder, apiOrders } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import CabinPicker from '@/components/pos/CabinPicker.vue'
import ProductCatalog from '@/components/pos/ProductCatalog.vue'
import OrderCart from '@/components/pos/OrderCart.vue'
import CocktailBuilder from '@/components/pos/CocktailBuilder.vue'
import PendingOrders from '@/components/pos/PendingOrders.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import type { Product } from '@/types'

const catalogStore = useCatalogStore()
const cruiseStore = useCruiseStore()
const toast = useToastStore()
const userStore = useUserStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const { sellable, physical } = storeToRefs(catalogStore)
const { active: cruise, cabins } = storeToRefs(cruiseStore)

const cart = usePosCart()
const selectedCabin = shallowRef<number | null>(null)
const showBuilder = shallowRef(false)
const showPending = shallowRef(false)
const showMobileCart = shallowRef(false)
const sending = shallowRef(false)
const loading = shallowRef(true)
const pendingCount = shallowRef(0)

let timer: ReturnType<typeof setInterval> | null = null

const cabin = computed(() => cabins.value.find((c) => c.number === selectedCabin.value) ?? null)
const cruiseLabel = computed(() =>
  cruise.value ? (cruise.value.code ? `Salida ${cruise.value.code}` : cruise.value.name) : '',
)

/** Registrar solo con salida a bordo y cabina con pasajeros (guía V3). */
const blockedReason = computed(() => {
  if (!cruise.value) return 'No hay salida programada. Dirección la crea en Salidas.'
  if (cruise.value.status !== 'abordo') {
    return `${cruiseLabel.value} aún no está a bordo. Dirección la inicia en Salidas.`
  }
  if (!cabin.value) return 'Elige la cabina del pasajero.'
  if (!cabin.value.passengers.length) {
    return `La cabina ${cabin.value.number} no tiene pasajeros registrados.`
  }
  return ''
})

async function refreshPending() {
  if (!cruise.value) return
  try {
    const data = await apiOrders({ cruiseId: cruise.value._id, status: 'pendiente', limit: 200 })
    pendingCount.value = data.orders.length
  } catch {
    // El contador es informativo: si falla se reintenta en el próximo ciclo.
  }
}

onMounted(async () => {
  try {
    await Promise.all([catalogStore.load(true), cruiseStore.loadActive(true)])
    await refreshPending()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
  timer = setInterval(refreshPending, 20000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

function addToCart(product: Product) {
  cart.add(product)
  play('tap')
}

function onEmptyCabin(number: number) {
  toast.push(`La cabina ${number} está vacía: registra sus pasajeros en Salidas`)
}

function onCocktailCreated(product: Product) {
  catalogStore.upsert(product)
  cart.add(product)
  showBuilder.value = false
  play('success')
  toast.success(`Cóctel "${product.name}" creado por ${formatMoney(product.price)}`)
}

async function submitOrder() {
  if (blockedReason.value || !cruise.value || !cabin.value || !cart.lines.value.length) return
  sending.value = true
  try {
    const { duplicated } = await apiCreateOrder({
      cruiseId: cruise.value._id,
      cabinNumber: cabin.value.number,
      idempotencyKey: cart.draftKey.value,
      items: cart.lines.value.map((l) => ({
        productId: l.product._id,
        qty: l.qty,
        courtesy: l.courtesy,
      })),
    })
    play('success')
    toast.success(
      duplicated
        ? 'Ese pedido ya estaba registrado'
        : `Pedido registrado en cabina ${cabin.value.number}. Entrégalo desde "Por entregar".`,
    )
    cart.clear()
    showMobileCart.value = false
    await refreshPending()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    sending.value = false
  }
}

async function cancelDraft() {
  const summary = cart.lines.value.map((l) => `${l.qty} ${l.product.name}`).join(', ')
  const where = cabin.value ? ` de cabina ${cabin.value.number}` : ''
  const ok = await confirmStore.ask({
    title: `¿Cancelar ${summary}${where}?`,
    message: 'Todavía no se registró: se borra la comanda y no queda nada en la cuenta.',
    confirmLabel: 'Sí, cancelar',
    danger: true,
    icon: 'fa-triangle-exclamation',
  })
  if (!ok) return
  cart.clear()
  showMobileCart.value = false
}
</script>

<template>
  <div class="bar">
    <!-- Contexto persistente: salida, cabina y huésped -->
    <header class="context">
      <div class="context-main">
        <i class="fa-solid fa-ship" aria-hidden="true" />
        <span class="context-text">
          <template v-if="cruise">{{ cruiseLabel }}</template>
          <template v-else>Sin salida</template>
          <template v-if="cabin"> · Cabina {{ cabin.number }}</template>
          <template v-if="cabin?.guestName"> · {{ cabin.guestName }}</template>
        </span>
        <span v-if="cruise" class="context-status" :class="`context-status--${cruise.status}`">
          {{ cruise.status === 'abordo' ? 'A bordo' : cruise.status === 'planificado' ? 'Programada' : 'Cerrada' }}
        </span>
      </div>
      <button
        type="button"
        class="pending-btn"
        :disabled="!cruise"
        @click="showPending = true"
      >
        <i class="fa-solid fa-hourglass-half" aria-hidden="true" />
        Ver pedidos pendientes
        <span class="pending-count" :class="{ 'pending-count--on': pendingCount > 0 }">
          {{ pendingCount }}
        </span>
      </button>
    </header>

    <div class="page bar-page">
      <section class="block">
        <h2 class="section-title">Cabina</h2>
        <SkeletonList v-if="loading" variant="tile" :rows="9" />
        <CabinPicker
          v-else
          :cabins="cabins"
          :selected="selectedCabin"
          @select="selectedCabin = $event"
          @empty="onEmptyCabin"
        />
      </section>

      <div class="bar-grid">
        <section class="block">
          <h2 class="section-title">Catálogo</h2>
          <SkeletonList v-if="loading" variant="tile" :rows="12" />
          <ProductCatalog
            v-else
            :products="sellable"
            @add="addToCart"
            @create-cocktail="showBuilder = true"
          />
        </section>

        <!-- Comanda fija al lado en tablet horizontal y computadora -->
        <div class="cart-side">
          <OrderCart
            :lines="cart.lines.value"
            :total="cart.total.value"
            :item-count="cart.itemCount.value"
            :cabin-number="selectedCabin"
            :guest-name="cabin?.guestName ?? ''"
            :can-courtesy="userStore.isLead"
            :sending="sending"
            :blocked-reason="blockedReason"
            @set-qty="cart.setQty"
            @toggle-courtesy="cart.toggleCourtesy"
            @submit="submitOrder"
            @cancel="cancelDraft"
          />
        </div>
      </div>
    </div>

    <!-- En celular y tablet vertical: barra fija que abre la comanda -->
    <Transition name="bar-up">
      <button
        v-if="cart.lines.value.length"
        type="button"
        class="mobile-bar"
        @click="showMobileCart = true"
      >
        <span class="mobile-bar-count">{{ cart.itemCount.value }}</span>
        <span class="mobile-bar-text">
          Comanda<template v-if="selectedCabin"> · Cabina {{ selectedCabin }}</template>
        </span>
        <strong>{{ formatMoney(cart.total.value) }}</strong>
        <i class="fa-solid fa-chevron-up" aria-hidden="true" />
      </button>
    </Transition>

    <BaseModal v-if="showMobileCart" title="Comanda" @close="showMobileCart = false">
      <OrderCart
        :lines="cart.lines.value"
        :total="cart.total.value"
        :item-count="cart.itemCount.value"
        :cabin-number="selectedCabin"
        :guest-name="cabin?.guestName ?? ''"
        :can-courtesy="userStore.isLead"
        :sending="sending"
        :blocked-reason="blockedReason"
        @set-qty="cart.setQty"
        @toggle-courtesy="cart.toggleCourtesy"
        @submit="submitOrder"
        @cancel="cancelDraft"
      />
    </BaseModal>

    <CocktailBuilder
      v-if="showBuilder"
      :physical="physical"
      @close="showBuilder = false"
      @created="onCocktailCreated"
    />

    <PendingOrders
      v-if="showPending && cruise"
      :cruise-id="cruise._id"
      @close="showPending = false"
      @changed="refreshPending"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.bar {
  min-width: 0;
  padding-bottom: calc(84px + env(safe-area-inset-bottom));

  @include desktop {
    padding-bottom: 0;
  }
}

.context {
  position: sticky;
  top: calc(64px + env(safe-area-inset-top));
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.6rem max(16px, env(safe-area-inset-left, 0px));
  background: var(--navy-700);
  color: #fff;

  @include desktop {
    padding: 0.65rem 2rem;
  }
}

.context-main {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;

  > i {
    color: var(--powder-300);
  }
}

.context-text {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-status {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);

  &--abordo {
    background: #4f9a6c;
  }
}

.pending-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 40px;
  padding: 0.35rem 0.5rem 0.35rem 0.85rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(200, 215, 231, 0.4);
  color: #fff;
  font-weight: 600;
  font-size: 0.86rem;
  transition: background 0.15s ease;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.18);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.pending-count {
  min-width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;

  &--on {
    background: var(--gold-500);
  }
}

.block {
  min-width: 0;
}

.section-title {
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-400);
  margin-bottom: 0.55rem;
}

.bar-page > .block {
  margin-bottom: 1.1rem;
}

.bar-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.25rem;

  @include desktop {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 330px);
    align-items: start;
  }
}

.cart-side {
  display: none;

  @include desktop {
    display: block;
    position: sticky;
    top: calc(64px + 62px + 12px);
  }
}

.mobile-bar {
  position: fixed;
  left: max(12px, env(safe-area-inset-left, 0px));
  right: max(12px, env(safe-area-inset-right, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom));
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 58px;
  padding: 0.5rem 1rem 0.5rem 0.6rem;
  border-radius: 16px;
  background: var(--navy-800);
  color: #fff;
  box-shadow: var(--shadow-lg);

  strong {
    margin-left: auto;
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
  }

  @include desktop {
    display: none;
  }
}

.mobile-bar-count {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--gold-500);
  font-weight: 700;
}

.mobile-bar-text {
  font-weight: 600;
}

.bar-up-enter-active,
.bar-up-leave-active {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}

.bar-up-enter-from,
.bar-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>
