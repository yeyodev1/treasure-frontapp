<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
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
  duena: 'Gerencia (toda la operación y finanzas)',
  admin: 'Administración (conteos, compras y recepciones)',
  direccion: 'Dirección de crucero (pasajeros, cuentas y cobros)',
  bartender: 'Bartender',
  bodega: 'Bodega',
  capitan: 'Capitán (Registros ISM)',
  tripulante: 'Tripulación (Registros ISM)',
  designada: 'Persona Designada (Registros ISM)',
}

/** Capitán, tripulación y Designada se manejan en Registros ISM › Tripulantes (pedido del cliente, 12-nov-2026). */
const ISM_ROLES: UserRole[] = ['capitan', 'tripulante', 'designada']
const barUsers = computed(() => users.value.filter((u) => !ISM_ROLES.includes(u.role)))
const roleOptions = Object.entries(ROLE_LABELS)
  .filter(([value]) => !ISM_ROLES.includes(value as UserRole))
  .map(([value, label]) => ({ value, label }))

/** Para la tarjeta: el nombre del rol y, aparte, lo que abarca. */
function roleName(role: UserRole): string {
  return (ROLE_LABELS[role] ?? role).split(' (')[0]!
}

function roleScope(role: UserRole): string {
  const m = /\(([^)]+)\)/.exec(ROLE_LABELS[role] ?? '')
  return m ? m[1]! : ''
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

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
  DIR: 'Dirección de crucero',
}
const positionOptions = [
  { value: '', label: 'Sin cargo' },
  ...Object.entries(POSITION_LABELS).map(([value, label]) => ({ value, label })),
]
const SHIP_ROLES = ['capitan', 'tripulante']

const form = ref<{ name: string; email: string; password: string; role: string; isCashier: boolean; position: string; pin: string }>({
  pin: '',
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
  form.value = { name: '', email: '', password: '', role: 'bartender', isCashier: false, position: '', pin: '' }
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
    pin: '',
  }
  showForm.value = true
}

async function save() {
  if (form.value.pin && !/^\d{4}$/.test(form.value.pin)) {
    toast.error('La clave son 4 números')
    return
  }
  const pin = form.value.pin ? { pin: form.value.pin } : {}
  saving.value = true
  try {
    if (editing.value) {
      await apiUpdateUser(editing.value._id, {
        name: form.value.name,
        role: form.value.role,
        isCashier: form.value.role === 'direccion' && form.value.isCashier,
        position: SHIP_ROLES.includes(form.value.role) ? form.value.position : '',
        ...(form.value.password ? { password: form.value.password } : {}),
        ...pin,
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
        ...pin,
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
    <header class="page-head">
      <div class="page-head-text">
        <h1 class="page-title">Equipo</h1>
        <p class="page-lead">
          Cada persona tiene su propio acceso: así se sabe quién registró cada consumo, merma o cobro.
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" @click="openNew">
          <i class="fa-solid fa-user-plus" aria-hidden="true" /> Nuevo acceso
        </button>
      </div>
    </header>

    <SkeletonList v-if="loading" variant="card" :rows="4" />
    <div v-else-if="!barUsers.length" class="vacio">
      <i class="fa-solid fa-users" aria-hidden="true" />
      <p>Aún no hay accesos. Crea el primero con «Nuevo acceso».</p>
    </div>
    <TransitionGroup v-else name="list" tag="div" class="users">
      <article v-for="user in barUsers" :key="user._id" class="user" :class="{ off: !user.active }">
        <span class="user-avatar" aria-hidden="true">{{ initials(user.name) }}</span>
        <div class="user-info">
          <strong class="user-name">{{ user.name }}</strong>
          <span class="user-email">{{ user.email }}</span>
          <span class="user-role">
            <span class="estado estado--info">{{ roleName(user.role) }}</span>
            <span v-if="user.hasPin" class="estado"><i class="fa-solid fa-key" aria-hidden="true" /> Con clave</span>
            <span v-if="user.position" class="estado">{{ POSITION_LABELS[user.position] ?? user.position }}</span>
          </span>
          <span v-if="roleScope(user.role)" class="user-scope">{{ roleScope(user.role) }}</span>
          <span class="user-audit">
            Alta {{ formatDate(user.createdAt) }}<template v-if="user.createdBy"> por {{ user.createdBy.name }}</template>
            <template v-if="user.updatedBy"> · editó {{ user.updatedBy.name }}</template>
          </span>
        </div>
        <div class="user-actions">
          <button
            type="button"
            class="state"
            :class="{ on: user.active }"
            :aria-pressed="user.active"
            :aria-label="`${user.name}: ${user.active ? 'acceso activo, tocar para desactivar' : 'acceso inactivo, tocar para activar'}`"
            @click="toggleActive(user)"
          >
            <span class="state-dot" aria-hidden="true" />
            {{ user.active ? 'Activo' : 'Inactivo' }}
          </button>
          <button type="button" class="btn btn-secondary edit-btn" @click="openEdit(user)">
            <i class="fa-solid fa-pen" aria-hidden="true" /> Editar
          </button>
        </div>
      </article>
    </TransitionGroup>

    <BaseModal
      v-if="showForm"
      :title="editing ? 'Editar acceso' : 'Nuevo acceso'"
      :subtitle="editing ? editing.email : 'Nombre, correo, contraseña y lo que puede hacer en el sistema.'"
      @close="showForm = false"
    >
      <div class="modal-form">
        <div class="field">
          <label for="u-name">Nombre</label>
          <input id="u-name" v-model="form.name" type="text" autocomplete="off" />
        </div>
        <div v-if="!editing" class="field">
          <label for="u-email">Correo</label>
          <input id="u-email" v-model="form.email" type="email" inputmode="email" autocomplete="off" />
        </div>
        <div class="field">
          <label for="u-pass">{{ editing ? 'Nueva contraseña (opcional)' : 'Contraseña' }}</label>
          <PasswordInput id="u-pass" v-model="form.password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label for="u-pin">Clave de 4 números para entrar <small>(opcional)</small></label>
          <input id="u-pin" v-model="form.pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Ej. 2580" />
          <small class="hint">{{ editing?.hasPin ? 'Ya tiene clave: escribe una nueva solo si quieres cambiarla.' : 'Con ella entra eligiendo su departamento. Que no sean números seguidos ni repetidos.' }}</small>
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
          <span>Entra en registros.teseturis.app para llenar y firmar los registros ISM.</span>
        </p>
      </div>

      <template #footer>
        <button type="button" class="btn btn-secondary" @click="showForm = false">Cancelar</button>
        <button type="button" class="btn btn-primary btn-lg" :disabled="saving" @click="save">
          <i class="fa-solid" :class="saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'" aria-hidden="true" />
          {{ saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear acceso' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.users {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;

  @include tablet {
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  }
}

.user {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  gap: 0.4rem 0.85rem;
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  transition:
    opacity 0.2s ease,
    border-color 0.16s ease;

  &.off {
    background: var(--cream-100);

    .user-avatar {
      background: var(--pill-neutral-bg);
      color: var(--ink-400);
    }

    .user-name,
    .user-role {
      opacity: 0.7;
    }
  }
}

.user-avatar {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--powder-200);
  color: var(--navy-800);
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.user-name {
  font-size: 1.05rem;
  color: var(--ink-900);
}

.user-email {
  font-size: 0.95rem;
  color: var(--ink-600);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-role {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.3rem;
}

.user-scope {
  font-size: 0.92rem;
  color: var(--ink-600);

  &::first-letter {
    text-transform: uppercase;
  }
}

.user-audit {
  margin-top: 0.15rem;
  font-size: 0.88rem;
  color: var(--ink-400);
}

.user-actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-top: 0.6rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--rule);
}

.edit-btn {
  min-height: 48px;
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 48px;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ink-600);
  white-space: nowrap;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    transform 0.14s var(--ease-out);

  &.on {
    border-color: transparent;
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }

  &:hover {
    border-color: var(--navy-600);
  }

  &:active {
    transform: scale(0.97);
  }
}

.state-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ink-300);
  transition: background-color 0.16s ease;

  .on & {
    background: var(--success);
  }
}

.ship-note {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  margin: 0;
  padding: 0.7rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--powder-100);
  font-size: 0.98rem;
  line-height: 1.45;
  color: var(--ink-900);

  i {
    color: var(--navy-600);
  }
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.hint {
  font-size: 0.95rem;
  color: var(--ink-600);
}
</style>
