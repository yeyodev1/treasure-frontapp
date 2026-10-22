<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { AccountSummary, Cabin, PaymentMethod } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import QrCanvas from '@/components/ui/QrCanvas.vue'
import { apiCollectCabin } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney, formatDateTime } from '@/utils/format'

const props = defineProps<{
  cruiseId: string
  cabin: Cabin
  account: AccountSummary
}>()

const emit = defineEmits<{ close: []; collected: [] }>()

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta (datafast físico)' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'online', label: 'Pago en línea' },
]

const method = shallowRef<string>('efectivo')
const cashConfirmed = shallowRef(false)
const saving = shallowRef(false)
const error = shallowRef('')
const showQr = shallowRef(false)

const billing = reactive({
  name: props.cabin.guestName,
  idNumber: '',
  email: props.cabin.email,
  country: props.cabin.country,
})

/** Link público de la cuenta: el pasajero lo abre escaneando el QR. */
const publicUrl = computed(() => `${window.location.origin}/cuenta/${props.cabin.accountToken}`)

const canSubmit = computed(() => {
  if (!billing.name.trim() || !billing.idNumber.trim()) return false
  if (method.value === 'efectivo' && !cashConfirmed.value) return false
  return true
})

async function collect() {
  error.value = ''
  saving.value = true
  try {
    await apiCollectCabin({
      cruiseId: props.cruiseId,
      cabinNumber: props.cabin.number,
      method: method.value as PaymentMethod,
      cashConfirmed: cashConfirmed.value,
      billing,
    })
    emit('collected')
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Cobrar cabina ${cabin.number}`" @close="emit('close')">
    <div class="collect">
      <section class="summary">
        <article v-for="order in account.orders" :key="order.id" class="order">
          <p class="order-date">{{ formatDateTime(order.createdAt) }}</p>
          <ul class="order-items">
            <li v-for="(item, i) in order.items" :key="i">
              <span>
                {{ item.qty }}× {{ item.name }}
                <em v-if="item.courtesy" class="courtesy-tag">cortesía</em>
              </span>
              <span>{{ formatMoney(item.courtesy ? 0 : item.qty * item.unitPrice) }}</span>
            </li>
          </ul>
        </article>

        <div class="totals">
          <p v-if="account.courtesyTotal > 0" class="totals-line totals-line--muted">
            <span>Cortesías</span><span>{{ formatMoney(account.courtesyTotal) }}</span>
          </p>
          <p class="totals-line totals-line--main">
            <span>Total a cobrar</span><strong>{{ formatMoney(account.total) }}</strong>
          </p>
        </div>
      </section>

      <button type="button" class="btn btn-ghost" @click="showQr = !showQr">
        {{ showQr ? 'Ocultar QR' : 'Mostrar QR para el pasajero' }}
      </button>

      <div v-if="showQr" class="qr-box">
        <QrCanvas :text="publicUrl" :size="230" />
        <p>La persona escanea y ve su cuenta en su celular.</p>
      </div>

      <section class="form">
        <h4>Datos de facturación</h4>
        <div class="field">
          <label for="bill-name">Nombre</label>
          <input id="bill-name" v-model="billing.name" type="text" />
        </div>
        <div class="field">
          <label for="bill-id">Cédula / pasaporte / RUC</label>
          <input id="bill-id" v-model="billing.idNumber" type="text" />
        </div>
        <div class="row">
          <div class="field">
            <label for="bill-email">Correo (para la factura)</label>
            <input id="bill-email" v-model="billing.email" type="email" />
          </div>
          <div class="field">
            <label for="bill-country">País</label>
            <input id="bill-country" v-model="billing.country" type="text" />
          </div>
        </div>

        <div class="field">
          <label id="method-label">Método de pago</label>
          <BaseSelect v-model="method" :options="METHOD_OPTIONS" aria-labelledby="method-label" />
        </div>

        <label v-if="method === 'efectivo'" class="cash-check">
          <input v-model="cashConfirmed" type="checkbox" />
          Confirmo que el efectivo fue recaudado en caja
        </label>
      </section>

      <p v-if="error" class="collect-error">{{ error }}</p>

      <button type="button" class="btn btn-gold" :disabled="!canSubmit || saving" @click="collect">
        {{ saving ? 'Cobrando…' : `Cobrar ${formatMoney(account.total)}` }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.collect {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.order {
  margin-bottom: 0.6rem;
}

.order-date {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--ink-400);
  text-transform: uppercase;
}

.order-items {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.9rem;
    padding: 0.2rem 0;
  }
}

.courtesy-tag {
  font-style: normal;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--success);
}

.totals {
  border-top: 2px solid var(--cream-200);
  padding-top: 0.6rem;
}

.totals-line {
  display: flex;
  justify-content: space-between;
  margin: 0.2rem 0;

  &--muted {
    color: var(--ink-400);
    font-size: 0.85rem;
  }

  &--main strong {
    font-size: 1.25rem;
  }
}

.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--cream-200);
  border-radius: var(--radius-sm);

  p {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-600);
    text-align: center;
  }
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  h4 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-400);
  }
}

.row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: 2fr 1fr;
  }
}

.cash-check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.6rem;
  background: rgba(232, 161, 60, 0.12);
  border-radius: var(--radius-sm);

  input {
    width: 1.2rem;
    height: 1.2rem;
  }
}

.collect-error {
  margin: 0;
  color: var(--danger);
  font-weight: 600;
}
</style>
