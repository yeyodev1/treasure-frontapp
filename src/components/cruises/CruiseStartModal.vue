<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import { apiStartCheck, apiStartCruise } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { formatDate } from '@/utils/format'
import type { Cruise, StartCheck } from '@/types'

/**
 * Iniciar crucero (guía auditada): resumen de salida, fechas y ocupación.
 * Valida pasajeros, pagador y que no haya otra salida en curso. Los
 * faltantes de stock se advierten sin bloquear el crucero. Programada pasa
 * a En curso una sola vez: el botón se bloquea mientras responde.
 */
const props = defineProps<{ cruise: Cruise }>()
const emit = defineEmits<{ close: []; started: [Cruise] }>()

const toast = useToastStore()
const { play } = useSound()
const check = shallowRef<StartCheck | null>(null)
const starting = shallowRef(false)
const showWarnings = shallowRef(false)

const label = computed(() => (props.cruise.code ? `Salida ${props.cruise.code}` : props.cruise.name))
const warningCount = computed(() => (check.value ? check.value.warnings.unavailable.length + check.value.warnings.low.length : 0))

onMounted(async () => {
  try {
    check.value = await apiStartCheck(props.cruise._id)
  } catch (err) {
    toast.error(apiErrorMessage(err))
    emit('close')
  }
})

async function start() {
  if (starting.value || !check.value || check.value.blockers.length) return
  starting.value = true
  try {
    const { cruise } = await apiStartCruise(props.cruise._id)
    play('success')
    toast.success(`${label.value} en curso: el bar ya puede registrar consumos`)
    emit('started', cruise)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Iniciar crucero · ${label}`" @close="emit('close')">
    <SkeletonList v-if="!check" variant="row" :rows="4" />
    <div v-else class="start">
      <dl class="facts">
        <div v-if="cruise.routeFrom">
          <dt>Ruta</dt>
          <dd>{{ cruise.routeFrom }} → {{ cruise.routeTo }}</dd>
        </div>
        <div>
          <dt>Fechas</dt>
          <dd>{{ formatDate(cruise.startDate) }}<template v-if="cruise.endDate"> → {{ formatDate(cruise.endDate) }}</template></dd>
        </div>
        <div>
          <dt>Ocupación</dt>
          <dd>{{ check.occupancy.passengers }} pasajeros en {{ check.occupancy.occupied }} de {{ check.occupancy.cabins }} cabinas</dd>
        </div>
        <div v-if="check.occupancy.empty.length">
          <dt>Cabinas vacías</dt>
          <dd>{{ check.occupancy.empty.join(', ') }} (no aceptan consumos)</dd>
        </div>
      </dl>

      <Transition name="fade">
        <div v-if="check.blockers.length" class="box box--danger">
          <p class="box-title"><i class="fa-solid fa-circle-xmark" aria-hidden="true" /> Corrige antes de iniciar</p>
          <ul>
            <li v-for="b in check.blockers" :key="b">{{ b }}</li>
          </ul>
        </div>
      </Transition>

      <div v-if="warningCount" class="box box--warning">
        <button type="button" class="box-toggle" :aria-expanded="showWarnings" @click="showWarnings = !showWarnings">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          {{ warningCount }} aviso(s) de stock a bordo: no bloquean el crucero
          <i class="fa-solid fa-chevron-down chevron" :class="{ open: showWarnings }" aria-hidden="true" />
        </button>
        <Transition name="fade">
          <div v-if="showWarnings" class="box-body">
            <p v-if="check.warnings.unavailable.length"><strong>No disponibles en el bar:</strong> {{ check.warnings.unavailable.join(' · ') }}</p>
            <p v-if="check.warnings.low.length"><strong>Stock bajo:</strong> {{ check.warnings.low.join(' · ') }}</p>
            <p class="hint">Cárgalos desde Bodega o pide un requerimiento. El bar verá "No disponible" solo en esos productos.</p>
          </div>
        </Transition>
      </div>

      <p class="note">Iniciar no crea compras ni mueve stock. Queda registrado quién y a qué hora.</p>

      <button type="button" class="btn btn-primary start-btn" :disabled="starting || check.blockers.length > 0" @click="start">
        <i class="fa-solid" :class="starting ? 'fa-spinner fa-spin' : 'fa-ship'" aria-hidden="true" />
        {{ starting ? 'Iniciando…' : 'Iniciar crucero' }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
.start {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.facts {
  display: grid;
  gap: 0.5rem;
  margin: 0;

  div {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 0.6rem;
  }

  dt {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-400);
  }

  dd {
    margin: 0;
    font-weight: 600;
  }
}

.box {
  border-radius: var(--radius-sm);
  padding: 0.75rem 0.9rem;

  ul {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
  }

  &--danger {
    background: rgba(180, 72, 59, 0.08);
    color: var(--danger);
  }

  &--warning {
    background: rgba(185, 128, 47, 0.1);
    color: #7a5419;
  }
}

.box-title {
  font-weight: 700;
}

.box-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-height: 44px;
  font-weight: 700;
  text-align: left;
  color: inherit;
}

.chevron {
  margin-left: auto;
  transition: transform 0.2s ease;

  &.open {
    transform: rotate(180deg);
  }
}

.box-body {
  display: grid;
  gap: 0.4rem;
  font-size: 0.88rem;
  line-height: 1.4;
}

.hint,
.note {
  font-size: 0.85rem;
  color: var(--ink-400);
}

.start-btn {
  min-height: 52px;
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
