<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiMovements, apiRegisterWaste } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import type { Product, StockLocation } from '@/types'
import FlowHeader from './FlowHeader.vue'
import ProductPicker from './ProductPicker.vue'
import SummaryModal from './SummaryModal.vue'
import UnitQty from './UnitQty.vue'
import { baseText, LOCATION_LABEL, noStockError, stockText, toBase, type QtyMode } from './units'

/** Merma o rotura: resta con motivo obligatorio, separada del consumo. */
const emit = defineEmits<{ back: []; changed: [] }>()

const catalog = useCatalogStore()
const toast = useToastStore()
const userStore = useUserStore()
const { play } = useSound()
const save = useSaveAttempt('la merma')

const REASONS = ['Botella rota', 'Lata abierta y no usada', 'Producto vencido', 'Derrame', 'Sobrante de lata']

const form = reactive({
  location: 'bodega' as StockLocation,
  product: null as Product | null,
  qty: 1,
  mode: 'envase' as QtyMode,
  reason: '',
})
const picking = shallowRef(false)
const reviewing = shallowRef(false)
const tried = shallowRef(false)
/** Hubo un envío sin respuesta: antes de repetir se revisa si quedó guardado. */
const unsure = shallowRef<{ since: number } | null>(null)

onMounted(async () => {
  try {
    await catalog.load(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
})

const onHand = computed(() => {
  const p = form.product
  if (!p) return 0
  return form.location === 'bodega' ? p.warehouseStock : p.onboardStock
})
const base = computed(() => (form.product ? toBase(form.qty, form.mode, form.product) : 0))
const exceeds = computed(() => base.value > onHand.value + 1e-9)
const ready = computed(() => Boolean(form.product) && base.value > 0 && !exceeds.value && form.reason.trim().length > 0)

const productsHere = computed(() =>
  catalog.physical.filter((p) => (form.location === 'bodega' ? p.warehouseStock : p.onboardStock) > 0),
)

function setLocation(loc: StockLocation) {
  form.location = loc
  play('tap')
}

function pick(product: Product) {
  picking.value = false
  form.product = product
  form.mode = 'envase'
  form.qty = 1
}

function review() {
  tried.value = true
  if (!ready.value) {
    play('error')
    return
  }
  if (!save.offline.value) save.reset()
  reviewing.value = true
}

/** La merma no lleva clave en el servidor: se busca en la bitácora antes de repetir. */
async function alreadySaved(): Promise<boolean> {
  if (!unsure.value || !form.product) return false
  const { movements } = await apiMovements({
    productId: form.product._id,
    type: 'merma',
    location: form.location,
    limit: 10,
  })
  return movements.some(
    (m) =>
      Math.abs(m.qty + base.value) < 1e-6 &&
      m.reason === form.reason.trim() &&
      m.user?._id === userStore.user?.id &&
      new Date(m.createdAt).getTime() >= unsure.value!.since - 5000,
  )
}

async function confirm() {
  const p = form.product
  if (!p) return
  const since = unsure.value?.since ?? Date.now()
  const result = await save.run(async (key) => {
    if (await alreadySaved()) return
    await apiRegisterWaste({
      productId: p._id,
      qty: base.value,
      reason: form.reason.trim(),
      location: form.location,
      key,
    })
  })
  if (result.ok) {
    unsure.value = null
    play('success')
    emit('changed')
    return
  }
  play('error')
  if (save.offline.value) unsure.value = { since }
  const missing = noStockError(result.error)
  if (missing) {
    reviewing.value = false
    toast.error(`${missing.message}. No se guardó nada.`)
    await catalog.load(true)
    form.product = catalog.physical.find((x) => x._id === p._id) ?? p
  }
}

function done() {
  reviewing.value = false
  emit('back')
}
</script>

<template>
  <section class="flow">
    <FlowHeader
      title="Merma o rotura"
      icon="fa-wine-glass-empty"
      :steps="['Qué se perdió', 'Confirmar']"
      :current="reviewing ? 1 : 0"
      @back="emit('back')"
    />

    <div class="card pane">
      <div class="field">
        <label>¿Dónde pasó?</label>
        <div class="dest">
          <button
            v-for="loc in ['bodega', 'abordo'] as const"
            :key="loc"
            type="button"
            class="dest-btn"
            :class="{ on: form.location === loc }"
            :aria-pressed="form.location === loc"
            @click="setLocation(loc)"
          >
            <i class="fa-solid" :class="loc === 'bodega' ? 'fa-warehouse' : 'fa-ship'" aria-hidden="true" />
            <strong>{{ LOCATION_LABEL[loc] }}</strong>
            <i v-if="form.location === loc" class="fa-solid fa-circle-check tick" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="field">
        <label>Producto</label>
        <button type="button" class="pick" :class="{ invalid: tried && !form.product }" @click="picking = true">
          <template v-if="form.product">
            <ProductIcon :icon="form.product.icon" :size="26" />
            <span class="pick-text">
              <strong>{{ form.product.name }}</strong>
              <small>En {{ LOCATION_LABEL[form.location].toLowerCase() }}: {{ stockText(onHand, form.product) }}</small>
            </span>
            <span class="pick-change">Cambiar</span>
          </template>
          <template v-else>
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <span class="pick-text"><strong>Buscar el producto</strong></span>
          </template>
        </button>
        <small v-if="tried && !form.product" class="err">Elige el producto.</small>
      </div>

      <div v-if="form.product" class="field">
        <label>Cantidad perdida</label>
        <UnitQty
          v-model="form.qty"
          v-model:mode="form.mode"
          :product="form.product"
          :label="`Cantidad perdida de ${form.product.name}`"
          :max-base="onHand"
          allow-base
        />
        <small v-if="exceeds" class="err">Solo hay {{ stockText(onHand, form.product) }} en {{ LOCATION_LABEL[form.location].toLowerCase() }}.</small>
      </div>

      <div class="field">
        <label for="wf-reason">Motivo (obligatorio)</label>
        <div class="chips">
          <button
            v-for="r in REASONS"
            :key="r"
            type="button"
            class="chip"
            :class="{ on: form.reason === r }"
            @click="form.reason = r"
          >
            {{ r }}
          </button>
        </div>
        <input
          id="wf-reason"
          v-model="form.reason"
          type="text"
          placeholder="Cuenta qué pasó"
          :class="{ invalid: tried && !form.reason.trim() }"
        />
        <small v-if="tried && !form.reason.trim()" class="err">Escribe o elige el motivo.</small>
      </div>

      <div class="footer">
        <button type="button" class="btn btn-gold big" :disabled="tried && !ready" @click="review">
          Revisar merma <i class="fa-solid fa-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>

    <ProductPicker
      v-if="picking"
      :title="`Producto en ${LOCATION_LABEL[form.location].toLowerCase()}`"
      :products="productsHere"
      :show="form.location"
      @pick="pick"
      @close="picking = false"
    />

    <SummaryModal
      v-if="reviewing && form.product"
      title="Confirmar merma"
      confirm-label="Registrar merma"
      danger
      :state="save.state.value"
      :message="save.offline.value ? 'No se pudo guardar la merma. Revisa la conexión e inténtalo de nuevo: al reintentar se revisa primero la bitácora y no se duplica.' : save.message.value"
      :offline="save.offline.value"
      saved-text="Guardado · la merma quedó en la bitácora"
      notice="La merma resta del stock y queda separada de los consumos."
      @confirm="confirm"
      @close="reviewing = false"
      @done="done"
    >
      <ul class="sum-lines">
        <li>
          <span>
            <strong>{{ form.product.name }}</strong>
            <small>{{ LOCATION_LABEL[form.location] }} · {{ form.reason }}</small>
          </span>
          <span class="sum-money">
            <strong class="bad">−{{ baseText(base, form.product.stockUnit) }}</strong>
            {{ stockText(base, form.product) }}
          </span>
        </li>
      </ul>
    </SummaryModal>
  </section>
</template>

<style scoped lang="scss">
@use './flow' as *;

.pick {
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  text-align: left;
  transition: border-color 0.15s ease;

  &.invalid {
    border-color: var(--danger);
  }

  > i,
  svg {
    color: var(--gold-500);
    flex-shrink: 0;
  }
}

.pick-text {
  display: flex;
  flex-direction: column;
  min-width: 0;

  small {
    color: var(--ink-400);
  }
}

.pick-change {
  margin-left: auto;
  font-weight: 700;
  color: var(--gold-500);
}

.dest-btn {
  min-height: 72px;
}
</style>
