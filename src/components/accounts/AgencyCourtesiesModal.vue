<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import type { AgencyCourtesy, Cruise } from '@/types'
import BaseModal from '@/components/ui/BaseModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { useToastStore } from '@/stores/toast'
import { apiAgencyCourtesies, apiSendAgencyCourtesies } from '@/services/api'
import { EMAIL_RE } from './payLines'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime, formatMoney } from '@/utils/format'

/**
 * Cuenta de la agencia (pedido del cliente, 31-oct-2026): las cortesías de
 * agencia no se cobran a la cabina; aquí se juntan con su precio para
 * facturarlas a la agencia al final del crucero.
 */
const props = defineProps<{ cruise: Cruise }>()
const emit = defineEmits<{ close: [] }>()
const toast = useToastStore()

const items = shallowRef<AgencyCourtesy[]>([])
const total = shallowRef(0)
const loading = shallowRef(true)

onMounted(async () => {
  try {
    const data = await apiAgencyCourtesies(props.cruise._id)
    items.value = data.items
    total.value = data.total
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
})

/** Por bebida: cantidad e importe (lo que va a la factura de la agencia). */
const byProduct = computed(() => {
  const map = new Map<string, { name: string; unitPrice: number; qty: number; total: number }>()
  for (const i of items.value) {
    const key = `${i.name}|${i.unitPrice}`
    const row = map.get(key) ?? { name: i.name, unitPrice: i.unitPrice, qty: 0, total: 0 }
    row.qty += i.qty
    row.total = Math.round((row.total + i.total) * 100) / 100
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
})

const label = computed(() => (props.cruise.code ? `Crucero ${props.cruise.code}` : props.cruise.name))

/** Texto para pegar en la factura o enviar a la agencia. */
async function copySummary() {
  const lines = [
    `Cortesías de agencia · ${label.value}`,
    ...byProduct.value.map((r) => `${r.qty} × ${r.name} (${formatMoney(r.unitPrice)}) = ${formatMoney(r.total)}`),
    `Total: ${formatMoney(total.value)}`,
  ]
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    toast.success('Resumen copiado')
  } catch {
    toast.error('No se pudo copiar')
  }
}

/** Correo de la agencia: se le envía este detalle con el total (4-nov-2026). */
const agencyEmail = shallowRef('')
const sending = shallowRef(false)
const emailOk = computed(() => EMAIL_RE.test(agencyEmail.value.trim()))

async function sendToAgency() {
  if (!emailOk.value || sending.value) return
  sending.value = true
  try {
    const { to } = await apiSendAgencyCourtesies(props.cruise._id, agencyEmail.value.trim())
    toast.success(`Detalle enviado a ${to}`)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Cortesías de agencia · ${label}`" subtitle="No se cobran a la cabina: aquí se juntan todas las del crucero para cobrárselas a la agencia." size="lg" @close="emit('close')">
    <SkeletonList v-if="loading" variant="row" :rows="4" />
    <div v-else class="agency">
      <div class="agency-total">
        <span>Total a facturar a la agencia</span>
        <strong>{{ formatMoney(total) }}</strong>
      </div>

      <p v-if="!items.length" class="muted">Aún no hay cortesías de agencia en este crucero.</p>

      <template v-else>
        <section>
          <h4 class="title">Por bebida</h4>
          <ul class="rows">
            <li v-for="r in byProduct" :key="`${r.name}-${r.unitPrice}`" class="row">
              <span><strong>{{ r.qty }} ×</strong> {{ r.name }} <small>{{ formatMoney(r.unitPrice) }} c/u</small></span>
              <strong>{{ formatMoney(r.total) }}</strong>
            </li>
          </ul>
        </section>

        <section>
          <h4 class="title">Detalle</h4>
          <ul class="rows">
            <li v-for="i in items" :key="`${i.orderId}-${i.name}`" class="row row--detail">
              <span>
                <strong>Cabina {{ i.cabinNumber }}</strong> · {{ i.qty }} × {{ i.name }}
                <small>{{ formatDateTime(i.at) }}<template v-if="i.by"> · {{ i.by }}</template><template v-if="i.reason"> · {{ i.reason }}</template></small>
              </span>
              <span>{{ formatMoney(i.total) }}</span>
            </li>
          </ul>
        </section>

        <section class="send">
          <h4 class="title">Al final del crucero</h4>
          <ol class="steps">
            <li><strong>Envía el detalle a la agencia:</strong> escribe su correo y toca «Enviar a la agencia». Le llega la lista con el total.</li>
            <li><strong>Emite la factura en Contífico</strong> a nombre de la agencia por {{ formatMoney(total) }}. La app no la emite sola.</li>
          </ol>
          <div class="send-row">
            <input
              v-model="agencyEmail"
              type="email"
              inputmode="email"
              autocomplete="off"
              placeholder="correo@agencia.com"
              aria-label="Correo de la agencia"
              @keydown.enter="sendToAgency"
            />
            <button type="button" class="btn btn-primary" :disabled="!emailOk || sending" @click="sendToAgency">
              <i class="fa-solid" :class="sending ? 'fa-spinner fa-spin' : 'fa-paper-plane'" aria-hidden="true" />
              Enviar a la agencia
            </button>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cerrar</button>
      <button v-if="items.length" type="button" class="btn btn-primary" @click="copySummary">
        <i class="fa-regular fa-copy" aria-hidden="true" /> Copiar resumen
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.agency {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.agency-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--pill-warn-bg);
  color: var(--pill-warn-ink);
  font-weight: 600;

  strong {
    font-family: var(--font-serif);
    font-size: 1.6rem;
    font-variant-numeric: tabular-nums;
  }
}

.title {
  margin: 0 0 0.4rem;
  font-size: 0.9rem;
  color: var(--ink-600);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--line);
  font-variant-numeric: tabular-nums;

  small {
    display: block;
    color: var(--ink-400);
    font-size: 0.8rem;
  }

  &--detail {
    font-size: 0.92rem;
  }
}

.muted {
  margin: 0;
  color: var(--ink-400);
}

.steps {
  margin: 0 0 0.75rem;
  padding-left: 1.2rem;
  font-size: 0.92rem;
  color: var(--ink-600);

  li + li {
    margin-top: 0.35rem;
  }
}

.send-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;

  input {
    flex: 1 1 220px;
    min-height: 44px;
  }
}
</style>
