<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiCreateRequisition } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import type { Product, Requisition } from '@/types'
import FlowHeader from './FlowHeader.vue'
import ProductPicker from './ProductPicker.vue'
import SummaryModal from './SummaryModal.vue'
import UnitQty from './UnitQty.vue'
import { qtyText, stockText, type QtyMode } from './units'

/** El bar pide: producto, cantidad y unidad (envase o ml), o una revisión de inventario. */
const emit = defineEmits<{ back: []; saved: [requisition: Requisition] }>()

const catalog = useCatalogStore()
const toast = useToastStore()
const { play } = useSound()
const save = useSaveAttempt()

interface Line {
  product: Product
  qty: number
  mode: QtyMode
}

const kind = shallowRef<'abastecimiento' | 'revision'>('abastecimiento')
const lines = ref<Line[]>([])
const note = shallowRef('')
const picking = shallowRef(false)
const reviewing = shallowRef(false)
const tried = shallowRef(false)
const saved = shallowRef<Requisition | null>(null)

onMounted(async () => {
  try {
    await catalog.load(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
})

const isRevision = computed(() => kind.value === 'revision')
const ready = computed(
  () =>
    lines.value.length > 0 &&
    (isRevision.value ? note.value.trim().length > 0 : lines.value.every((l) => l.qty > 0)),
)

function setKind(next: 'abastecimiento' | 'revision') {
  kind.value = next
  tried.value = false
  play('tap')
}

function addProduct(product: Product) {
  picking.value = false
  lines.value.push({ product, qty: 1, mode: 'envase' })
}

function removeLine(index: number) {
  lines.value.splice(index, 1)
  play('tap')
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

async function confirm() {
  const result = await save.run((key) =>
    apiCreateRequisition({
      kind: kind.value,
      lines: lines.value.map((l) => ({
        productId: l.product._id,
        qty: isRevision.value ? 0 : l.qty,
        unit: l.mode,
      })),
      note: note.value.trim() || undefined,
      idempotencyKey: key,
    }),
  )
  if (result.ok) {
    saved.value = result.value
    play('success')
  } else {
    play('error')
  }
}

function done() {
  reviewing.value = false
  if (saved.value) emit('saved', saved.value)
}
</script>

<template>
  <section class="flow">
    <FlowHeader
      title="Solicitar abastecimiento"
      icon="fa-hand-holding-droplet"
      :steps="['Qué necesitas', 'Enviar']"
      :current="reviewing ? 1 : 0"
      back-label="Abastecimiento"
      @back="emit('back')"
    />

    <div class="pane">
      <div class="dest">
        <button
          type="button"
          class="dest-btn"
          :class="{ on: !isRevision }"
          :aria-pressed="!isRevision"
          @click="setKind('abastecimiento')"
        >
          <i class="fa-solid fa-dolly" aria-hidden="true" />
          <strong>Pedir producto</strong>
          <small>Falta en el bar y lo debe subir bodega</small>
          <i v-if="!isRevision" class="fa-solid fa-circle-check tick" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="dest-btn"
          :class="{ on: isRevision }"
          :aria-pressed="isRevision"
          @click="setKind('revision')"
        >
          <i class="fa-solid fa-magnifying-glass-chart" aria-hidden="true" />
          <strong>Revisión de inventario</strong>
          <small>El sistema dice una cosa y en la barra hay otra</small>
          <i v-if="isRevision" class="fa-solid fa-circle-check tick" aria-hidden="true" />
        </button>
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
          <span class="line-sub">A bordo según el sistema: {{ stockText(line.product.onboardStock, line.product) }}</span>
          <UnitQty
            v-if="!isRevision"
            v-model="line.qty"
            v-model:mode="line.mode"
            :product="line.product"
            :label="`Cantidad de ${line.product.name}`"
            allow-base
          />
        </article>
      </TransitionGroup>

      <button type="button" class="add" @click="picking = true">
        <i class="fa-solid fa-plus" aria-hidden="true" />
        {{ lines.length ? 'Agregar otro producto' : 'Elegir producto' }}
      </button>
      <small v-if="tried && !lines.length" class="err">Elige al menos un producto.</small>

      <div class="field">
        <label for="rq-note">{{ isRevision ? 'Qué ves (obligatorio)' : 'Nota (opcional)' }}</label>
        <input
          id="rq-note"
          v-model="note"
          type="text"
          :placeholder="isRevision ? 'Ej. el sistema dice 0 pero hay 1 botella en la barra' : 'Ej. para la cena de mañana'"
          :class="{ invalid: tried && isRevision && !note.trim() }"
        />
        <small v-if="tried && isRevision && !note.trim()" class="err">Cuenta qué ves para que bodega lo revise.</small>
      </div>

      <div class="footer">
        <button type="button" class="btn btn-gold big" @click="review">
          Revisar y enviar <i class="fa-solid fa-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>

    <ProductPicker
      v-if="picking"
      title="¿Qué necesitas?"
      :products="catalog.physical"
      show="abordo"
      :taken="lines.map((l) => l.product._id)"
      @pick="addProduct"
      @close="picking = false"
    />

    <SummaryModal
      v-if="reviewing"
      :title="isRevision ? 'Enviar revisión de inventario' : 'Enviar requerimiento'"
      :confirm-label="isRevision ? 'Enviar revisión' : 'Enviar a la directora'"
      :state="save.state.value"
      :message="save.message.value"
      :offline="save.offline.value"
      :saved-text="saved ? `Guardado · ${saved.code} enviado` : 'Guardado'"
      :notice="isRevision ? 'Bodega o la administradora lo revisan con un conteo.' : 'La directora lo aprueba y bodega lo sube al barco. Hasta entonces el stock no cambia.'"
      @confirm="confirm"
      @close="reviewing = false"
      @done="done"
    >
      <ul class="sum-lines">
        <li v-for="line in lines" :key="line.product._id">
          <span>
            <strong>{{ line.product.name }}</strong>
            <small v-if="isRevision">Revisión de inventario</small>
          </span>
          <span v-if="!isRevision" class="sum-money">
            <strong>{{ qtyText(line.qty, line.mode, line.product) }}</strong>
          </span>
        </li>
      </ul>
      <p v-if="note.trim()" class="lead">Nota: {{ note }}</p>
    </SummaryModal>
  </section>
</template>

<style scoped lang="scss">
@use './flow' as *;

.dest-btn {
  min-height: 110px;
}
</style>
