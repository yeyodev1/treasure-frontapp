<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import { CATEGORY_LABELS } from '@/stores/catalog'
import { normalize, plural } from '@/components/supply/units'
import type { Product, ProductCategory } from '@/types'

/**
 * Lista para contar lo que hay (BAR - STOCK): todas las bebidas por categoría,
 * con buscador y el campo TENGO. Los licores se cuentan en botellas cerradas
 * más la abierta. La usan el bar (con PEDIR al lado) y la auditoría de Tierra.
 */
const props = defineProps<{
  products: Product[]
  /** Lo contado por producto, en envases; null o ausente = sin contar. */
  counts: Record<string, number | null | undefined>
  /** Marca la fila (p. ej. algo para pedir). */
  highlight?: (p: Product) => boolean
}>()
const emit = defineEmits<{ set: [product: Product, counted: number] }>()

const ORDER_OF: ProductCategory[] = ['licor', 'vino', 'cerveza', 'gaseosa', 'agua', 'jugo', 'insumo', 'snack', 'otro']
/** Licores (y toda botella en ml: Baileys, Campari, vinos) se cuentan en cerradas + abierta (pedido del cliente). */
const isLiquor = (p: Product) => p.category === 'licor' || (p.stockUnit === 'ml' && /^botella/i.test(p.containerLabel || ''))
const OPEN_PARTS = [
  { value: 0, label: 'No hay' },
  { value: 0.25, label: '¼' },
  { value: 0.5, label: '½' },
  { value: 0.75, label: '¾' },
]

const search = shallowRef('')

/** Lo que dice el sistema que hay a bordo, en envases (licores al ¼ más cercano). */
function systemCount(p: Product): number {
  const n = Math.max(0, (p.onboardStock ?? 0) / (p.containerSize || 1))
  return isLiquor(p) ? Math.round(n * 4) / 4 : Math.round(n)
}

const counted = (p: Product) => props.counts[p._id] != null
const shown = (p: Product) => props.counts[p._id] ?? systemCount(p)
const closed = (p: Product) => Math.floor(shown(p) + 1e-9)
const openPart = (p: Product) => Math.round((shown(p) - closed(p)) * 4) / 4
const unitOf = (p: Product, n: number) => plural(p.containerLabel || 'unidad', n)

const groups = computed(() => {
  const q = normalize(search.value.trim())
  const byCat = new Map<ProductCategory, Product[]>()
  for (const p of props.products) {
    if (q && !normalize(p.name).includes(q)) continue
    const cat = ORDER_OF.includes(p.category) ? p.category : 'otro'
    byCat.set(cat, [...(byCat.get(cat) ?? []), p])
  }
  return ORDER_OF.filter((c) => byCat.has(c)).map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c],
    items: byCat.get(c)!.sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }))
})
</script>

<template>
  <label class="search">
    <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
    <input v-model="search" type="search" placeholder="Buscar bebida" aria-label="Buscar bebida" />
  </label>

  <p v-if="!groups.length" class="muted">Ninguna bebida coincide con «{{ search }}».</p>

  <section v-for="g in groups" :key="g.category" class="group" :aria-label="g.label">
    <h3 class="group-title">
      {{ g.label }} <small>{{ g.items.length }}</small>
    </h3>
    <article v-for="p in g.items" :key="p._id" class="row" :class="{ 'row--counted': counted(p), 'row--order': highlight?.(p) }">
      <div class="row-name">
        <ProductIcon :icon="p.icon || 'bottle'" :size="22" />
        <span>
          <strong>{{ p.name }}</strong>
          <small v-if="!counted(p)" class="pending">
            Sin contar · el sistema dice {{ systemCount(p) }}
            <button type="button" class="ok" @click="emit('set', p, systemCount(p))">
              <i class="fa-solid fa-check" aria-hidden="true" /> Está bien
            </button>
          </small>
          <small v-else class="done"><i class="fa-solid fa-circle-check" aria-hidden="true" /> Contado</small>
        </span>
      </div>

      <div class="field">
        <span class="field-label">TENGO</span>
        <template v-if="isLiquor(p)">
          <QtyStepper
            :model-value="closed(p)"
            :min="0"
            allow-zero
            unit="cerradas"
            :label="`Botellas cerradas de ${p.name}`"
            @update:model-value="emit('set', p, $event + openPart(p))"
          />
          <div class="open" role="radiogroup" :aria-label="`Botella abierta de ${p.name}`">
            <span class="open-label">Abierta</span>
            <button
              v-for="o in OPEN_PARTS"
              :key="o.value"
              type="button"
              role="radio"
              :aria-checked="counted(p) && openPart(p) === o.value"
              :class="{ on: counted(p) && openPart(p) === o.value }"
              @click="emit('set', p, closed(p) + o.value)"
            >
              {{ o.label }}
            </button>
          </div>
        </template>
        <QtyStepper
          v-else
          :model-value="shown(p)"
          :min="0"
          allow-zero
          :unit="unitOf(p, shown(p))"
          :label="`Cuántos tengo de ${p.name}`"
          @update:model-value="emit('set', p, $event)"
        />
      </div>

      <slot name="extra" :product="p" />
    </article>
  </section>
</template>

<style scoped lang="scss">
.search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0 0.9rem;
  min-height: 48px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-600);

  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: 1rem;
    color: var(--ink-900);
    outline: none;
  }

  &:focus-within {
    border-color: var(--navy-600);
    box-shadow: 0 0 0 3px var(--powder-200);
  }
}

.group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-title {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0.5rem 0 0;
  padding: 0.45rem 0;
  font-size: 1.05rem;
  background: var(--bg);

  small {
    font-weight: 400;
    color: var(--ink-400);
  }
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  padding: 0.8rem 1rem;
  border: 1px solid var(--line);
  border-left: 4px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);

  &--counted {
    border-left-color: var(--success-ink);
  }
}

.row-name {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1 1 220px;
  min-width: 0;

  span {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  strong {
    color: var(--ink-900);
  }

  small {
    font-size: 0.82rem;
  }

  .pending {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.6rem;
    color: var(--ink-400);
  }

  .done {
    color: var(--success-ink);
    font-weight: 600;
  }
}

.field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--navy-700);
}

.open {
  display: flex;
  align-items: center;
  gap: 0.3rem;

  button {
    min-width: 44px;
    min-height: 44px;
    padding: 0 0.6rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink-900);
    font-size: 0.95rem;
    cursor: pointer;

    &.on {
      background: var(--navy-700);
      border-color: var(--navy-700);
      color: #fff;
    }
  }
}

.open-label {
  font-size: 0.82rem;
  color: var(--ink-600);
}

.ok {
  min-height: 40px;
  padding: 0 0.8rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-600);
  font-size: 0.9rem;
  cursor: pointer;

  &:hover {
    border-color: var(--success-ink);
    color: var(--ink-900);
  }
}
</style>
