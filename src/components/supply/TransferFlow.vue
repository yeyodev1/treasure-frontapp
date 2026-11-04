<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiTransfer } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import type { Product, StockLocation } from '@/types'
import FlowHeader from './FlowHeader.vue'
import ProductPicker from './ProductPicker.vue'
import SummaryModal from './SummaryModal.vue'
import UnitQty from './UnitQty.vue'
import {
  ACTIVE_LOCATIONS,
  ALL_LOCATIONS,
  baseText,
  LOCATION_ICON,
  LOCATION_IN,
  LOCATION_LABEL,
  noStockError,
  stockAt,
  stockText,
  toBase,
  type QtyMode,
} from './units'

/**
 * Traslado entre ubicaciones (Quito → Puerto, Puerto → A bordo…). Se registra
 * cuando la mercadería llega: no hay paso "en tránsito" y el total no cambia.
 */
const props = withDefaults(defineProps<{ from?: StockLocation; to?: StockLocation }>(), { from: 'puerto', to: 'abordo' })
const emit = defineEmits<{ back: []; changed: [] }>()

const catalog = useCatalogStore()
const toast = useToastStore()
const { play } = useSound()
const save = useSaveAttempt('la carga')

interface Line {
  product: Product
  qty: number
  mode: QtyMode
}

const from = shallowRef<StockLocation>(props.from)
const to = shallowRef<StockLocation>(props.to)
/** La bodega sin separar solo aparece como origen mientras tenga saldo. */
const fromOptions = computed(() =>
  ALL_LOCATIONS.filter((l) => l !== 'bodega' || catalog.physical.some((p) => p.warehouseStock > 0)),
)
const toOptions = computed(() => ACTIVE_LOCATIONS.filter((l) => l !== from.value))

function setFrom(loc: StockLocation) {
  from.value = loc
  if (to.value === loc) to.value = toOptions.value[0]!
  lines.value = []
}

const lines = ref<Line[]>([])
const picking = shallowRef(false)
const reviewing = shallowRef(false)
const missingId = shallowRef<string | null>(null)
const failure = shallowRef('')

async function refreshStock() {
  try {
    await catalog.load(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
  // Las líneas apuntan al producto recién leído (saldo actualizado).
  lines.value = lines.value.map((l) => ({
    ...l,
    product: catalog.physical.find((p) => p._id === l.product._id) ?? l.product,
  }))
}

onMounted(refreshStock)

const available = computed(() => catalog.physical.filter((p) => stockAt(p, from.value) > 0))
const fromStock = (p: Product) => stockAt(p, from.value)

function baseOf(line: Line): number {
  return toBase(line.qty, line.mode, line.product)
}

function exceeds(line: Line): boolean {
  return baseOf(line) > fromStock(line.product) + 1e-9
}

const ready = computed(
  () => lines.value.length > 0 && lines.value.every((l) => baseOf(l) > 0 && !exceeds(l)),
)

function addProduct(product: Product) {
  picking.value = false
  const mode: QtyMode = 'envase'
  const oneContainer = product.containerSize || 1
  lines.value.push({
    product,
    mode,
    qty: fromStock(product) >= oneContainer ? 1 : 0,
  })
  failure.value = ''
}

function removeLine(index: number) {
  lines.value.splice(index, 1)
  play('tap')
}

function review() {
  if (!ready.value) {
    play('error')
    return
  }
  missingId.value = null
  failure.value = ''
  if (!save.offline.value) save.reset()
  reviewing.value = true
}

async function confirm() {
  const result = await save.run((key) =>
    apiTransfer(
      lines.value.map((l) => ({ productId: l.product._id, qty: baseOf(l) })),
      key,
      from.value,
      to.value,
    ),
  )
  if (result.ok) {
    play('success')
    emit('changed')
    return
  }
  play('error')
  const missing = noStockError(result.error)
  if (missing) {
    // Sin stock: el servidor no guardó nada. Volvemos al formulario con el saldo real.
    reviewing.value = false
    missingId.value = missing.productId
    failure.value = `${missing.message}. No se guardó nada: corrige la cantidad y vuelve a intentar.`
    await refreshStock()
  }
}

function done() {
  reviewing.value = false
  lines.value = []
  void refreshStock()
  emit('back')
}
</script>

<template>
  <section class="flow">
    <FlowHeader
      :title="to === 'abordo' ? 'Cargar al barco' : 'Trasladar mercadería'"
      icon="fa-dolly"
      :steps="['Productos', 'Confirmar']"
      :current="reviewing ? 1 : 0"
      @back="emit('back')"
    />

    <div class="pane">
      <p class="lead">
        Regístralo cuando la mercadería llega: sale {{ LOCATION_IN[from] }} y entra {{ LOCATION_IN[to] }}. El total no cambia.
      </p>

      <div class="card route">
        <div class="field">
          <label>Sale de</label>
          <div class="dest">
            <button
              v-for="loc in fromOptions"
              :key="loc"
              type="button"
              class="dest-btn"
              :class="{ on: from === loc }"
              :aria-pressed="from === loc"
              @click="setFrom(loc)"
            >
              <i class="fa-solid" :class="LOCATION_ICON[loc]" aria-hidden="true" />
              <strong>{{ LOCATION_LABEL[loc] }}</strong>
              <i v-if="from === loc" class="fa-solid fa-circle-check tick" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="field">
          <label>Llega a</label>
          <div class="dest">
            <button
              v-for="loc in toOptions"
              :key="loc"
              type="button"
              class="dest-btn"
              :class="{ on: to === loc }"
              :aria-pressed="to === loc"
              @click="to = loc"
            >
              <i class="fa-solid" :class="LOCATION_ICON[loc]" aria-hidden="true" />
              <strong>{{ LOCATION_LABEL[loc] }}</strong>
              <i v-if="to === loc" class="fa-solid fa-circle-check tick" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <Transition name="status">
        <p v-if="failure" class="card alert" role="alert">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ failure }}
        </p>
      </Transition>

      <TransitionGroup tag="div" name="line" class="lines">
        <article
          v-for="(line, i) in lines"
          :key="line.product._id"
          class="card line"
          :class="{ 'line--bad': exceeds(line) || missingId === line.product._id }"
        >
          <header class="line-head">
            <ProductIcon :icon="line.product.icon" :size="26" />
            <strong>{{ line.product.name }}</strong>
            <button type="button" class="remove" :aria-label="`Quitar ${line.product.name}`" @click="removeLine(i)">
              <i class="fa-solid fa-trash-can" aria-hidden="true" />
            </button>
          </header>
          <div class="balances">
            <span><i class="fa-solid" :class="LOCATION_ICON[from]" aria-hidden="true" /> {{ LOCATION_LABEL[from] }}: <strong>{{ stockText(fromStock(line.product), line.product) }}</strong></span>
            <span><i class="fa-solid" :class="LOCATION_ICON[to]" aria-hidden="true" /> {{ LOCATION_LABEL[to] }}: {{ stockText(stockAt(line.product, to), line.product) }}</span>
          </div>
          <UnitQty
            v-model="line.qty"
            v-model:mode="line.mode"
            :product="line.product"
            :label="`Cantidad de ${line.product.name}`"
            :max-base="fromStock(line.product)"
            allow-base
          />
          <small v-if="exceeds(line)" class="err">
            Solo hay {{ stockText(fromStock(line.product), line.product) }} {{ LOCATION_IN[from] }}.
          </small>
          <small v-else-if="baseOf(line) > 0" class="muted">
            Quedan {{ LOCATION_IN[from] }} {{ baseText(fromStock(line.product) - baseOf(line), line.product.stockUnit) }}
          </small>
        </article>
      </TransitionGroup>

      <button type="button" class="add" @click="picking = true">
        <i class="fa-solid fa-plus" aria-hidden="true" />
        {{ lines.length ? 'Agregar otro producto' : `Elegir producto ${LOCATION_IN[from]}` }}
      </button>

      <div class="footer">
        <button type="button" class="btn btn-gold big" :disabled="!ready" @click="review">
          Revisar traslado <i class="fa-solid fa-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>

    <ProductPicker
      v-if="picking"
      :title="`¿Qué llega ${LOCATION_IN[to]}?`"
      :products="available"
      :show="from"
      :taken="lines.map((l) => l.product._id)"
      @pick="addProduct"
      @close="picking = false"
    />

    <SummaryModal
      v-if="reviewing"
      :title="`Confirmar traslado: ${LOCATION_LABEL[from]} → ${LOCATION_LABEL[to]}`"
      confirm-label="Registrar traslado"
      :state="save.state.value"
      :message="save.message.value"
      :offline="save.offline.value"
      :saved-text="`Guardado · ${LOCATION_LABEL[from]} bajó y ${LOCATION_LABEL[to]} subió lo mismo`"
      :notice="`${LOCATION_LABEL[from]} baja y ${LOCATION_LABEL[to]} sube la misma cantidad. El total general no cambia.`"
      @confirm="confirm"
      @close="reviewing = false"
      @done="done"
    >
      <ul class="sum-lines">
        <li v-for="line in lines" :key="line.product._id">
          <span>
            <strong>{{ line.product.name }}</strong>
            <small>{{ LOCATION_LABEL[from] }} −{{ baseText(baseOf(line), line.product.stockUnit) }} · {{ LOCATION_LABEL[to] }} +{{ baseText(baseOf(line), line.product.stockUnit) }}</small>
          </span>
          <span class="sum-money">
            <strong>{{ stockText(baseOf(line), line.product) }}</strong>
          </span>
        </li>
      </ul>
    </SummaryModal>
  </section>
</template>

<style scoped lang="scss">
@use './flow' as *;

.route {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin-bottom: 1rem;
}

.balances {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.2rem;
  font-size: 0.9rem;
  color: var(--ink-600);

  i {
    color: var(--gold-500);
    margin-right: 0.2rem;
  }
}

.alert {
  margin: 0;
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  color: var(--danger);
  font-weight: 700;
  background: rgba(180, 72, 59, 0.08);
  box-shadow: 0 0 0 2px rgba(180, 72, 59, 0.35);
}

.status-enter-active,
.status-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.status-enter-from,
.status-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
