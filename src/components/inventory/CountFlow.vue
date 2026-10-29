<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
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

/** Conteo físico desde la tableta de bodega: abre el editor de conteos existente. */
const emit = defineEmits<{ back: [] }>()

const confirmStore = useConfirmStore()
const toast = useToastStore()
const userStore = useUserStore()
const { play } = useSound()

const counts = shallowRef<StockCount[]>([])
const loading = shallowRef(true)
const openId = shallowRef<string | null>(null)
const creating = shallowRef(false)

const STATUS: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Por aprobar',
  aprobado: 'Aprobado',
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
const recent = computed(() => counts.value.filter((c) => c.status === 'aprobado').slice(0, 5))

async function create(location: StockLocation) {
  const ok = await confirmStore.ask({
    title: `¿Abrir conteo de ${location === 'bodega' ? 'bodega' : 'a bordo'}?`,
    message:
      'Se guarda una foto del stock del sistema en este momento (el corte). Guardar el conteo no cambia el stock: lo autoriza la dueña.',
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
    <FlowHeader title="Conteo físico" icon="fa-clipboard-list" @back="emit('back')" />

    <div class="pane">
      <p class="lead">
        Cuenta lo que hay en el lugar y anótalo. Si hay diferencia, la dueña la revisa y autoriza el ajuste.
      </p>

      <div class="dest">
        <button
          v-for="loc in ['bodega', 'abordo'] as const"
          :key="loc"
          type="button"
          class="dest-btn"
          :disabled="creating"
          @click="create(loc)"
        >
          <i class="fa-solid" :class="loc === 'bodega' ? 'fa-warehouse' : 'fa-ship'" aria-hidden="true" />
          <strong>Nuevo conteo {{ loc === 'bodega' ? 'de bodega' : 'a bordo' }}</strong>
          <small>{{ loc === 'bodega' ? 'Almacén en tierra' : 'Bar del barco' }}</small>
        </button>
      </div>

      <SkeletonList v-if="loading" variant="card" :rows="2" />
      <template v-else>
        <h3 class="sub">En curso</h3>
        <p v-if="!open.length" class="muted">No hay conteos abiertos.</p>
        <TransitionGroup tag="div" name="line" class="lines">
          <button v-for="c in open" :key="c._id" type="button" class="card count" @click="openId = c._id">
            <span class="count-top">
              <strong>{{ c.code }} · {{ c.location === 'abordo' ? 'A bordo' : 'Bodega' }}</strong>
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
          <h3 class="sub">Aprobados recientes</h3>
          <div class="lines">
            <button v-for="c in recent" :key="c._id" type="button" class="card count" @click="openId = c._id">
              <span class="count-top">
                <strong>{{ c.code }} · {{ c.location === 'abordo' ? 'A bordo' : 'Bodega' }}</strong>
                <span class="pill pill--aprobado">Aprobado</span>
              </span>
              <small>Corte {{ formatDateTime(c.cutAt) }} · aprobó {{ c.reviewedBy?.name }}</small>
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
  font-size: 1.1rem;
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
  font-weight: 700;
  color: var(--gold-500);
  font-size: 0.9rem;
}

.pill {
  font-size: 0.75rem;
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
