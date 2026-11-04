<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useSound } from '@/composables/useSound'
import { useSaveAttempt } from '@/composables/useSaveAttempt'
import { apiReceiveRequisition } from '@/services/api'
import { formatDateTime } from '@/utils/format'
import type { Requisition, StockLocation } from '@/types'
import FlowHeader from './FlowHeader.vue'
import StatusPill from './StatusPill.vue'
import SummaryModal from './SummaryModal.vue'
import UnitQty from './UnitQty.vue'
import {
  baseText,
  LOCATION_ICON,
  LOCATION_IN,
  LOCATION_LABEL,
  stockAt,
  hasContainer,
  missingText,
  noStockError,
  personName,
  requisitionUnit,
  stockText,
  toBase,
  toContainers,
  type QtyMode,
} from './units'

/**
 * Recepción física de un requerimiento aprobado: lo que llega se traslada
 * del origen (Puerto por defecto, o Quito / bodega sin separar) al barco. Se
 * puede recibir en envases o ml; la API va en unidad base.
 */
const props = defineProps<{ requisition: Requisition; backLabel?: string }>()
const emit = defineEmits<{ back: []; saved: [requisition: Requisition] }>()

const { play } = useSound()
const save = useSaveAttempt('la recepción')

interface Pick {
  qty: number
  mode: QtyMode
}

const current = shallowRef<Requisition>(props.requisition)
const from = shallowRef<StockLocation>('puerto')
/** La bodega sin separar solo se ofrece si alguna línea todavía tiene saldo ahí. */
const fromOptions = computed<StockLocation[]>(() => {
  const list: StockLocation[] = ['puerto', 'quito']
  if (current.value.lines.some((l) => (requisitionUnit(l).warehouseStock ?? 0) > 0)) list.push('bodega')
  return list
})
const note = shallowRef('')
const reviewing = shallowRef(false)
const failure = shallowRef('')
const missingId = shallowRef<string | null>(null)

function pendingBase(index: number): number {
  const line = current.value.lines[index]
  if (!line) return 0
  return Math.max(0, Math.round((line.qty - line.receivedQty) * 100) / 100)
}

/** Valor inicial: lo pendiente, en envases si es exacto; si no, en ml. */
function initialPick(index: number): Pick {
  const line = current.value.lines[index]!
  const info = requisitionUnit(line)
  const pending = pendingBase(index)
  if (hasContainer(info) && Number.isInteger(toContainers(pending, info))) {
    return { mode: 'envase', qty: toContainers(pending, info) }
  }
  return { mode: hasContainer(info) ? 'base' : 'envase', qty: hasContainer(info) ? pending : toContainers(pending, info) }
}

const picks = ref<Pick[]>(current.value.lines.map((_, i) => initialPick(i)))

function baseOf(index: number): number {
  const line = current.value.lines[index]
  const pick = picks.value[index]
  if (!line || !pick) return 0
  return toBase(pick.qty, pick.mode, requisitionUnit(line))
}

function warehouseOf(index: number): number | undefined {
  const line = current.value.lines[index]
  if (!line || typeof line.product === 'string') return undefined
  return stockAt(requisitionUnit(line), from.value)
}

function shortOfStock(index: number): boolean {
  const stock = warehouseOf(index)
  return stock !== undefined && baseOf(index) > stock + 1e-9
}

const chosen = computed(() =>
  current.value.lines
    .map((line, index) => ({ line, index, qty: baseOf(index) }))
    .filter((x) => x.qty > 0),
)
/** Una cantidad escrita inválida (negativa o texto) bloquea el envío: no se ignora en silencio. */
const allValid = computed(() => current.value.lines.every((_, i) => !(baseOf(i) < 0) && Number.isFinite(baseOf(i))))
const ready = computed(
  () => allValid.value && chosen.value.length > 0 && chosen.value.every((x) => !shortOfStock(x.index)),
)
const completes = computed(() => current.value.lines.every((_, i) => baseOf(i) + 1e-9 >= pendingBase(i)))

function review() {
  if (!ready.value) {
    play('error')
    return
  }
  failure.value = ''
  missingId.value = null
  if (!save.offline.value) save.reset()
  reviewing.value = true
}

async function confirm() {
  const result = await save.run((key) =>
    apiReceiveRequisition(
      current.value._id,
      key,
      chosen.value.map((x) => ({ index: x.index, qty: x.qty })),
      note.value.trim() || undefined,
      from.value,
    ),
  )
  if (result.ok) {
    play('success')
    current.value = result.value
    return
  }
  play('error')
  const missing = noStockError(result.error)
  if (missing) {
    reviewing.value = false
    missingId.value = missing.productId
    failure.value = `${missing.message}. No se guardó nada: recibe lo que hay o elige otro origen.`
  }
}

function done() {
  reviewing.value = false
  emit('saved', current.value)
}

function lineId(index: number): string {
  return requisitionUnit(current.value.lines[index]!)._id ?? ''
}
</script>

<template>
  <section class="flow">
    <FlowHeader
      :title="`Recibir ${current.code}`"
      icon="fa-truck-ramp-box"
      :steps="['Marcar lo que llegó', 'Confirmar']"
      :current="reviewing ? 1 : 0"
      :back-label="backLabel ?? 'Volver'"
      @back="emit('back')"
    />

    <div class="pane">
      <div class="card context">
        <strong>{{ current.code }}</strong>
        <span><i class="fa-solid fa-user" aria-hidden="true" /> Pidió {{ personName(current.requestedBy) }} · {{ formatDateTime(current.createdAt) }}</span>
        <span v-if="current.reviewedBy"><i class="fa-solid fa-thumbs-up" aria-hidden="true" /> Aprobó {{ personName(current.reviewedBy) }}</span>
        <StatusPill :status="current.status" />
      </div>
      <p v-if="current.note" class="lead">Nota del bar: {{ current.note }}</p>
      <div class="field">
        <label>¿De dónde sale?</label>
        <div class="dest">
          <button
            v-for="loc in fromOptions"
            :key="loc"
            type="button"
            class="dest-btn"
            :class="{ on: from === loc }"
            :aria-pressed="from === loc"
            @click="from = loc"
          >
            <i class="fa-solid" :class="LOCATION_ICON[loc]" aria-hidden="true" />
            <strong>{{ LOCATION_LABEL[loc] }}</strong>
            <i v-if="from === loc" class="fa-solid fa-circle-check tick" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p class="lead">Marca lo que entregas al barco. Sale {{ LOCATION_IN[from] }} y llega a bordo.</p>

      <Transition name="status">
        <p v-if="failure" class="card alert" role="alert">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ failure }}
        </p>
      </Transition>

      <div class="lines">
        <article
          v-for="(line, i) in current.lines"
          :key="i"
          class="card line"
          :class="{ 'line--bad': shortOfStock(i) || missingId === lineId(i) }"
        >
          <header class="line-head">
            <strong>{{ line.name }}</strong>
          </header>
          <span class="line-sub">
            Solicitado {{ stockText(line.qty, requisitionUnit(line)) }} · {{ line.receivedQty ? `recibido ${stockText(line.receivedQty, requisitionUnit(line))}` : 'nada recibido aún' }}
            <template v-if="warehouseOf(i) !== undefined"> · {{ LOCATION_IN[from] }} {{ stockText(warehouseOf(i)!, requisitionUnit(line)) }}</template>
          </span>
          <template v-if="pendingBase(i) > 0 && ['aprobado', 'recibido_parcial'].includes(current.status)">
            <span class="mini-label">Llega ahora ({{ missingText(stockText(pendingBase(i), requisitionUnit(line)), toContainers(pendingBase(i), requisitionUnit(line))) }})</span>
            <UnitQty
              v-model="picks[i]!.qty"
              v-model:mode="picks[i]!.mode"
              :product="requisitionUnit(line)"
              :label="`Cantidad recibida de ${line.name}`"
              :max-base="pendingBase(i)"
              allow-base
              allow-zero
            />
            <small v-if="shortOfStock(i)" class="err">
              No alcanza: solo hay {{ stockText(warehouseOf(i)!, requisitionUnit(line)) }} {{ LOCATION_IN[from] }}.
            </small>
          </template>
          <p v-else class="done-line"><i class="fa-solid fa-circle-check" aria-hidden="true" /> Completo</p>
        </article>
      </div>

      <div class="field">
        <label for="rr-note">Nota (opcional)</label>
        <input id="rr-note" v-model="note" type="text" placeholder="Ej. falta 1 botella, llega el jueves" />
      </div>

      <div class="footer">
        <button type="button" class="btn btn-gold big" :disabled="!ready" @click="review">
          Revisar y recibir <i class="fa-solid fa-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </div>

    <SummaryModal
      v-if="reviewing"
      :title="`Confirmar recepción de ${current.code}`"
      confirm-label="Recibir"
      :state="save.state.value"
      :message="save.message.value"
      :offline="save.offline.value"
      :saved-text="`Guardado · ${current.code} ${current.status === 'recibido' ? 'recibido completo' : 'recibido parcial'}`"
      :notice="`${LOCATION_LABEL[from]} baja y a bordo sube lo mismo. ${completes ? 'La solicitud queda completa.' : 'Lo que falta queda pendiente.'}`"
      @confirm="confirm"
      @close="reviewing = false"
      @done="done"
    >
      <ul class="sum-lines">
        <li v-for="x in chosen" :key="x.index">
          <span>
            <strong>{{ x.line.name }}</strong>
            <small>{{ LOCATION_LABEL[from] }} −{{ baseText(x.qty, requisitionUnit(x.line).stockUnit) }} · A bordo +{{ baseText(x.qty, requisitionUnit(x.line).stockUnit) }}</small>
          </span>
          <span class="sum-money"><strong>{{ stockText(x.qty, requisitionUnit(x.line)) }}</strong></span>
        </li>
      </ul>
    </SummaryModal>
  </section>
</template>

<style scoped lang="scss">
@use './flow' as *;

.done-line {
  margin: 0;
  color: var(--success);
  font-weight: 700;
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
