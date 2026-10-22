<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { useToastStore } from '@/stores/toast'
import { useCatalogStore, CATEGORY_LABELS } from '@/stores/catalog'
import { apiCreateProduct, apiProducts, apiUpdateProduct } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { formatMoney } from '@/utils/format'
import BaseModal from '@/components/ui/BaseModal.vue'
import ProductIcon from '@/components/ui/ProductIcon.vue'
import type { Product, ProductCategory } from '@/types'

const toast = useToastStore()
const catalogStore = useCatalogStore()

const products = ref<Product[]>([])
const editing = shallowRef<Product | null>(null)
const showForm = shallowRef(false)
const saving = shallowRef(false)

const ICON_OPTIONS = ['beer', 'wine', 'bottle', 'shot', 'cocktail', 'soda', 'water', 'juice', 'snack', 'lime', 'glass']

const form = ref({
  name: '',
  category: 'licor' as ProductCategory,
  icon: 'glass',
  price: 0,
  unit: 'unidad',
  warehouseStock: 0,
})

async function refresh() {
  try {
    products.value = await apiProducts(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

onMounted(refresh)

function openNew() {
  editing.value = null
  form.value = { name: '', category: 'licor', icon: 'glass', price: 0, unit: 'unidad', warehouseStock: 0 }
  showForm.value = true
}

function openEdit(product: Product) {
  editing.value = product
  form.value = {
    name: product.name,
    category: product.category,
    icon: product.icon,
    price: product.price,
    unit: product.unit,
    warehouseStock: product.warehouseStock,
  }
  showForm.value = true
}

async function save() {
  if (!form.value.name) return
  saving.value = true
  try {
    if (editing.value) {
      await apiUpdateProduct(editing.value._id, form.value)
      toast.success('Producto actualizado')
    } else {
      await apiCreateProduct(form.value)
      toast.success('Producto creado')
    }
    showForm.value = false
    await refresh()
    await catalogStore.load(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

async function toggleActive(product: Product) {
  try {
    await apiUpdateProduct(product._id, { active: !product.active })
    toast.success(product.active ? 'Producto desactivado' : 'Producto activado')
    await refresh()
    await catalogStore.load(true)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">Catálogo</h1>
      <button type="button" class="btn btn-gold" @click="openNew">＋ Nuevo producto</button>
    </header>

    <section class="card table-card">
      <table class="table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Categoría</th>
            <th>Precio</th>
            <th>Bodega</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in products" :key="product._id" :class="{ inactive: !product.active }">
            <td class="prod">
              <ProductIcon :icon="product.icon" :size="20" />
              {{ product.name }}
              <span v-if="product.isCustom" class="custom-tag">creado en bar</span>
            </td>
            <td>{{ CATEGORY_LABELS[product.category] }}</td>
            <td><strong>{{ formatMoney(product.price) }}</strong></td>
            <td>{{ product.isCocktail ? '—' : product.warehouseStock }}</td>
            <td>
              <button type="button" class="pill-btn" :class="{ on: product.active }" @click="toggleActive(product)">
                {{ product.active ? 'Activo' : 'Inactivo' }}
              </button>
            </td>
            <td>
              <button type="button" class="edit-btn" @click="openEdit(product)">Editar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <BaseModal v-if="showForm" :title="editing ? 'Editar producto' : 'Nuevo producto'" @close="showForm = false">
      <div class="modal-form">
        <div class="field">
          <label for="p-name">Nombre</label>
          <input id="p-name" v-model="form.name" type="text" />
        </div>
        <div class="row">
          <div class="field">
            <label for="p-cat">Categoría</label>
            <select id="p-cat" v-model="form.category">
              <option v-for="(label, key) in CATEGORY_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
          <div class="field">
            <label for="p-icon">Icono</label>
            <select id="p-icon" v-model="form.icon">
              <option v-for="icon in ICON_OPTIONS" :key="icon" :value="icon">{{ icon }}</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="p-price">Precio (USD)</label>
            <input id="p-price" v-model.number="form.price" type="number" min="0" step="0.25" />
          </div>
          <div class="field">
            <label for="p-unit">Unidad</label>
            <input id="p-unit" v-model="form.unit" type="text" />
          </div>
        </div>
        <div v-if="!editing?.isCocktail" class="field">
          <label for="p-stock">Stock en bodega</label>
          <input id="p-stock" v-model.number="form.warehouseStock" type="number" min="0" />
        </div>
        <button type="button" class="btn btn-gold" :disabled="saving" @click="save">
          {{ saving ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;

  .page-title {
    margin-bottom: 0;
  }
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

  tr.inactive td {
    opacity: 0.5;
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

.custom-tag {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--gold-500);
  background: rgba(232, 184, 75, 0.15);
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
}

.pill-btn {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  background: var(--cream-200);
  color: var(--ink-400);

  &.on {
    background: rgba(63, 174, 106, 0.15);
    color: var(--success);
  }
}

.edit-btn {
  font-weight: 700;
  color: var(--navy-600);
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
</style>
