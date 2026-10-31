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
  <div class="page cat">
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">Catálogo</h1>
        <p class="page-lead">
          Lo que se vende y se cuenta: los físicos llevan stock, las recetas descuentan sus ingredientes
          y los servicios no mueven inventario.
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-gold" @click="editor = { product: null }">
          <i class="fa-solid fa-plus" aria-hidden="true" /> Nuevo producto
        </button>
      </div>
    </header>

    <div class="tools">
      <div class="segs" role="tablist" aria-label="Tipo de producto">
        <button
          v-for="k in (['todos', 'fisico', 'receta', 'servicio'] as const)"
          :key="k"
          type="button"
          role="tab"
          class="segs-item"
          :class="{ 'segs-item--on': kindFilter === k }"
          :aria-selected="kindFilter === k"
          @click="kindFilter = k"
        >
          {{ k === 'todos' ? 'Todos' : KIND_LABELS[k] }}
          <span class="segs-count num">{{ counts[k] }}</span>
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
              <th class="col-kind">Tipo</th>
              <th class="num">Precio</th>
              <th class="col-detail">Medida o receta</th>
              <th>Estado</th>
              <th><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in visible" :key="p._id" :class="{ inactive: !p.active }">
              <td>
                <span class="prod">
                  <ProductIcon :icon="p.icon" :size="22" />
                  <span class="prod-text">
                    <span class="prod-name">
                      {{ p.name }}
                      <span v-if="p.isCustom" class="custom-tag">creado en bar</span>
                    </span>
                    <small>
                      {{ CATEGORY_LABELS[p.category] }}
                      <span class="kind-inline">· {{ KIND_LABELS[p.kind] }}</span>
                    </small>
                  </span>
                </span>
              </td>
              <td class="col-kind"><span class="kind" :class="`kind--${p.kind}`">{{ KIND_LABELS[p.kind] }}</span></td>
              <td class="num">
                <strong v-if="p.kind !== 'fisico' || p.sellable">{{ formatMoney(p.price) }}</strong>
                <span v-else class="muted">Insumo</span>
              </td>
              <td class="detail col-detail">
                <template v-if="p.kind === 'fisico'">
                  {{ p.containerSize > 1 ? `${formatNumber(p.containerSize)} ${unitShort(p.stockUnit)} por ${p.containerLabel}` : p.containerLabel }}
                </template>
                <template v-else-if="p.kind === 'receta'">{{ recipeSummary(p) }}</template>
                <template v-else>Sin inventario</template>
              </td>
              <td>
                <button
                  type="button"
                  class="state"
                  :class="{ on: p.active }"
                  :aria-pressed="p.active"
                  :aria-label="`${p.name}: ${p.active ? 'activo, tocar para desactivar' : 'inactivo, tocar para activar'}`"
                  @click="toggleActive(p)"
                >
                  <span class="state-dot" aria-hidden="true" />
                  <span class="state-label">{{ p.active ? 'Activo' : 'Inactivo' }}</span>
                </button>
              </td>
              <td class="col-edit">
                <button type="button" class="btn btn-secondary edit-btn" @click="editor = { product: p }">
                  <i class="fa-solid fa-pen" aria-hidden="true" /> <span class="edit-label">Editar</span>
                </button>
              </td>
            </tr>
            <tr v-if="!visible.length">
              <td colspan="6" class="empty">Ningún producto con ese nombre o tipo.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="!userStore.isAdmin" class="note">
      <i class="fa-solid fa-lock" aria-hidden="true" /> Solo Gerencia cambia precios. Puedes editar
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

.cat {
  max-width: 1240px;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 0.75rem;
  margin-bottom: 0.9rem;
}

.search {
  flex: 1 1 240px;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 48px;
  padding: 0 0.95rem;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-400);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:focus-within {
    border-color: var(--navy-600);
    box-shadow: var(--focus-ring);
  }

  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1rem;
    color: var(--ink-900);
  }
}

.table-card {
  padding: 0.5rem 0.75rem;

  @include tablet {
    padding: 0.75rem 1.1rem;
  }
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 1rem;

  @media (max-width: 639px) {
    th,
    td {
      padding-left: 0.3rem !important;
      padding-right: 0.3rem !important;
    }
  }

  th {
    text-align: left;
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--ink-400);
    padding: 0.65rem 0.5rem;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  td {
    padding: 0.7rem 0.5rem;
    border-bottom: 1px solid var(--rule);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tr.inactive td > * {
    opacity: 0.55;
  }

  tr.inactive td .state {
    opacity: 1;
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
  gap: 0.6rem;

  svg {
    color: var(--navy-700);
    flex-shrink: 0;
  }

  @include tablet {
    min-width: 210px;
  }
}

.prod-text {
  display: flex;
  flex-direction: column;
  min-width: 0;

  small {
    font-size: 0.88rem;
    color: var(--ink-400);
  }
}

.prod-name {
  font-weight: 600;
}

.custom-tag {
  display: inline-block;
  margin-left: 0.3rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--pill-warn-ink);
  background: var(--pill-warn-bg);
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
  vertical-align: 1px;
}

// En celular el tipo va en la segunda línea y la medida se omite (se ve al editar).
.kind-inline {
  @include tablet {
    display: none;
  }
}

.col-kind,
.col-detail {
  display: none;

  @include tablet {
    display: table-cell;
  }
}

.col-detail {
  @include tablet {
    display: none;
  }

  @include desktop {
    display: table-cell;
  }
}

.kind {
  font-size: 0.84rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  white-space: nowrap;

  &--fisico {
    background: var(--pill-info-bg);
    color: var(--pill-info-ink);
  }

  &--receta {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }

  &--servicio {
    background: var(--pill-neutral-bg);
    color: var(--pill-neutral-ink);
  }
}

.detail {
  color: var(--ink-600);
  font-size: 0.92rem;
  min-width: 220px;
  max-width: 340px;
}

.muted {
  color: var(--ink-400);
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 44px;
  padding: 0 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--ink-400);
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &.on {
    border-color: transparent;
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }

  &:hover {
    border-color: var(--navy-600);
  }
}

.state-label {
  @media (max-width: 639px) {
    display: none;
  }
}

.state {
  @media (max-width: 639px) {
    justify-content: center;
    width: 44px;
    padding: 0;
  }
}

.state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-300);

  .on & {
    background: var(--success);
  }
}

.col-edit {
  text-align: right;
}

.edit-btn {
  min-width: 48px;
  padding: 0.5rem 0.85rem;
  font-size: 0.95rem;
}

.edit-label {
  display: none;

  @include tablet {
    display: inline;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.empty {
  color: var(--ink-600);
  padding: 1.25rem 0.5rem;
}

.note {
  margin: 0.8rem 0 0;
  font-size: 0.95rem;
  color: var(--ink-600);
}
</style>
