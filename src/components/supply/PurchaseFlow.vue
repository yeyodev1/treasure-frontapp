<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import BaseDatePicker from '@/components/ui/BaseDatePicker.vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiCreatePurchase, apiPurchases } from '@/services/api'
import { formatMoney, todayKey } from '@/utils/format'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import type { Product, Purchase, StockLocation, WeeklyOrder } from '@/types'
import FlowHeader from './FlowHeader.vue'
import ProductPicker from './ProductPicker.vue'
import QtyStepper from './QtyStepper.vue'
import SummaryModal from './SummaryModal.vue'
import { ACTIVE_LOCATIONS, containerText, conversionText, LOCATION_HINT, LOCATION_ICON, LOCATION_LABEL, plural } from './units'

/**
 * Registrar factura: no mueve stock; suma cuando se recibe. Desde un pedido
 * semanal aprobado (`order`) llega con sus productos y lo pendiente de comprar.
 */
const props = defineProps<{ order?: WeeklyOrder | null }>()
const emit = defineEmits<{ back: []; receive: [purchaseId: string] }>()

const catalog = useCatalogStore()
const toast = useToastStore()
const { play } = useSound()
const save = useSaveAttempt('la factura')

interface Line {
  product: Product
  containers: number
  cost: string
}

const step = shallowRef(0)
const form = reactive({
  supplier: '',
  document: '',
  date: todayKey(),
  destination: 'puerto' as StockLocation,
  note: '',
})
const lines = ref<Line[]>([])
const picking = shallowRef(false)
const reviewing = shallowRef(false)
const tried = shallowRef(false)
const suppliers = shallowRef<string[]>([])
const saved = shallowRef<Purchase | null>(null)

onMounted(async () => {
  try {
    await catalog.load(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
  if (props.order) {
    // Lo pendiente de comprar del pedido: se ajusta a lo que realmente se compró.
    for (const l of props.order.lines.filter((x) => x.toBuy > 0)) {
      const product = catalog.physical.find((p) => p._id === l.product)
      if (product) addProduct(product, l.toBuy)
    }
  }
  try {
    const { purchases } = await apiPurchases()
    suppliers.value = [...new Set(purchases.map((p) => p.supplier))].slice(0, 6)
  } catch {
    // Sin sugerencias: se escribe a mano.
  }
})

const headerOk = computed(() => form.supplier.trim() && form.document.trim())

function costOf(line: Line): number {
  const value = Number(line.cost.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : 0
}

const total = computed(() => lines.value.reduce((s, l) => s + l.containers * costOf(l), 0))
const withoutCost = computed(() => lines.value.filter((l) => !costOf(l)).length)
const linesOk = computed(() => lines.value.length > 0 && lines.value.every((l) => l.containers > 0))

function next() {
  tried.value = true
  if (!headerOk.value) {
    play('error')
    return
  }
  tried.value = false
  step.value = 1
}

/** Con pedido: solo sus productos (lo demás va en una compra aparte). */
const pickable = computed(() =>
  props.order ? catalog.physical.filter((p) => props.order!.lines.some((l) => l.product === p._id)) : catalog.physical,
)

function addProduct(product: Product, containers = 1) {
  picking.value = false
  const last = product.costPerUnit ? product.costPerUnit * (product.containerSize || 1) : 0
  lines.value.push({ product, containers, cost: last ? last.toFixed(2).replace('.', ',') : '' })
}

function removeLine(index: number) {
  lines.value.splice(index, 1)
  play('tap')
}

function review() {
  if (!linesOk.value) {
    play('error')
    return
  }
  if (!save.offline.value) save.reset()
  reviewing.value = true
}

async function confirm() {
  const result = await save.run((key) =>
    apiCreatePurchase({
      supplier: form.supplier.trim(),
      document: form.document.trim(),
      documentDate: form.date || undefined,
      destination: form.destination,
      lines: lines.value.map((l) => ({
        productId: l.product._id,
        containers: l.containers,
        containerCost: costOf(l),
      })),
      note: form.note.trim() || undefined,
      idempotencyKey: key,
      weeklyOrderId: props.order?._id,
    }),
  )
  if (result.ok) {
    saved.value = result.value
    play('success')
  } else {
    play('error')
  }
}

function goStep(index: number) {
  if (index < step.value) step.value = index
}

const dateLabel = computed(() => {
  if (!form.date) return 'Sin fecha'
  const [y, m, d] = form.date.split('-')
  return `${d}/${m}/${y}`
})
</script>

<template>
  <section class="flow">
    <FlowHeader
      :title="order ? `Registrar compra · pedido ${order.code}` : 'Registrar compra'"
      icon="fa-file-invoice-dollar"
      :steps="['Factura', 'Productos', 'Confirmar']"
      :current="reviewing ? 2 : step"
      @back="emit('back')"
      @go="goStep"
    />

    <Transition name="slide" mode="out-in">
      <!-- Paso 1: datos de la factura -->
      <div v-if="step === 0" key="factura" class="card pane">
        <p class="lead">Copia los datos de la factura o guía del proveedor.</p>

        <div class="field">
          <label for="pf-supplier">Proveedor</label>
          <input
            id="pf-supplier"
            v-model="form.supplier"
            type="text"
            autocomplete="off"
            placeholder="Ej. Distribuidora Galápagos"
            :class="{ invalid: tried && !form.supplier.trim() }"
          />
          <div v-if="suppliers.length" class="chips">
            <button
              v-for="s in suppliers"
              :key="s"
              type="button"
              class="chip"
              :class="{ on: form.supplier === s }"
              @click="form.supplier = s"
            >
              {{ s }}
            </button>
          </div>
          <small v-if="tried && !form.supplier.trim()" class="err">Escribe el proveedor.</small>
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="pf-doc">Número de factura o guía</label>
            <input
              id="pf-doc"
              v-model="form.document"
              type="text"
              autocomplete="off"
              placeholder="Ej. 001-002-000123"
              :class="{ invalid: tried && !form.document.trim() }"
            />
            <small v-if="tried && !form.document.trim()" class="err">Escribe el número del documento.</small>
          </div>
          <div class="field">
            <label>Fecha de la factura</label>
            <BaseDatePicker v-model="form.date" placeholder="Elige la fecha" />
          </div>
        </div>

        <div class="field">
          <label>¿A dónde llega la mercadería?</label>
          <div class="dest">
            <button
              v-for="loc in ACTIVE_LOCATIONS"
              :key="loc"
              type="button"
              class="dest-btn"
              :class="{ on: form.destination === loc }"
              :aria-pressed="form.destination === loc"
              @click="form.destination = loc"
            >
              <i class="fa-solid" :class="LOCATION_ICON[loc]" aria-hidden="true" />
              <strong>{{ LOCATION_LABEL[loc] }}</strong>
              <small>{{ LOCATION_HINT[loc] }}</small>
              <i v-if="form.destination === loc" class="fa-solid fa-circle-check tick" aria-hidden="true" />
            </button>
          </div>
          <small class="muted">Si una parte llega a Quito y otra al puerto, al recibir eliges dónde llegó cada entrega.</small>
        </div>

        <div class="field">
          <label for="pf-note">Nota (opcional)</label>
          <input id="pf-note" v-model="form.note" type="text" placeholder="Ej. entrega parcial prometida para el lunes" />
        </div>

        <div class="footer">
          <button type="button" class="btn btn-primary big" @click="next">
            Siguiente: productos <i class="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- Paso 2: productos -->
      <div v-else key="productos" class="pane">
        <div class="card context">
          <span><i class="fa-solid fa-truck" aria-hidden="true" /> {{ form.supplier }}</span>
          <span><i class="fa-solid fa-file-lines" aria-hidden="true" /> {{ form.document }}</span>
          <span><i class="fa-regular fa-calendar" aria-hidden="true" /> {{ dateLabel }}</span>
          <span><i class="fa-solid fa-location-dot" aria-hidden="true" /> Llega a: {{ LOCATION_LABEL[form.destination] }}</span>
        </div>

        <TransitionGroup tag="div" name="line" class="lines">
          <article v-for="(line, i) in lines" :key="line.product._id" class="card line">
            <header class="line-head">
              <ProductIcon :icon="line.product.icon" :size="26" />
              <strong>{{ line.product.name }}</strong>
              <button type="button" class="remove" :aria-label="`Quitar ${line.product.name}`" @click="removeLine(i)">
                <i class="fa-solid fa-trash-can" aria-hidden="true" />
              </button>
            </header>
            <div class="line-body">
              <div class="line-qty">
                <span class="mini-label">Cantidad de {{ plural(line.product.containerLabel, 2) }}</span>
                <QtyStepper
                  v-model="line.containers"
                  :min="0"
                  :label="`${plural(line.product.containerLabel, 2)} de ${line.product.name}`"
                  :unit="plural(line.product.containerLabel, line.containers)"
                />
                <span v-if="line.containers > 0" class="conv">{{ conversionText(line.containers, line.product) }}</span>
              </div>
              <div class="line-cost">
                <label class="mini-label" :for="`cost-${line.product._id}`">Costo por {{ line.product.containerLabel }}</label>
                <div class="money">
                  <span>$</span>
                  <input
                    :id="`cost-${line.product._id}`"
                    v-model="line.cost"
                    type="text"
                    inputmode="decimal"
                    placeholder="0,00"
                  />
                </div>
                <span class="conv">
                  Subtotal {{ formatMoney(line.containers > 0 ? line.containers * costOf(line) : 0) }}
                </span>
              </div>
            </div>
          </article>
        </TransitionGroup>

        <button type="button" class="add" @click="picking = true">
          <i class="fa-solid fa-plus" aria-hidden="true" />
          {{ lines.length ? 'Agregar otro producto' : 'Agregar el primer producto' }}
        </button>

        <div class="card totals">
          <span>{{ lines.length }} producto(s)</span>
          <strong>Total factura {{ formatMoney(total) }}</strong>
          <small v-if="withoutCost" class="warn">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            {{ withoutCost }} sin costo: el margen quedará incompleto.
          </small>
        </div>

        <div class="footer">
          <button type="button" class="btn btn-ghost big" @click="step = 0">
            <i class="fa-solid fa-arrow-left" aria-hidden="true" /> Factura
          </button>
          <button type="button" class="btn btn-gold big" :disabled="!linesOk" @click="review">
            Revisar y registrar <i class="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
        </div>
      </div>
    </Transition>

    <ProductPicker
      v-if="picking"
      title="Producto de la factura"
      :products="pickable"
      :taken="lines.map((l) => l.product._id)"
      @pick="addProduct"
      @close="picking = false"
    />

    <SummaryModal
      v-if="reviewing"
      title="Confirmar factura"
      confirm-label="Registrar factura"
      :state="save.state.value"
      :message="save.message.value"
      :offline="save.offline.value"
      :saved-text="saved ? `Guardado · ${saved.code}` : 'Guardado'"
      notice="Registrar la factura no suma stock. El stock sube cuando marques lo que llegó en Recibir mercadería."
      @confirm="confirm"
      @close="reviewing = false"
      @done="emit('back')"
    >
      <dl class="sum-head">
        <div><dt>Proveedor</dt><dd>{{ form.supplier }}</dd></div>
        <div><dt>Documento</dt><dd>{{ form.document }}</dd></div>
        <div><dt>Fecha</dt><dd>{{ dateLabel }}</dd></div>
        <div><dt>Llega a</dt><dd>{{ LOCATION_LABEL[form.destination] }}</dd></div>
      </dl>
      <ul class="sum-lines">
        <li v-for="line in lines" :key="line.product._id">
          <span>
            <strong>{{ line.product.name }}</strong>
            <small>{{ conversionText(line.containers, line.product) }}</small>
          </span>
          <span class="sum-money">
            {{ costOf(line) ? `${containerText(line.containers, line.product)} × ${formatMoney(costOf(line))}` : 'Sin costo' }}
            <strong>{{ formatMoney(line.containers * costOf(line)) }}</strong>
          </span>
        </li>
      </ul>
      <p class="sum-total">Total {{ formatMoney(total) }}</p>
      <template #saved>
        <button
          v-if="saved"
          type="button"
          class="btn btn-gold wide"
          @click="emit('receive', saved._id)"
        >
          <i class="fa-solid fa-box-open" aria-hidden="true" /> Ya llegó: recibir ahora
        </button>
      </template>
    </SummaryModal>
  </section>
</template>

<style scoped lang="scss">
@use './flow' as *;
</style>
