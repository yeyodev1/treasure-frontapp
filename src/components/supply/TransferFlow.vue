<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiTransfer } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import type { Product } from '@/types'
import FlowHeader from './FlowHeader.vue'
import ProductPicker from './ProductPicker.vue'
import SummaryModal from './SummaryModal.vue'
import UnitQty from './UnitQty.vue'
import { baseText, noStockError, stockText, toBase, type QtyMode } from './units'

/** Cargar al barco: bodega → a bordo, con el saldo de bodega a la vista. */
const emit = defineEmits<{ back: []; changed: [] }>()

const catalog = useCatalogStore()
const toast = useToastStore()
const { play } = useSound()
const save = useSaveAttempt()

interface Line {
  product: Product
  qty: number
  mode: QtyMode
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

const available = computed(() => catalog.physical.filter((p) => p.warehouseStock > 0))

function baseOf(line: Line): number {
  return toBase(line.qty, line.mode, line.product)
}

function exceeds(line: Line): boolean {
  return baseOf(line) > line.product.warehouseStock + 1e-9
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
    qty: product.warehouseStock >= oneContainer ? 1 : 0,
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
      title="Cargar al barco"
      icon="fa-dolly"
      :steps="['Productos', 'Confirmar']"
      :current="reviewing ? 1 : 0"
      @back="emit('back')"
    />

    <div class="pane">
      <p class="lead">
        Sale de bodega y llega a bordo. Elige cada producto y cuántos envases subes al barco.
      </p>

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
            <span><i class="fa-solid fa-warehouse" aria-hidden="true" /> En bodega: <strong>{{ stockText(line.product.warehouseStock, line.product) }}</strong></span>
            <span><i class="fa-solid fa-ship" aria-hidden="true" /> A bordo: {{ stockText(line.product.onboardStock, line.product) }}</span>
          </div>
          <UnitQty
            v-model="line.qty"
            v-model:mode="line.mode"
            :product="line.product"
            :label="`Cantidad de ${line.product.name}`"
            :max-base="line.product.warehouseStock"
            allow-base
          />
          <small v-if="exceeds(line)" class="err">
            Solo hay {{ stockText(line.product.warehouseStock, line.product) }} en bodega.
          </small>
          <small v-else-if="baseOf(line) > 0" class="muted">
            Quedan en bodega {{ baseText(line.product.warehouseStock - baseOf(line), line.product.stockUnit) }}
          </small>
        </article>
      </TransitionGroup>

      <button type="button" class="add" @click="picking = true">
        <i class="fa-solid fa-plus" aria-hidden="true" />
        {{ lines.length ? 'Agregar otro producto' : 'Elegir producto de bodega' }}
      </button>

      <div class="footer">
        <button type="button" class="btn btn-gold big" :disabled="!ready" @click="review">
          Revisar y cargar <i class="fa-solid fa-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>

    <ProductPicker
      v-if="picking"
      title="¿Qué subes al barco?"
      :products="available"
      show="ambos"
      :taken="lines.map((l) => l.product._id)"
      @pick="addProduct"
      @close="picking = false"
    />

    <SummaryModal
      v-if="reviewing"
      title="Confirmar carga al barco"
      confirm-label="Cargar al barco"
      :state="save.state.value"
      :message="save.message.value"
      :offline="save.offline.value"
      saved-text="Guardado · bodega bajó y a bordo subió lo mismo"
      notice="Bodega baja y a bordo sube la misma cantidad. El total general no cambia."
      @confirm="confirm"
      @close="reviewing = false"
      @done="done"
    >
      <ul class="sum-lines">
        <li v-for="line in lines" :key="line.product._id">
          <span>
            <strong>{{ line.product.name }}</strong>
            <small>Bodega −{{ baseText(baseOf(line), line.product.stockUnit) }} · A bordo +{{ baseText(baseOf(line), line.product.stockUnit) }}</small>
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
