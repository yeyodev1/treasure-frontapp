<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { useToastStore } from '@/stores/toast'
import { apiCreateUser, apiUpdateUser, apiUsers } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import { formatDate } from '@/utils/format'
import { useConfirmStore } from '@/stores/confirm'
import { useSound } from '@/composables/useSound'
import type { TeamUser, UserRole } from '@/types'

const toast = useToastStore()
const confirmStore = useConfirmStore()
const { play } = useSound()

const users = ref<TeamUser[]>([])
const showForm = shallowRef(false)
const editing = shallowRef<TeamUser | null>(null)
const saving = shallowRef(false)
const loading = shallowRef(true)

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administración',
  direccion: 'Dirección de crucero',
  bartender: 'Bartender',
  bodega: 'Bodega',
  capitan: 'Capitán (Registros ISM)',
  tripulante: 'Tripulación (Registros ISM)',
  designada: 'Persona Designada (Registros ISM)',
}

const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))

/** Cargos del barco: con ellos se nombran los registros por cargo (R-07, R-22, R-23). */
const POSITION_LABELS: Record<string, string> = {
  CAP: 'Capitán',
  TIM_01: 'Timonel 1',
  TIM_02: 'Timonel 2',
  MAQ: 'Jefe de Máquinas',
  AuxMAQ: 'Auxiliar de Máquinas',
  COC: 'Cocina',
  AuxCOC: 'Auxiliar de Cocina',
  BAR: 'Bar',
  CABIN: 'Cabinas',
  DIR: 'Director de Crucero',
}
const positionOptions = [
  { value: '', label: 'Sin cargo' },
  ...Object.entries(POSITION_LABELS).map(([value, label]) => ({ value, label })),
]
const SHIP_ROLES = ['capitan', 'tripulante']

const form = ref<{ name: string; email: string; password: string; role: string; isCashier: boolean; position: string }>({
  name: '',
  email: '',
  password: '',
  role: 'bartender',
  isCashier: false,
  position: '',
})

async function refresh() {
  try {
    users.value = await apiUsers()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

function openNew() {
  editing.value = null
  form.value = { name: '', email: '', password: '', role: 'bartender', isCashier: false, position: '' }
  showForm.value = true
}

function openEdit(user: TeamUser) {
  editing.value = user
  form.value = {
    name: user.name,
    email: user.email,
    password: '',
    role: user.role,
    isCashier: user.isCashier,
    position: user.position ?? '',
  }
  showForm.value = true
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await apiUpdateUser(editing.value._id, {
        name: form.value.name,
        role: form.value.role,
        isCashier: form.value.role === 'direccion' && form.value.isCashier,
        position: SHIP_ROLES.includes(form.value.role) ? form.value.position : '',
        ...(form.value.password ? { password: form.value.password } : {}),
      })
      toast.success('Persona actualizada')
    } else {
      await apiCreateUser({
        name: form.value.name,
        email: form.value.email,
        password: form.value.password,
        role: form.value.role as UserRole,
        isCashier: form.value.role === 'direccion' && form.value.isCashier,
        position: SHIP_ROLES.includes(form.value.role) ? form.value.position : '',
      })
      toast.success('Acceso creado')
    }
    play('success')
    showForm.value = false
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  } finally {
    saving.value = false
  }
}

async function toggleActive(user: TeamUser) {
  const deactivating = user.active
  const ok = await confirmStore.ask({
    title: deactivating ? '¿Desactivar acceso?' : '¿Activar acceso?',
    message: deactivating
      ? `${user.name} ya no podrá iniciar sesión en el sistema.`
      : `${user.name} podrá volver a iniciar sesión en el sistema.`,
    confirmLabel: deactivating ? 'Desactivar' : 'Activar',
    icon: deactivating ? 'fa-user-slash' : 'fa-user-check',
    danger: deactivating,
  })
  if (!ok) return

  try {
    await apiUpdateUser(user._id, { active: !user.active })
    play('success')
    toast.success(deactivating ? 'Acceso desactivado' : 'Acceso activado')
    await refresh()
  } catch (err) {
    play('error')
    toast.error(apiErrorMessage(err))
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">Equipo</h1>
      <button type="button" class="btn btn-gold" @click="openNew">
        <i class="fa-solid fa-user-plus" aria-hidden="true" /> Nuevo acceso
      </button>
    </header>

    <p class="note">
      Cada persona tiene su propio acceso: así se sabe quién registró cada pedido, merma o cobro.
    </p>

    <SkeletonList v-if="loading" variant="card" :rows="4" />
    <div v-else class="users">
      <article v-for="user in users" :key="user._id" class="card user" :class="{ off: !user.active }">
        <div class="user-info">
          <strong>{{ user.name }}</strong>
          <span class="user-email">{{ user.email }}</span>
          <span class="user-role">
            {{ ROLE_LABELS[user.role] }}
            <template v-if="user.position"> · {{ POSITION_LABELS[user.position] ?? user.position }}</template>
            <em v-if="user.isCashier" class="cashier"><i class="fa-solid fa-cash-register" aria-hidden="true" /> Cajera</em>
          </span>
          <span class="user-audit">
            Alta {{ formatDate(user.createdAt) }}<template v-if="user.createdBy"> por {{ user.createdBy.name }}</template>
            <template v-if="user.updatedBy"> · editó {{ user.updatedBy.name }}</template>
          </span>
        </div>
        <div class="user-actions">
          <button type="button" class="edit-btn" @click="openEdit(user)">
            <i class="fa-solid fa-pen" aria-hidden="true" /> Editar
          </button>
          <button type="button" class="pill-btn" :class="{ on: user.active }" @click="toggleActive(user)">
            {{ user.active ? 'Activo' : 'Inactivo' }}
          </button>
        </div>
      </article>
    </div>

    <BaseModal v-if="showForm" :title="editing ? 'Editar persona' : 'Nuevo acceso'" @close="showForm = false">
      <div class="modal-form">
        <div class="field">
          <label for="u-name">Nombre</label>
          <input id="u-name" v-model="form.name" type="text" />
        </div>
        <div v-if="!editing" class="field">
          <label for="u-email">Correo</label>
          <input id="u-email" v-model="form.email" type="email" />
        </div>
        <div class="field">
          <label for="u-pass">{{ editing ? 'Nueva contraseña (opcional)' : 'Contraseña' }}</label>
          <PasswordInput id="u-pass" v-model="form.password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label id="u-role-label">Rol</label>
          <BaseSelect v-model="form.role" :options="roleOptions" aria-labelledby="u-role-label" />
        </div>
        <div v-if="SHIP_ROLES.includes(form.role)" class="field">
          <label id="u-pos-label">Cargo a bordo</label>
          <BaseSelect v-model="form.position" :options="positionOptions" aria-labelledby="u-pos-label" />
        </div>
        <p v-if="['capitan', 'tripulante', 'designada'].includes(form.role)" class="ship-note">
          <i class="fa-solid fa-clipboard-check" aria-hidden="true" />
          Entra en registros.teseturis.app para llenar y firmar los registros ISM.
        </p>
        <label v-if="form.role === 'direccion'" class="cashier-check">
          <input v-model="form.isCashier" type="checkbox" />
          Designar como cajera: puede cobrar cuentas aprobadas
        </label>
        <button type="button" class="btn btn-gold" :disabled="saving" @click="save">
          <i class="fa-solid fa-floppy-disk" aria-hidden="true" /> {{ saving ? 'Guardando…' : 'Guardar' }}
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
  margin-bottom: 0.5rem;

  .page-title {
    margin-bottom: 0;
  }
}

.note {
  margin: 0 0 1rem;
  color: var(--ink-400);
  font-size: 0.88rem;
}

.users {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 0.75rem;
}

.user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;

  &.off {
    opacity: 0.55;
  }
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.user-email {
  font-size: 0.8rem;
  color: var(--ink-400);
  overflow: hidden;
  text-overflow: ellipsis;
}

.cashier {
  font-style: normal;
  margin-left: 0.35rem;
  color: var(--gold-500);
}

.user-audit {
  font-size: 0.72rem;
  color: var(--ink-400);
}

.cashier-check {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.6rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);

  input {
    width: 1.15rem;
    height: 1.15rem;
    accent-color: var(--navy-800);
  }
}

.user-role {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--navy-600);
}

.user-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-shrink: 0;
}

.edit-btn {
  font-weight: 700;
  color: var(--navy-600);
}

.pill-btn {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  background: var(--cream-200);
  color: var(--ink-400);

  &.on {
    background: rgba(63, 174, 106, 0.15);
    color: var(--success);
  }
}

.ship-note {
  margin: 0;
  font-size: 0.84rem;
  color: var(--ink-600);
  background: var(--powder-100);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
</style>
