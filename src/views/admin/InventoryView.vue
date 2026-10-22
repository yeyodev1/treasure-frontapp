<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useCruiseStore } from '@/stores/cruise'
import { useCatalogStore } from '@/stores/catalog'
import { useToastStore } from '@/stores/toast'
import {
  apiAdjustStock,
  apiCruiseStock,
  apiLoadStock,
  apiMovements,
  apiRegisterWaste,
  apiWarehousePurchase,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatDateTime } from '@/utils/format'
import BaseModal from '@/components/ui/BaseModal.vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import type { CruiseStockItem, StockMovement } from '@/types'

const cruiseStore = useCruiseStore()
const catalogStore = useCatalogStore()
const toast = useToastStore()
const { active: cruise } = storeToRefs(cruiseStore)
const { products } = storeToRefs(catalogStore)

const stock = ref<CruiseStockItem[]>([])
const movements = ref<StockMovement[]>([])
const tab = shallowRef<'abordo' | 'bodega' | 'bitacora'>('abordo')

type ModalKind = 'merma' | 'ajuste' | 'carga' | 'compra' | null
const modal = shallowRef<ModalKind>(null)
const form = ref({ productId: '', qty: 1, reason: '' })
const saving = shallowRef(false)

const MOVEMENT_LABELS: Record<StockMovement['type'], string> = {
  carga: 'Carga',
  venta: 'Venta',
  merma: 'Merma',
  cortesia: 'Cortesía',
  ajuste: 'Ajuste',
  compra: 'Compra',
}

const lowStock = computed(() =>
  stock.value.filter((s) => s.initialQty > 0 && s.currentQty / s.initialQty <= 0.2),
)

async function refresh() {
  try {
    await Promise.all([catalogStore.load(), cruiseStore.loadActive()])
    if (cruise.value) {
      stock.value = await apiCruiseStock(cruise.value._id)
    }
    movements.value = await apiMovements(cruise.value ? { cruiseId: cruise.value._id } : {})
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

onMounted(refresh)

function openModal(kind: Exclude<ModalKind, null>) {
  form.value = { productId: '', qty: 1, reason: '' }
  modal.value = kind
}

const MODAL_TITLES: Record<Exclude<ModalKind, null>, string> = {
  merma: 'Registrar merma',
  ajuste: 'Ajuste de inventario',
  carga: 'Cargar stock al crucero',
  compra: 'Ingreso a bodega',
}

async function submitModal() {
  if (!form.value.productId || !form.value.qty) return
  saving.value = true
  try {
    const { productId, qty, reason } = form.value
    if (modal.value === 'merma' && cruise.value) {
      await apiRegisterWaste({ cruiseId: cruise.value._id, productId, qty, reason })
    } else if (modal.value === 'ajuste' && cruise.value) {
      await apiAdjustStock({ cruiseId: cruise.value._id, productId, qty, reason })
    } else if (modal.value === 'carga' && cruise.value) {
      await apiLoadStock(cruise.value._id, [{ productId, qty }])
    } else if (modal.value === 'compra') {
      await apiWarehousePurchase([{ productId, qty }])
    }
    toast.success('Movimiento registrado')
    modal.value = null
    await refresh()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">Inventario</h1>

    <div v-if="lowStock.length" class="alert">
      ⚠️ Stock bajo a bordo:
      {{ lowStock.map((s) => s.product.name).join(', ') }}
    </div>

    <div class="tabs">
      <button
        v-for="t in ['abordo', 'bodega', 'bitacora'] as const"
        :key="t"
        type="button"
        class="tab"
        :class="{ 'tab--active': tab === t }"
        @click="tab = t"
      >
        {{ t === 'abordo' ? 'A bordo' : t === 'bodega' ? 'Bodega' : 'Bitácora' }}
      </button>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-ghost" @click="openModal('carga')">Cargar crucero</button>
      <button type="button" class="btn btn-ghost" @click="openModal('merma')">Merma</button>
      <button type="button" class="btn btn-ghost" @click="openModal('ajuste')">Ajuste</button>
      <button type="button" class="btn btn-ghost" @click="openModal('compra')">Compra bodega</button>
    </div>

    <section v-if="tab === 'abordo'" class="card table-card">
      <p v-if="!cruise" class="empty">No hay crucero activo.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Inicial</th>
            <th>Actual</th>
            <th>Consumido</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in stock" :key="item._id" :class="{ low: item.initialQty > 0 && item.currentQty / item.initialQty <= 0.2 }">
            <td class="prod">
              <ProductIcon :icon="item.product.icon" :size="20" />
              {{ item.product.name }}
            </td>
            <td>{{ item.initialQty }}</td>
            <td><strong>{{ item.currentQty }}</strong></td>
            <td>{{ item.initialQty - item.currentQty }}</td>
          </tr>
          <tr v-if="!stock.length">
            <td colspan="4" class="empty">Aún no se carga stock a este crucero.</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-else-if="tab === 'bodega'" class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Stock en bodega</th>
            <th>Unidad</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in products" :key="product._id">
            <td class="prod">
              <ProductIcon :icon="product.icon" :size="20" />
              {{ product.name }}
            </td>
            <td><strong>{{ product.warehouseStock }}</strong></td>
            <td>{{ product.unit }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-else class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Producto</th>
            <th>Cant.</th>
            <th>Persona</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in movements" :key="m._id">
            <td>{{ formatDateTime(m.createdAt) }}</td>
            <td>
              <span class="pill" :class="`pill--${m.type}`">{{ MOVEMENT_LABELS[m.type] }}</span>
            </td>
            <td>{{ m.product?.name }}</td>
            <td :class="{ neg: m.qty < 0 }">{{ m.qty }}</td>
            <td>{{ m.user?.name }}</td>
            <td class="reason">{{ m.reason }}</td>
          </tr>
          <tr v-if="!movements.length">
            <td colspan="6" class="empty">Sin movimientos.</td>
          </tr>
        </tbody>
      </table>
    </section>

    <BaseModal v-if="modal" :title="MODAL_TITLES[modal]" @close="modal = null">
      <div class="modal-form">
        <div class="field">
          <label for="mv-product">Producto</label>
          <select id="mv-product" v-model="form.productId">
            <option value="" disabled>Elige…</option>
            <option v-for="p in products.filter((x) => !x.isCocktail)" :key="p._id" :value="p._id">
              {{ p.name }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="mv-qty">
            Cantidad {{ modal === 'ajuste' ? '(positiva suma, negativa resta)' : '' }}
          </label>
          <input id="mv-qty" v-model.number="form.qty" type="number" step="1" />
        </div>
        <div v-if="modal === 'merma' || modal === 'ajuste'" class="field">
          <label for="mv-reason">Motivo</label>
          <input
            id="mv-reason"
            v-model="form.reason"
            type="text"
            placeholder="Ej. se cayó una botella"
          />
        </div>
        <button type="button" class="btn btn-gold" :disabled="saving" @click="submitModal">
          {{ saving ? 'Guardando…' : 'Registrar' }}
        </button>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.alert {
  background: rgba(232, 161, 60, 0.15);
  border: 1.5px solid var(--warning);
  color: var(--navy-900);
  border-radius: var(--radius-sm);
  padding: 0.65rem 0.9rem;
  font-size: 0.88rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.tab {
  padding: 0.45rem 1rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.85rem;
  background: var(--surface);
  border: 1.5px solid var(--cream-200);
  color: var(--ink-600);

  &--active {
    background: var(--navy-800);
    border-color: var(--navy-800);
    color: var(--cream-100);
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.table-card {
  overflow-x: auto;
  padding: 0.5rem;

  @include tablet {
    padding: 0.75rem;
  }
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;

  th {
    text-align: left;
    font-size: 0.72rem;
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

  tr.low td {
    background: rgba(224, 82, 82, 0.07);
  }
}

.prod {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 600;
  white-space: nowrap;

  svg {
    color: var(--navy-700);
    flex-shrink: 0;
  }
}

.neg {
  color: var(--danger);
  font-weight: 700;
}

.reason {
  color: var(--ink-400);
  font-size: 0.82rem;
}

.pill {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--cream-200);
  white-space: nowrap;

  &--venta {
    background: rgba(27, 67, 112, 0.12);
    color: var(--navy-600);
  }

  &--merma {
    background: rgba(224, 82, 82, 0.14);
    color: var(--danger);
  }

  &--carga,
  &--compra {
    background: rgba(63, 174, 106, 0.14);
    color: var(--success);
  }
}

.empty {
  color: var(--ink-400);
  text-align: center;
  padding: 1rem;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
</style>
