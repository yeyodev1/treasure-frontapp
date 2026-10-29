<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { apiFinishCheck, apiFinishCruise } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { formatDateTime, formatMoney } from '@/utils/format'
import type { Cruise, FinishCheck } from '@/types'

/**
 * Finalizar crucero (guía auditada): resumen por cabina con consumos,
 * cobros y saldo; tabletas con envíos sin confirmar y su última
 * sincronización. Si un equipo no responde, se permite el cierre
 * excepcional con motivo. Finalizar bloquea nuevos consumos pero nunca
 * marca pagada una cuenta.
 */
const props = defineProps<{ cruise: Cruise }>()
const emit = defineEmits<{ close: []; finished: [Cruise] }>()

const toast = useToastStore()
const { play } = useSound()
const check = shallowRef<FinishCheck | null>(null)
const finishing = shallowRef(false)
const refreshing = shallowRef(false)
const reason = shallowRef('')

const label = computed(() => (props.cruise.code ? `Salida ${props.cruise.code}` : props.cruise.name))
const exceptional = computed(() => Boolean(check.value?.issues.length))
const FINANCE_LABELS = { por_revisar: 'Por revisar', por_cobrar: 'Por cobrar', liquidada: 'Liquidada' } as const
const ACCOUNT_LABELS: Record<string, string> = {
  abierta: 'Abierta',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  cobrada: 'Cobrada',
  sin_consumos: 'Sin consumos',
}

async function load() {
  refreshing.value = true
  try {
    check.value = await apiFinishCheck(props.cruise._id)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    refreshing.value = false
  }
}

onMounted(load)

async function finish() {
  if (finishing.value) return
  if (exceptional.value && !reason.value.trim()) {
    toast.error('Indica el motivo del cierre excepcional')
    return
  }
  finishing.value = true
  try {
    const { cruise } = await apiFinishCruise(props.cruise._id, reason.value.trim() || undefined)
    play('success')
    toast.success(`${label.value} finalizada. Las cuentas pendientes conservan su saldo.`)
    emit('finished', cruise)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    finishing.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Finalizar crucero · ${label}`" @close="emit('close')">
    <SkeletonList v-if="!check" variant="row" :rows="6" />
    <div v-else class="finish">
      <div class="totals">
        <div><span>Consumos</span><strong>{{ formatMoney(check.totals.consumed) }}</strong></div>
        <div><span>Cobrado</span><strong>{{ formatMoney(check.totals.paid) }}</strong></div>
        <div><span>Por cobrar</span><strong>{{ formatMoney(check.totals.due) }}</strong></div>
        <div><span>Finanzas</span><strong class="finance" :class="`finance--${check.finance}`">{{ FINANCE_LABELS[check.finance] }}</strong></div>
      </div>

      <ul class="cabins">
        <li v-for="c in check.cabins.filter((x) => x.passengers)" :key="c.number" class="cabin">
          <span class="cabin-name"><strong>Cabina {{ c.number }}</strong> {{ c.guestName }}</span>
          <span class="cabin-money">{{ formatMoney(c.consumed) }} · cobrado {{ formatMoney(c.paid) }}</span>
          <span class="cabin-status" :class="{ 'cabin-status--due': c.due > 0 }">
            {{ c.due > 0 ? `Debe ${formatMoney(c.due)}` : ACCOUNT_LABELS[c.accountStatus] }}
          </span>
        </li>
      </ul>

      <div class="devices">
        <p class="devices-title">
          <i class="fa-solid fa-tablet-screen-button" aria-hidden="true" /> Tabletas del bar
          <button type="button" class="link" :disabled="refreshing" @click="load">
            <i class="fa-solid fa-rotate" :class="{ 'fa-spin': refreshing }" aria-hidden="true" /> Volver a revisar
          </button>
        </p>
        <p v-if="!check.devices.length" class="muted">Ninguna tableta reportó en esta salida.</p>
        <ul v-else>
          <li v-for="d in check.devices" :key="d.deviceId" :class="{ warn: d.pending > 0 || d.silent }">
            <strong>{{ d.label }}</strong> · {{ d.userName }}
            <span>
              {{ d.pending ? `${d.pending} sin confirmar` : 'Todo enviado' }} · última sincronización
              {{ d.lastSyncAt ? formatDateTime(d.lastSyncAt) : 'sin datos' }}<template v-if="d.silent"> · no responde</template>
            </span>
          </li>
        </ul>
        <p v-if="check.issues.length" class="hint">
          Pide al bar que abra su tableta con señal para que sincronice y vuelve a revisar. Si no es posible, cierra con motivo.
        </p>
      </div>

      <p v-if="check.held" class="muted">
        <i class="fa-solid fa-hourglass-half" aria-hidden="true" /> {{ check.held }} consumo(s) retenido(s) por envío tardío esperan tu revisión en Cuentas.
      </p>

      <Transition name="fade">
        <div v-if="exceptional" class="field">
          <label for="finish-reason">Motivo del cierre excepcional (obligatorio)</label>
          <textarea id="finish-reason" v-model="reason" rows="2" placeholder="Ej.: tablet sin señal en Baltra" />
        </div>
      </Transition>

      <p class="note">
        Después de finalizar no se aceptan consumos nuevos; un envío tardío queda retenido en esta salida para tu revisión. Las cuentas sin cobrar conservan saldo, pagador y salida.
      </p>

      <button type="button" class="btn btn-primary" :disabled="finishing" @click="finish">
        <i class="fa-solid" :class="finishing ? 'fa-spinner fa-spin' : 'fa-anchor'" aria-hidden="true" />
        {{ finishing ? 'Finalizando…' : exceptional ? 'Finalizar con cierre excepcional' : 'Finalizar crucero' }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.finish {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.5rem;

  div {
    padding: 0.6rem 0.75rem;
    border-radius: var(--radius-sm);
    background: var(--cream-100);
    display: grid;
  }

  span {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-400);
    font-weight: 700;
  }

  strong {
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
  }
}

.finance--liquidada {
  color: var(--success);
}

.finance--por_cobrar,
.finance--por_revisar {
  color: var(--warning);
}

.cabins,
.devices ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}

.cabin {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.15rem 0.75rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--cream-200);
  border-radius: var(--radius-sm);
}

.cabin-money {
  grid-column: 1;
  font-size: 0.82rem;
  color: var(--ink-400);
}

.cabin-status {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  font-weight: 700;
  font-size: 0.85rem;

  &--due {
    color: var(--warning);
  }
}

.devices {
  display: grid;
  gap: 0.4rem;

  li {
    display: grid;
    padding: 0.45rem 0.7rem;
    border-radius: var(--radius-sm);
    background: var(--cream-100);
    font-size: 0.88rem;

    &.warn {
      background: rgba(185, 128, 47, 0.12);
    }

    span {
      color: var(--ink-400);
      font-size: 0.8rem;
    }
  }
}

.devices-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
}

.link {
  margin-left: auto;
  min-height: 44px;
  font-weight: 700;
  color: var(--navy-600);
}

.muted,
.hint,
.note {
  font-size: 0.85rem;
  color: var(--ink-400);
}

textarea {
  width: 100%;
  border: 1.5px solid var(--cream-200);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem;
  font: inherit;
  resize: vertical;
  transition: border-color 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--gold-500);
  }
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
