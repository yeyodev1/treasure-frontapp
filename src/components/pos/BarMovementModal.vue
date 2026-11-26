<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import QtyStepper from '@/components/supply/QtyStepper.vue'
import { apiAuthorizers, apiCreateBarMovement, apiUploadPhoto } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { useSound } from '@/composables/useSound'
import { plural } from '@/components/supply/units'
import type { Product } from '@/types'

/**
 * Rotura y salida en la pantalla del bar (Bar-stock, 24-nov-2026). Se
 * registran en el momento y descuentan el stock: así no aparecen como
 * diferencia al cierre. Rotura exige foto; salida exige tipo y quién autorizó.
 */
const props = defineProps<{ type: 'rotura' | 'salida'; products: Product[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const toast = useToastStore()
const { play } = useSound()

const FRESH_UNITS = new Set(['ramita', 'rodaja', 'cucharadita', 'cucharada', 'gota', 'golpe', 'porción'])
const options = computed(() =>
  props.products
    .filter((p) => !p.fresh && !FRESH_UNITS.has(p.stockUnit) && !/clara de huevo|\(fruta\)/i.test(p.name))
    .map((p) => ({ value: p._id, label: p.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es')),
)
const productId = shallowRef('')
const product = computed(() => props.products.find((p) => p._id === productId.value) ?? null)
/** Licores, vinos y envases en ml: botellas enteras más la que se rompió a medias. */
const bottle = computed(() => Boolean(product.value && product.value.stockUnit === 'ml' && (product.value.containerSize ?? 1) > 1))
const whole = shallowRef(1)
const PARTS = [
  { value: 0, label: 'Ninguna' },
  { value: 0.25, label: '¼' },
  { value: 0.5, label: '½' },
  { value: 0.75, label: '¾' },
]
const part = shallowRef(0)
const qty = computed(() => (bottle.value ? whole.value + part.value : whole.value))

const EXITS = [
  { value: 'cocina', label: 'Cocina' },
  { value: 'tripulacion', label: 'Tripulación' },
  { value: 'brindis', label: 'Brindis' },
] as const
const exitKind = shallowRef<'cocina' | 'tripulacion' | 'brindis'>('cocina')
const authorizers = shallowRef<Array<{ value: string; label: string }>>([])
const authorizedById = shallowRef('')
const note = shallowRef('')
const photo = shallowRef('')
const uploading = shallowRef(false)
const saving = shallowRef(false)
let key = crypto.randomUUID()

onMounted(async () => {
  if (props.type !== 'salida') return
  try {
    authorizers.value = (await apiAuthorizers()).map((u) => ({ value: u._id, label: u.name }))
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
})

async function pickPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  try {
    photo.value = await apiUploadPhoto(file, 'roturas')
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    uploading.value = false
  }
}

const error = computed(() => {
  if (!product.value) return 'Elige el producto'
  if (!(qty.value > 0)) return 'Indica la cantidad'
  if (props.type === 'rotura' && !photo.value) return 'Toma la foto de la rotura'
  if (props.type === 'salida' && !authorizedById.value) return 'Elige quién autorizó'
  return ''
})

async function save() {
  if (error.value || saving.value || !product.value) return
  saving.value = true
  try {
    await apiCreateBarMovement({
      type: props.type,
      productId: product.value._id,
      qty: qty.value,
      photo: photo.value || undefined,
      note: note.value.trim() || undefined,
      exitKind: props.type === 'salida' ? exitKind.value : undefined,
      authorizedById: props.type === 'salida' ? authorizedById.value : undefined,
      key,
    })
    key = crypto.randomUUID()
    play('success')
    toast.success(`${props.type === 'rotura' ? 'Rotura' : 'Salida'} registrada: ${qty.value} ${plural(product.value.containerLabel || 'unidad', qty.value)} de ${product.value.name}`)
    emit('saved')
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal
    :title="type === 'rotura' ? 'Registrar rotura' : 'Registrar salida'"
    :subtitle="type === 'rotura' ? 'Descuenta el stock y no aparece como diferencia al cierre.' : 'Salidas que no son ventas: se ven aparte en Gerencia.'"
    @close="emit('close')"
  >
    <form id="bar-movement" class="mv" novalidate @submit.prevent="save">
      <fieldset v-if="type === 'salida'" class="mv-seg">
        <legend>Tipo</legend>
        <div class="seg" role="radiogroup" aria-label="Tipo de salida">
          <button
            v-for="e in EXITS"
            :key="e.value"
            type="button"
            role="radio"
            :aria-checked="exitKind === e.value"
            :class="{ on: exitKind === e.value }"
            @click="exitKind = e.value"
          >
            {{ e.label }}
          </button>
        </div>
      </fieldset>

      <div class="field">
        <label>Producto</label>
        <BaseSelect v-model="productId" :options="options" searchable placeholder="Buscar producto…" />
      </div>

      <div v-if="product" class="field">
        <QtyStepper
          v-model="whole"
          :min="bottle && type === 'rotura' ? 0 : 1"
          :allow-zero="bottle && type === 'rotura'"
          :label="bottle ? `${product.containerLabel || 'Botellas'} enteras` : 'Cantidad'"
        />
      </div>
      <fieldset v-if="product && bottle" class="mv-seg">
        <legend>{{ type === 'rotura' ? 'Y una a medias' : 'Más una abierta' }}</legend>
        <div class="seg" role="radiogroup" aria-label="Fracción">
          <button
            v-for="p in PARTS"
            :key="p.value"
            type="button"
            role="radio"
            :aria-checked="part === p.value"
            :class="{ on: part === p.value }"
            @click="part = p.value"
          >
            {{ p.label }}
          </button>
        </div>
      </fieldset>

      <div v-if="type === 'rotura'" class="field">
        <span class="mv-label">Foto (obligatoria)</span>
        <label class="photo" :class="{ 'photo--done': photo }">
          <input type="file" accept="image/*" capture="environment" class="sr-only" @change="pickPhoto" />
          <img v-if="photo" :src="photo" alt="Foto de la rotura" />
          <span v-else><i class="fa-solid" :class="uploading ? 'fa-spinner fa-spin' : 'fa-camera'" aria-hidden="true" /> {{ uploading ? 'Subiendo…' : 'Tomar foto' }}</span>
        </label>
      </div>

      <div v-if="type === 'salida'" class="field">
        <label>Autorizó</label>
        <BaseSelect v-model="authorizedById" :options="authorizers" placeholder="Directora o Gerencia" />
      </div>

      <div class="field">
        <label for="mv-note">Nota (opcional)</label>
        <input id="mv-note" v-model="note" type="text" maxlength="200" :placeholder="type === 'rotura' ? 'Se cayó en cubierta con oleaje' : 'Para la cena de la tripulación'" />
      </div>
      <p v-if="error && productId" class="hint">{{ error }}</p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="submit" form="bar-movement" class="btn btn-primary" :disabled="Boolean(error) || saving || uploading">
        <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
        {{ type === 'rotura' ? 'Registrar rotura' : 'Registrar salida' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped lang="scss">
.mv {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.mv-seg {
  margin: 0;
  padding: 0;
  border: 0;

  legend,
  .mv-label {
    margin-bottom: 0.35rem;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-600);
  }
}

.mv-label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--ink-600);
}

.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;

  button {
    flex: 1 1 0;
    min-height: 48px;
    padding: 0 0.75rem;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-weight: 600;
    color: var(--navy-800);

    &.on {
      border-color: var(--navy-800);
      background: var(--navy-800);
      color: #fff;
    }
  }
}

.photo {
  display: grid;
  place-items: center;
  min-height: 120px;
  border: 2px dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--cream-100);
  color: var(--navy-800);
  font-weight: 600;
  cursor: pointer;

  &:focus-within {
    box-shadow: var(--focus-ring);
  }

  &--done {
    border-style: solid;
  }

  img {
    max-width: 100%;
    max-height: 220px;
    border-radius: var(--radius-sm);
  }
}

.hint {
  margin: 0;
  font-size: 0.9rem;
  color: var(--ink-600);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
