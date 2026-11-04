<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useTemplateRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import { CATEGORY_LABELS } from '@/stores/catalog'
import { useSound } from '@/composables/useSound'
import type { Product, ProductCategory, StockLocation } from '@/types'
import { ALL_LOCATIONS, hasContainer, LOCATION_LABEL, normalize, stockAt, stockText } from './units'

/** Buscador táctil de insumos: búsqueda grande y filas de 56 px. */
const props = defineProps<{
  products: Product[]
  title?: string
  /** Saldo que se muestra en cada fila. */
  show?: StockLocation | 'ambos'
  /** Ya elegidos: se marcan y no se vuelven a agregar. */
  taken?: string[]
}>()

const emit = defineEmits<{ pick: [product: Product]; close: [] }>()
const { play } = useSound()

const query = shallowRef('')
const category = shallowRef<ProductCategory | ''>('')
const input = useTemplateRef<HTMLInputElement>('input')

onMounted(async () => {
  await nextTick()
  input.value?.focus()
})

const categories = computed(() => {
  const seen = new Set(props.products.map((p) => p.category))
  return (Object.keys(CATEGORY_LABELS) as ProductCategory[]).filter((c) => seen.has(c))
})

const visible = computed(() => {
  const q = normalize(query.value.trim())
  return props.products.filter(
    (p) => (!category.value || p.category === category.value) && (!q || normalize(p.name).includes(q)),
  )
})

function balance(p: Product): string {
  if (props.show === 'ambos') {
    const parts = ALL_LOCATIONS.filter((l) => l !== 'bodega' || stockAt(p, l) !== 0).map(
      (l) => `${LOCATION_LABEL[l]} ${stockText(stockAt(p, l), p)}`,
    )
    return parts.join(' · ')
  }
  if (props.show) return `${LOCATION_LABEL[props.show]}: ${stockText(stockAt(p, props.show), p)}`
  return hasContainer(p) ? `${p.containerLabel} de ${p.containerSize} ${p.stockUnit}` : p.containerLabel
}

function pick(p: Product) {
  if (props.taken?.includes(p._id)) return
  play('tap')
  emit('pick', p)
}
</script>

<template>
  <BaseModal :title="title ?? 'Elegir producto'" @close="emit('close')">
    <div class="picker">
      <label class="search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          type="text"
          autocomplete="off"
          placeholder="Escribe el nombre: tanqueray, coca…"
          aria-label="Buscar producto"
        />
        <button v-if="query" type="button" class="clear" aria-label="Borrar búsqueda" @click="query = ''">
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </label>

      <div class="chips">
        <button type="button" class="chip" :class="{ on: !category }" @click="category = ''">Todos</button>
        <button
          v-for="c in categories"
          :key="c"
          type="button"
          class="chip"
          :class="{ on: category === c }"
          @click="category = c"
        >
          {{ CATEGORY_LABELS[c] }}
        </button>
      </div>

      <TransitionGroup tag="ul" name="row" class="list">
        <li v-for="p in visible.slice(0, 60)" :key="p._id">
          <button
            type="button"
            class="item"
            :class="{ taken: taken?.includes(p._id) }"
            :disabled="taken?.includes(p._id)"
            @click="pick(p)"
          >
            <ProductIcon :icon="p.icon" :size="26" />
            <span class="item-text">
              <strong>{{ p.name }}</strong>
              <small>{{ balance(p) }}</small>
            </span>
            <i
              class="fa-solid"
              :class="taken?.includes(p._id) ? 'fa-check' : 'fa-plus'"
              aria-hidden="true"
            />
          </button>
        </li>
      </TransitionGroup>
      <p v-if="!products.length" class="empty">Cargando productos…</p>
      <p v-else-if="!visible.length" class="empty">No hay productos con ese nombre.</p>
      <p v-else-if="visible.length > 60" class="empty">Sigue escribiendo para ver más resultados.</p>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 56px;
  padding: 0 0.5rem 0 1rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--ink-400);
  font-size: 1.05rem;
  transition: border-color 0.15s ease;

  &:focus-within {
    border-color: var(--gold-500);
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1.05rem;
    color: var(--ink-900);
  }
}

.clear {
  @include touch-target;
  display: grid;
  place-items: center;
  color: var(--ink-400);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  min-height: 48px;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--ink-600);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;

  &.on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.item {
  width: 100%;
  min-height: 60px;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  text-align: left;
  background: #fff;
  transition:
    border-color 0.15s ease,
    transform 0.12s ease,
    background 0.15s ease;

  svg {
    color: var(--navy-700);
    flex-shrink: 0;
  }

  > i {
    margin-left: auto;
    color: var(--gold-500);
    font-size: 1.1rem;
  }

  &:active:not(:disabled) {
    transform: scale(0.985);
    background: var(--powder-100);
  }

  &.taken {
    opacity: 0.55;
    cursor: default;

    > i {
      color: var(--success);
    }
  }
}

.item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong {
    font-size: 1rem;
  }

  small {
    color: var(--ink-400);
    font-size: 0.88rem;
  }
}

.empty {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.9rem;
}

.row-enter-active,
.row-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.row-enter-from,
.row-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.row-leave-active {
  display: none;
}
</style>
