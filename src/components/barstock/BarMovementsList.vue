<script setup lang="ts">
import { onMounted, shallowRef, watch } from 'vue'
import { apiBarMovements, type BarMovement } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { formatMoney } from '@/utils/format'
import { fmt } from '@/components/owner/insights'
import { TIMEZONE } from '@/utils/format'

/**
 * Cortesías, roturas y salidas de un crucero, una por una: cuándo, qué,
 * producto, quién y quién autorizó, valor; las roturas con su foto
 * (Bar-stock y Control del bar, 24 y 26-nov-2026).
 */
const props = withDefaults(defineProps<{ cruiseId?: string; showValue?: boolean }>(), { cruiseId: '', showValue: true })
const emit = defineEmits<{ loaded: [total: number, count: number] }>()
const toast = useToastStore()

const items = shallowRef<BarMovement[]>([])
const code = shallowRef('')
const total = shallowRef(0)
const loading = shallowRef(true)

async function load() {
  loading.value = true
  try {
    const data = await apiBarMovements(props.cruiseId || undefined)
    items.value = data.items
    code.value = data.cruise?.code ?? ''
    total.value = data.total
    emit('loaded', data.total, data.items.length)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.cruiseId, load)
defineExpose({ load })

const KIND: Record<BarMovement['kind'], string> = { cortesia: 'Cortesía', rotura: 'Rotura', salida: 'Salida', devolucion_tierra: 'Devolución a tierra' }
const EXIT: Record<string, string> = { cocina: 'cocina', tripulacion: 'tripulación', brindis: 'brindis', agencia: 'agencia', casa: '' }
const when = (at: string) =>
  `${fmt(at, { weekday: 'short', day: 'numeric' })} · ${new Date(at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE })}`
</script>

<template>
  <div class="mvl">
    <p v-if="loading" class="muted">Cargando…</p>
    <p v-else-if="!items.length" class="muted">Sin cortesías, roturas ni salidas{{ code ? ` en ${code}` : '' }}.</p>
    <div v-else class="table">
      <table>
        <thead>
          <tr>
            <th scope="col">Cuándo</th>
            <th scope="col">Qué</th>
            <th scope="col">Producto</th>
            <th scope="col">Quién</th>
            <th v-if="showValue" scope="col" class="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in items" :key="m.id">
            <td class="nowrap">{{ when(m.at) }}</td>
            <td class="nowrap">
              <span class="tag" :class="`tag--${m.kind}`">{{ KIND[m.kind] }}</span>
              <template v-if="EXIT[m.exitKind]"> {{ EXIT[m.exitKind] }}</template>
              <a v-if="m.photo" :href="m.photo" target="_blank" rel="noopener" class="photo-link" aria-label="Ver foto de la rotura">
                <i class="fa-solid fa-camera" aria-hidden="true" />
              </a>
            </td>
            <td>{{ m.product }}<template v-if="m.unit"> · {{ m.qty }} {{ m.unit }}</template><template v-else> · {{ m.qty }}</template><small v-if="m.note"> · {{ m.note }}</small></td>
            <td>{{ m.by }}<template v-if="m.authorizedBy"> · autorizó {{ m.authorizedBy }}</template></td>
            <td v-if="showValue" class="num">{{ m.value ? formatMoney(m.value) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped lang="scss">
.muted {
  margin: 0;
  color: var(--ink-600);
}

.table {
  overflow-x: auto;

  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }

  thead th {
    font-size: 0.8rem;
    color: var(--ink-600);
  }

  .num {
    text-align: right;
  }

  small {
    color: var(--ink-600);
  }
}

.nowrap {
  white-space: nowrap;
}

.tag {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  background: var(--pill-neutral-bg);
  color: var(--pill-neutral-ink);

  &--rotura {
    background: var(--pill-danger-bg);
    color: var(--pill-danger-ink);
  }

  &--salida,
  &--cortesia {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }
}

.photo-link {
  display: inline-grid;
  place-items: center;
  min-width: 32px;
  min-height: 32px;
  color: var(--navy-700);
}
</style>
