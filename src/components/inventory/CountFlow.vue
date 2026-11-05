<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useRoute } from 'vue-router'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import FlowHeader from '@/components/supply/FlowHeader.vue'
import CountEditor from './CountEditor.vue'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { useSound } from '@/composables/useSound'
import { apiCounts, apiCreateCount } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime } from '@/utils/format'
import type { StockCount, StockLocation } from '@/types'
import { ACTIVE_LOCATIONS, LOCATION_HINT, LOCATION_ICON, LOCATION_IN, LOCATION_LABEL } from '@/components/supply/units'

/**
 * Conteos físicos por ubicación (pestaña Conteos de Inventario y pedidos).
 * Guía 4 perfiles (4-nov-2026): se guarda y se sigue después; al pulsar
 * «Confirmar inventario» el conteo físico pasa a ser la referencia y queda el
 * informe de diferencias (?vista=diferencias). Lo no contado no cuenta como
 * cero. `embedded`: dentro de la pestaña, sin botón de volver.
 */
defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{ back: [] }>()

const confirmStore = useConfirmStore()
const toast = useToastStore()
const userStore = useUserStore()
const route = useRoute()
const { play } = useSound()
/** Pestaña «Diferencias»: informe de los conteos confirmados. */
const report = computed(() => route.query.vista === 'diferencias')

const counts = shallowRef<StockCount[]>([])
const loading = shallowRef(true)
const openId = shallowRef<string | null>(null)
const creating = shallowRef(false)

const STATUS: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Pendiente de aprobación',
  aprobado: 'Confirmado',
  rechazado: 'Devuelto',
}

async function load() {
  try {
    counts.value = await apiCounts()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)

const open = computed(() => counts.value.filter((c) => c.status !== 'aprobado'))
const confirmed = computed(() => counts.value.filter((c) => c.status === 'aprobado'))
const recent = computed(() => confirmed.value.slice(0, 5))

async function create(location: StockLocation) {
  const ok = await confirmStore.ask({
    title: `¿Abrir conteo ${LOCATION_IN[location]}?`,
    message:
      'Se guarda una foto del stock del sistema en este momento (el corte). Puedes guardar y seguir después: el stock cambia solo al confirmar el inventario.',
    confirmLabel: 'Abrir conteo',
    icon: 'fa-clipboard-list',
  })
  if (!ok) return
  creating.value = true
  try {
    const count = await apiCreateCount(location)
    play('success')
    toast.success(`Conteo ${count.code} abierto`)
    openId.value = count._id
    await load()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <section class="flow">
    <FlowHeader v-if="!embedded" title="Conteo físico" icon="fa-clipboard-list" @back="emit('back')" />
    <header v-else class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">{{ report ? 'Diferencias' : 'Conteos' }}</h1>
        <p class="page-lead">
          {{
            report
              ? 'Lo que no coincidió con el sistema en cada conteo confirmado: quién contó, cuándo y cuánto.'
              : 'Cuenta lo que hay, guarda cuando quieras y pulsa «Confirmar inventario»: lo contado pasa a ser la referencia.'
          }}
        </p>
      </div>
    </header>

    <!-- Informe de diferencias: automático para Administración y la dueña -->
    <div v-if="report" class="pane">
      <SkeletonList v-if="loading" variant="card" :rows="3" />
      <div v-else-if="!confirmed.length" class="vacio">
        <i class="fa-solid fa-scale-balanced" aria-hidden="true" />
        <p>Aún no hay conteos confirmados. Al confirmar uno, su informe aparece aquí.</p>
      </div>
      <div v-else class="lines">
        <button v-for="c in confirmed" :key="c._id" type="button" class="card count" @click="openId = c._id">
          <span class="count-top">
            <strong>{{ c.code }} · {{ LOCATION_LABEL[c.location] }}</strong>
            <span class="pill" :class="c.differences ? 'pill--enviado' : 'pill--aprobado'">
              {{ c.differences ? `${c.differences} con diferencia` : 'Sin diferencias' }}
            </span>
          </span>
          <small>
            Corte {{ formatDateTime(c.cutAt) }} · {{ c.countedLines ?? 0 }} contados · confirmó {{ c.reviewedBy?.name }}
            {{ c.reviewedAt ? `el ${formatDateTime(c.reviewedAt)}` : '' }}
          </small>
          <span class="count-go">Ver informe <i class="fa-solid fa-chevron-right" aria-hidden="true" /></span>
        </button>
      </div>
    </div>

    <div v-else class="pane">
      <p class="lead">
        Cuenta lo que hay en el lugar y anótalo. Puedes guardar y seguir después.
      </p>

      <div class="dest">
        <button
          v-for="loc in ACTIVE_LOCATIONS"
          :key="loc"
          type="button"
          class="dest-btn"
          :disabled="creating"
          @click="create(loc)"
        >
          <i class="fa-solid" :class="LOCATION_ICON[loc]" aria-hidden="true" />
          <strong>Nuevo conteo: {{ LOCATION_LABEL[loc] }}</strong>
          <small>{{ LOCATION_HINT[loc] }}</small>
        </button>
      </div>

      <SkeletonList v-if="loading" variant="card" :rows="2" />
      <template v-else>
        <h3 class="sub">En curso</h3>
        <div v-if="!open.length" class="vacio">
          <i class="fa-solid fa-clipboard-check" aria-hidden="true" />
          <p>No hay conteos abiertos. Empieza uno arriba.</p>
        </div>
        <TransitionGroup tag="div" name="line" class="lines">
          <button v-for="c in open" :key="c._id" type="button" class="card count" @click="openId = c._id">
            <span class="count-top">
              <strong>{{ c.code }} · {{ LOCATION_LABEL[c.location] }}</strong>
              <span class="pill" :class="`pill--${c.status}`">{{ STATUS[c.status] }}</span>
            </span>
            <small>Corte {{ formatDateTime(c.cutAt) }} · {{ c.createdBy?.name }}</small>
            <span class="count-go">
              {{ c.status === 'enviado' ? (userStore.isOwner ? 'Revisar' : 'Ver') : 'Continuar' }}
              <i class="fa-solid fa-chevron-right" aria-hidden="true" />
            </span>
          </button>
        </TransitionGroup>

        <template v-if="recent.length">
          <h3 class="sub">Confirmados recientes</h3>
          <div class="lines">
            <button v-for="c in recent" :key="c._id" type="button" class="card count" @click="openId = c._id">
              <span class="count-top">
                <strong>{{ c.code }} · {{ LOCATION_LABEL[c.location] }}</strong>
                <span class="pill pill--aprobado">{{ c.differences ? `${c.differences} con diferencia` : 'Sin diferencias' }}</span>
              </span>
              <small>Corte {{ formatDateTime(c.cutAt) }} · confirmó {{ c.reviewedBy?.name }}</small>
            </button>
          </div>
        </template>
      </template>
    </div>

    <CountEditor v-if="openId" :count-id="openId" @close="openId = null" @changed="load" />
  </section>
</template>

<style scoped lang="scss">
@use '@/components/supply/flow' as *;

.dest-btn {
  min-height: 110px;

  &:disabled {
    opacity: 0.6;
  }
}

.sub {
  font-size: 1.3rem;
  margin-top: 0.25rem;
}

.count {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  text-align: left;
  min-height: 72px;
  transition: transform 0.12s ease;

  &:active {
    transform: scale(0.99);
  }

  small {
    color: var(--ink-400);
  }
}

.count-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.count-go {
  font-weight: 600;
  color: var(--gold-600);
  font-size: 0.97rem;
}

.pill {
  font-size: 0.84rem;
  font-weight: 700;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  background: var(--cream-100);
  color: var(--ink-600);

  &--enviado {
    background: rgba(185, 128, 47, 0.15);
    color: #8a5d1d;
  }

  &--aprobado {
    background: rgba(63, 122, 87, 0.14);
    color: var(--success);
  }

  &--rechazado {
    background: rgba(180, 72, 59, 0.12);
    color: var(--danger);
  }
}
</style>
