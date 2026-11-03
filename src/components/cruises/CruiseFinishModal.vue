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

const label = computed(() => (props.cruise.code ? `Crucero ${props.cruise.code}` : props.cruise.name))
const exceptional = computed(() => Boolean(check.value?.issues.length))
const FINANCE_LABELS = { por_revisar: 'Por revisar', por_cobrar: 'Por cobrar', liquidada: 'Liquidada' } as const
const ACCOUNT_LABELS: Record<string, string> = {
  abierta: 'Abierta',
  // Ya no hay paso de revisión: una cuenta en_revision se muestra abierta.
  en_revision: 'Abierta',
  aprobada: 'Aprobada',
  cobrada: 'Pagada',
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
    toast.success(`${label.value} finalizado y guardado. El siguiente crucero empieza en cero.`)
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
  <BaseModal
    :title="`Finalizar operación del crucero · ${label}`"
    subtitle="Saldo por cabina y envíos de las tabletas antes de cerrar el bar."
    size="lg"
    @close="emit('close')"
  >
    <SkeletonList v-if="!check" variant="row" :rows="6" />
    <div v-else class="finish">
      <div class="totals">
        <div><span>Consumos</span><strong>{{ formatMoney(check.totals.consumed) }}</strong></div>
        <div><span>Pagado</span><strong>{{ formatMoney(check.totals.paid) }}</strong></div>
        <div :class="{ 'totals-due': check.totals.due > 0 }"><span>Por cobrar</span><strong>{{ formatMoney(check.totals.due) }}</strong></div>
        <div><span>Finanzas</span><strong><span class="estado" :class="check.finance === 'liquidada' ? 'estado--ok' : 'estado--warn'">{{ FINANCE_LABELS[check.finance] }}</span></strong></div>
      </div>

      <ul class="cabins">
        <li v-for="c in check.cabins.filter((x) => x.passengers)" :key="c.number" class="cabin">
          <span class="cabin-name"><strong>Cabina {{ c.number }}</strong> {{ c.guestName }}</span>
          <span class="cabin-money">{{ formatMoney(c.consumed) }} · pagado {{ formatMoney(c.paid) }}</span>
          <span class="estado cabin-status" :class="c.due > 0 ? 'estado--warn' : c.accountStatus === 'cobrada' ? 'estado--ok' : ''">
            {{ c.due > 0 ? `Debe ${formatMoney(c.due)}` : ACCOUNT_LABELS[c.accountStatus] }}
          </span>
        </li>
      </ul>

      <div class="devices">
        <p class="devices-title">
          <i class="fa-solid fa-tablet-screen-button" aria-hidden="true" /> Tabletas del bar
          <button type="button" class="btn btn-text link" :disabled="refreshing" @click="load">
            <i class="fa-solid fa-rotate" :class="{ 'fa-spin': refreshing }" aria-hidden="true" /> Volver a revisar
          </button>
        </p>
        <p v-if="!check.devices.length" class="muted">Ninguna tableta reportó en este crucero.</p>
        <ul v-else>
          <li v-for="d in check.devices" :key="d.deviceId" :class="{ warn: d.pending > 0 || d.silent }">
            <strong>{{ d.label }}</strong>
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
          <textarea id="finish-reason" v-model="reason" rows="2" placeholder="Ej.: tableta sin señal en Baltra" />
        </div>
      </Transition>

      <!-- Qué pasa al finalizar (pedido de Administración, 3-nov-2026): nada se borra -->
      <ul class="after">
        <li>
          <i class="fa-solid fa-box-archive" aria-hidden="true" />
          <span><strong>Se guarda, no se borra.</strong> Cuentas, pagos y pasajeros de {{ label }} quedan en Cruceros → Finalizados y en Cuentas, eligiendo este crucero.</span>
        </li>
        <li>
          <i class="fa-solid fa-rotate-right" aria-hidden="true" />
          <span><strong>El siguiente crucero empieza en cero.</strong> Cuentas en $0 y cabinas sin pasajeros.</span>
        </li>
        <li>
          <i class="fa-solid fa-boxes-stacked" aria-hidden="true" />
          <span><strong>El inventario no cambia.</strong> Lo que queda a bordo pasa al siguiente crucero.</span>
        </li>
      </ul>

      <p class="note">
        Se finaliza la operación de <strong>{{ label }}</strong>. El bar ya no podrá registrar consumos nuevos.
        Las cuentas pendientes seguirán por cobrar<template v-if="check.totals.due > 0"> ({{ formatMoney(check.totals.due) }})</template>,
        con su pagador y su crucero. Finalizar no significa pagar. Un envío tardío queda retenido en este crucero para revisión.
      </p>

    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary btn-lg" :disabled="!check || finishing" @click="finish">
        <i class="fa-solid" :class="finishing ? 'fa-spinner fa-spin' : 'fa-anchor'" aria-hidden="true" />
        {{ finishing ? 'Finalizando…' : exceptional ? 'Finalizar operación con cierre excepcional' : 'Finalizar operación del crucero' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.finish {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.5rem;

  > div {
    display: grid;
    gap: 0.15rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--radius-sm);
    background: var(--cream-100);
  }

  span {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }

  strong {
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-900);

    .estado {
      font-size: 0.9rem;
    }
  }

  .totals-due {
    background: var(--pill-warn-bg);

    span,
    strong {
      color: var(--pill-warn-ink);
    }
  }
}

.cabins,
.devices ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}

.cabins {
  border-top: 1px solid var(--rule);
}

.cabin {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.15rem 0.75rem;
  padding: 0.65rem 0.1rem;
  border-bottom: 1px solid var(--rule);
}

.cabin-name {
  font-size: 1rem;

  strong {
    margin-right: 0.35rem;
  }
}

.cabin-money {
  grid-column: 1;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-600);
}

.cabin-status {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
}

.devices {
  display: grid;
  gap: 0.5rem;

  ul {
    gap: 0.4rem;
  }

  li {
    display: grid;
    gap: 0.1rem;
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius-sm);
    background: var(--cream-100);
    font-size: 1rem;

    &.warn {
      background: var(--pill-warn-bg);
      color: var(--pill-warn-ink);
    }

    span {
      font-size: 0.92rem;
      color: inherit;
      opacity: 0.85;
    }
  }
}

.devices-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-weight: 700;

  > i {
    color: var(--navy-600);
  }
}

.link {
  margin-left: auto;
}

.muted,
.hint,
.note {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.45;
  color: var(--ink-600);
}

.field textarea {
  resize: vertical;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.after {
  list-style: none;
  margin: 0;
  padding: 0.8rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);

  li {
    display: flex;
    gap: 0.65rem;
    align-items: flex-start;
    line-height: 1.4;
  }

  i {
    width: 1.1rem;
    margin-top: 0.2rem;
    color: var(--navy-700);
    text-align: center;
    flex-shrink: 0;
  }
}
</style>
