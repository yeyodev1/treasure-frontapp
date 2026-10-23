<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useToastStore } from '@/stores/toast'
import { useCatalogStore, CATEGORY_LABELS } from '@/stores/catalog'
import { useConfirmStore } from '@/stores/confirm'
import { useUserStore } from '@/stores/user'
import { useSound } from '@/composables/useSound'
import { apiProducts, apiUpdateProduct } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney, formatNumber, unitShort } from '@/utils/format'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import ProductEditor from '@/components/catalog/ProductEditor.vue'
import type { Product, ProductKind } from '@/types'

const toast = useToastStore()
const catalogStore = useCatalogStore()
const confirmStore = useConfirmStore()
const userStore = useUserStore()
const { play } = useSound()

const products = shallowRef<Product[]>([])
const loading = shallowRef(true)
const kindFilter = shallowRef<ProductKind | 'todos'>('todos')
const query = shallowRef('')
const editor = shallowRef<{ product: Product | null } | null>(null)

const KIND_LABELS: Record<ProductKind, string> = {
  fisico: 'Físico',
  receta: 'Receta',
  servicio: 'Servicio',
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const physical = computed(() => products.value.filter((p) => p.kind === 'fisico' && p.active))

const visible = computed(() => {
  const q = normalize(query.value.trim())
  return products.value.filter(
    (p) => (kindFilter.value === 'todos' || p.kind === kindFilter.value) && (!q || normalize(p.name).includes(q)),
  )
})

const counts = computed(() => ({
  todos: products.value.length,
  fisico: products.value.filter((p) => p.kind === 'fisico').length,
  receta: products.value.filter((p) => p.kind === 'receta').length,
  servicio: products.value.filter((p) => p.kind === 'servicio').length,
}))

function recipeSummary(p: Product): string {
  return p.recipe
    .map((r) =>
      typeof r.product === 'object'
        ? `${formatNumber(r.qty)} ${unitShort(r.product.stockUnit)} ${r.product.name.replace(' (botella)', '')}`
        : '',
    )
    .filter(Boolean)
    .join(' · ')
}

async function refresh() {
  try {
    products.value = await apiProducts({ all: true })
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

async function onSaved() {
  editor.value = null
  await refresh()
  await catalogStore.load(true)
}

async function toggleActive(product: Product) {
  const deactivating = product.active
  const ok = await confirmStore.ask({
    title: deactivating ? `¿Desactivar ${product.name}?` : `¿Activar ${product.name}?`,
    message: deactivating
      ? 'Deja de aparecer en el bar. Su historial se conserva.'
      : 'Vuelve a estar disponible en el bar.',
    confirmLabel: deactivating ? 'Desactivar' : 'Activar',
    icon: deactivating ? 'fa-eye-slash' : 'fa-eye',
    danger: deactivating,
  })
  if (!ok) return
  try {
    await apiUpdateProduct(product._id, { active: !product.active })
    play('success')
    toast.success(deactivating ? 'Producto desactivado' : 'Producto activado')
    await refresh()
    await catalogStore.load(true)
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">Catálogo</h1>
        <p class="hint">
          Físicos llevan stock en su unidad · Recetas descuentan sus ingredientes · Servicios no mueven
          inventario.
        </p>
      </div>
      <button type="button" class="btn btn-gold" @click="editor = { product: null }">
        <i class="fa-solid fa-plus" aria-hidden="true" /> Nuevo producto
      </button>
    </header>

    <div class="tools">
      <div class="tabs">
        <button
          v-for="k in (['todos', 'fisico', 'receta', 'servicio'] as const)"
          :key="k"
          type="button"
          class="tab"
          :class="{ 'tab--on': kindFilter === k }"
          @click="kindFilter = k"
        >
          {{ k === 'todos' ? 'Todos' : KIND_LABELS[k] }} <span class="tab-count">{{ counts[k] }}</span>
        </button>
      </div>
      <label class="search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="Buscar producto" aria-label="Buscar producto" />
      </label>
    </div>

    <section class="card table-card">
      <SkeletonList v-if="loading" variant="row" :rows="10" />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Tipo</th>
              <th class="num">Precio</th>
              <th>Medida / receta</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in visible" :key="p._id" :class="{ inactive: !p.active }">
              <td class="prod">
                <ProductIcon :icon="p.icon" :size="20" />
                <span>
                  {{ p.name }}
                  <small>{{ CATEGORY_LABELS[p.category] }}</small>
                </span>
                <span v-if="p.isCustom" class="custom-tag">creado en bar</span>
              </td>
              <td><span class="kind" :class="`kind--${p.kind}`">{{ KIND_LABELS[p.kind] }}</span></td>
              <td class="num">
                <strong v-if="p.kind !== 'fisico' || p.sellable">{{ formatMoney(p.price) }}</strong>
                <span v-else class="muted">Insumo</span>
              </td>
              <td class="detail">
                <template v-if="p.kind === 'fisico'">
                  {{ p.containerSize > 1 ? `${formatNumber(p.containerSize)} ${unitShort(p.stockUnit)} por ${p.containerLabel}` : p.containerLabel }}
                </template>
                <template v-else-if="p.kind === 'receta'">{{ recipeSummary(p) }}</template>
                <template v-else>Sin inventario</template>
              </td>
              <td>
                <button type="button" class="state" :class="{ on: p.active }" @click="toggleActive(p)">
                  {{ p.active ? 'Activo' : 'Inactivo' }}
                </button>
              </td>
              <td>
                <button type="button" class="edit-btn" @click="editor = { product: p }">
                  <i class="fa-solid fa-pen" aria-hidden="true" /> Editar
                </button>
              </td>
            </tr>
            <tr v-if="!visible.length">
              <td colspan="6" class="empty">Sin resultados.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="!userStore.isAdmin" class="note">
      <i class="fa-solid fa-lock" aria-hidden="true" /> Solo Paula cambia precios. Puedes editar
      nombres, recetas e inventario.
    </p>

    <ProductEditor
      v-if="editor"
      :product="editor.product"
      :physical="physical"
      @close="editor = null"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0.15rem;
  }
}

.hint {
  margin: 0;
  color: var(--ink-400);
  font-size: 0.86rem;
}

.tools {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}

.tabs {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab {
  flex-shrink: 0;
  min-height: 42px;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1.5px solid var(--cream-200);
  background: var(--surface);
  font-weight: 600;
  font-size: 0.86rem;
  color: var(--ink-600);
  transition: all 0.15s ease;

  &--on {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: #fff;
  }
}

.tab-count {
  font-size: 0.74rem;
  opacity: 0.7;
  margin-left: 0.2rem;
}

.search {
  flex: 1;
  min-width: 200px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 42px;
  padding: 0 0.85rem;
  border: 1.5px solid var(--cream-200);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-400);

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
  }
}

.table-card {
  padding: 0.75rem;
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;

  th {
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-400);
    padding: 0.5rem 0.6rem;
    border-bottom: 2px solid var(--cream-200);
    white-space: nowrap;
  }

  td {
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid var(--cream-200);
  }

  tr.inactive td {
    opacity: 0.5;
  }
}

.num {
  text-align: right !important;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.prod {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  min-width: 200px;

  svg {
    color: var(--navy-700);
    flex-shrink: 0;
  }

  small {
    display: block;
    font-weight: 500;
    font-size: 0.72rem;
    color: var(--ink-400);
  }
}

.custom-tag {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--gold-500);
  background: rgba(159, 107, 60, 0.12);
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  white-space: nowrap;
}

.kind {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  white-space: nowrap;

  &--fisico {
    background: var(--powder-100);
    color: var(--navy-700);
  }

  &--receta {
    background: rgba(159, 107, 60, 0.13);
    color: var(--gold-500);
  }

  &--servicio {
    background: var(--cream-100);
    color: var(--ink-600);
  }
}

.detail {
  color: var(--ink-600);
  font-size: 0.8rem;
  min-width: 220px;
}

.muted {
  color: var(--ink-400);
}

.state {
  font-size: 0.74rem;
  font-weight: 700;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  background: var(--cream-100);
  color: var(--ink-400);

  &.on {
    background: rgba(63, 122, 87, 0.13);
    color: var(--success);
  }
}

.edit-btn {
  font-weight: 700;
  color: var(--navy-700);
  white-space: nowrap;
}

.empty {
  text-align: center;
  color: var(--ink-400);
  padding: 1rem;
}

.note {
  margin: 0.8rem 0 0;
  font-size: 0.84rem;
  color: var(--ink-400);
}
</style>
