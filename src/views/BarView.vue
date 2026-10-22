<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useCruiseStore } from '@/stores/cruise'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { usePosCart } from '@/composables/usePosCart'
import { apiCreateOrder } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import CabinPicker from '@/components/pos/CabinPicker.vue'
import ProductCatalog from '@/components/pos/ProductCatalog.vue'
import OrderCart from '@/components/pos/OrderCart.vue'
import CocktailBuilder from '@/components/pos/CocktailBuilder.vue'
import type { Product } from '@/types'

const catalogStore = useCatalogStore()
const cruiseStore = useCruiseStore()
const toast = useToastStore()
const userStore = useUserStore()

const { products } = storeToRefs(catalogStore)
const { active: cruise, cabins } = storeToRefs(cruiseStore)

const cart = usePosCart()
const selectedCabin = shallowRef<number | null>(null)
const showBuilder = shallowRef(false)
const sending = shallowRef(false)

onMounted(async () => {
  try {
    await Promise.all([catalogStore.load(), cruiseStore.loadActive()])
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
})

function onCocktailCreated(product: Product) {
  catalogStore.upsert(product)
  cart.add(product)
  showBuilder.value = false
  toast.success(`Cóctel "${product.name}" creado`)
}

async function submitOrder() {
  if (!cruise.value || !selectedCabin.value || !cart.lines.value.length) return
  sending.value = true
  try {
    await apiCreateOrder({
      cruiseId: cruise.value._id,
      cabinNumber: selectedCabin.value,
      items: cart.lines.value.map((l) => ({
        productId: l.product._id,
        qty: l.qty,
        courtesy: l.courtesy,
      })),
    })
    toast.success(`Pedido enviado a cabina ${selectedCabin.value}`)
    cart.clear()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="page bar">
    <header class="bar-head">
      <h1 class="page-title">Bar</h1>
      <p v-if="cruise" class="bar-cruise">
        {{ cruise.name }}
        <span class="bar-status" :class="`bar-status--${cruise.status}`">{{ cruise.status }}</span>
      </p>
      <p v-else class="bar-cruise bar-cruise--none">
        No hay crucero activo: créalo desde Cruceros.
      </p>
    </header>

    <section class="bar-cabins">
      <h2 class="section-title">Cabina</h2>
      <CabinPicker
        :cabins="cabins"
        :selected="selectedCabin"
        @select="selectedCabin = $event"
      />
    </section>

    <div class="bar-grid">
      <section>
        <h2 class="section-title">Catálogo</h2>
        <ProductCatalog
          :products="products"
          @add="cart.add"
          @create-cocktail="showBuilder = true"
        />
      </section>

      <OrderCart
        :lines="cart.lines.value"
        :total="cart.total.value"
        :cabin-number="selectedCabin"
        :can-courtesy="userStore.canCollect"
        :sending="sending"
        @set-qty="cart.setQty"
        @toggle-courtesy="cart.toggleCourtesy"
        @submit="submitOrder"
        @clear="cart.clear"
      />
    </div>

    <CocktailBuilder
      v-if="showBuilder"
      :products="products"
      @close="showBuilder = false"
      @created="onCocktailCreated"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.bar-head {
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.bar-cruise {
  margin: 0;
  color: var(--ink-600);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;

  &--none {
    color: var(--warning);
  }
}

.bar-status {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--cream-200);

  &--abordo {
    background: rgba(63, 174, 106, 0.15);
    color: var(--success);
  }
}

.section-title {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-400);
  margin-bottom: 0.5rem;
}

.bar-cabins {
  margin-bottom: 1.25rem;
}

.bar-grid {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;

  @include desktop {
    display: grid;
    grid-template-columns: 1fr 340px;
    align-items: start;
  }
}
</style>
