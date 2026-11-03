<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { CabinAccountRow, Cruise } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import PayerForm from '@/components/accounts/PayerForm.vue'
import PaymentLines from '@/components/accounts/PaymentLines.vue'
import {
  billingError,
  emptyBilling,
  linesState,
  methodsLabel,
  newLine,
  toPayload,
  type Billing,
  type PayLine,
} from '@/components/accounts/payLines'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { apiCollectCabin } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'

/**
 * Cabinas juntas (pedido del cliente, 31-oct-2026): amigos en varias
 * cabinas y uno paga todo. Se eligen las cuentas aprobadas, quién paga y
 * cómo; queda una sola factura y todas las cabinas Pagadas.
 */
const props = defineProps<{
  cruise: Cruise
  rows: CabinAccountRow[]
  /** Cabina que pidió que otra le pague: entra ya marcada. */
  preselect?: number | null
}>()
const emit = defineEmits<{ close: []; collected: [] }>()

const confirmStore = useConfirmStore()
const toast = useToastStore()
const { play } = useSound()

/** Aprobadas con saldo; con pagos parciales se cobran solas. */
const candidates = computed(() => props.rows.filter((r) => r.status === 'aprobada' && r.due > 0))
const picked = ref<Set<number>>(new Set(props.preselect ? [props.preselect] : []))
const billing = ref<Billing>(emptyBilling())
const payLines = ref<PayLine[]>([newLine()])
const busy = shallowRef(false)

function toggle(n: number) {
  const next = new Set(picked.value)
  if (next.has(n)) next.delete(n)
  else next.add(n)
  picked.value = next
}

const pickedRows = computed(() => candidates.value.filter((r) => picked.value.has(r.cabinNumber)))
const target = computed(() => Math.round(pickedRows.value.reduce((s, r) => s + r.due, 0) * 100) / 100)
const state = computed(() => linesState(payLines.value, target.value, false))

const passengers = computed(() =>
  props.cruise.cabins
    .filter((c) => picked.value.has(c.number))
    .flatMap((c) => c.passengers.map((p) => ({ ...p, cabin: c.number }))),
)

const blocked = computed(() => {
  if (pickedRows.value.length < 2) return 'Elige al menos dos cabinas.'
  const partial = pickedRows.value.find((r) => r.partialPaid > 0)
  if (partial) return `La cabina ${partial.cabinNumber} tiene un pago parcial: cóbrala sola.`
  return billingError(billing.value) || state.value.error
})

async function collect() {
  if (blocked.value) return
  const cabins = pickedRows.value.map((r) => r.cabinNumber)
  const ok = await confirmStore.ask({
    title: `¿Cobrar ${formatMoney(state.value.total)} por las cabinas ${cabins.join(', ')}?`,
    message: `${methodsLabel(payLines.value, state.value, formatMoney)}. Una sola factura a nombre de ${billing.value.name.trim()}; las ${cabins.length} cuentas quedan Pagadas.`,
    confirmLabel: 'Cobrar',
    icon: 'fa-cash-register',
  })
  if (!ok) return
  busy.value = true
  try {
    const b = billing.value
    const result = await apiCollectCabin({
      cruiseId: props.cruise._id,
      cabinNumber: cabins[0]!,
      cabins,
      lines: toPayload(payLines.value, state.value),
      expectedDue: target.value,
      billing: {
        name: b.name.trim(),
        idNumber: b.idNumber.trim(),
        email: b.email.trim() || undefined,
        country: b.country || undefined,
      },
    })
    play('cash')
    toast.success(`Cabinas ${cabins.join(', ')} pagadas juntas`)
    if (result.payment?.invoiceStatus !== 'emitida') {
      toast.push(`Factura pendiente. ${result.payment?.invoiceError || 'Reintenta la emisión desde Cobros.'}`, 'info')
    }
    emit('collected')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal
    :title="preselect ? `Otra cabina paga la cabina ${preselect}` : 'Cobrar cabinas juntas'"
    :subtitle="preselect
      ? 'Marca la cabina que paga y elige a la persona: una sola factura por todo.'
      : 'Una persona paga varias cabinas: una sola factura.'"
    size="lg"
    @close="emit('close')"
  >
    <div class="group">
      <section class="step">
        <p class="label"><span class="n">1</span> {{ preselect ? 'Cabina que paga' : 'Cabinas que paga' }}</p>
        <p v-if="!candidates.length" class="muted">No hay cuentas aprobadas con saldo. Aprueba las cuentas primero.</p>
        <p v-else-if="preselect" class="muted">
          Solo aparecen cuentas aprobadas: si la cabina que paga no está, aprueba su cuenta primero.
        </p>
        <div v-else class="cabins">
          <label
            v-for="r in candidates"
            :key="r.cabinNumber"
            class="cabin"
            :class="{ 'cabin--on': picked.has(r.cabinNumber), 'cabin--partial': r.partialPaid > 0 }"
          >
            <input type="checkbox" :checked="picked.has(r.cabinNumber)" @change="toggle(r.cabinNumber)" />
            <span class="cabin-text">
              <strong>Cabina {{ r.cabinNumber }}</strong>
              <small>{{ r.guestName || 'Sin nombre' }}<template v-if="r.partialPaid > 0"> · con pago parcial</template></small>
            </span>
            <span class="cabin-due">{{ formatMoney(r.due) }}</span>
          </label>
        </div>
      </section>

      <Transition name="fade">
        <section v-if="pickedRows.length" class="step">
          <p class="label"><span class="n">2</span> ¿Quién paga?</p>
          <PayerForm v-model="billing" :passengers="passengers" id-prefix="group-bill" />
        </section>
      </Transition>

      <Transition name="fade">
        <section v-if="pickedRows.length" class="step">
          <p class="label">
            <span class="n">3</span> Forma de pago <span class="total">{{ formatMoney(target) }}</span>
          </p>
          <PaymentLines v-model="payLines" :target="target" id-prefix="group-pay" />
        </section>
      </Transition>
    </div>

    <template #footer>
      <p v-if="blocked && pickedRows.length" class="why">{{ blocked }}</p>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-gold btn-lg" :disabled="Boolean(blocked) || busy" @click="collect">
        <i class="fa-solid" :class="busy ? 'fa-spinner fa-spin' : 'fa-cash-register'" aria-hidden="true" />
        Cobrar {{ target > 0 && !state.error ? formatMoney(state.total) : '' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.group {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;

  & + & {
    padding-top: 1rem;
    border-top: 1px solid var(--line);
  }
}

.label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-weight: 700;
}

.n {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--navy-800);
  color: #fff;
  font-size: 0.78rem;
}

.total {
  margin-left: auto;
  font-family: var(--font-serif);
  font-size: 1.3rem;
  color: var(--navy-800);
  font-variant-numeric: tabular-nums;
}

.cabins {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.45rem;

  @include tablet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.cabin {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 56px;
  padding: 0.5rem 0.8rem;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  input {
    width: 20px;
    height: 20px;
    accent-color: var(--navy-800);
  }

  &--on {
    border-color: var(--navy-700);
    background: var(--powder-100);
  }

  &--partial small {
    color: var(--warning);
  }
}

.cabin-text {
  display: flex;
  flex-direction: column;
  min-width: 0;

  small {
    color: var(--ink-400);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.cabin-due {
  margin-left: auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.muted {
  margin: 0;
  color: var(--ink-400);
}

.why {
  flex: 1 1 100%;
  margin: 0 0 0.25rem;
  color: var(--ink-600);
  font-size: 0.88rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
