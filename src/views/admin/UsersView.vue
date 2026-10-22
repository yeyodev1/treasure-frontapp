<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { useToastStore } from '@/stores/toast'
import { apiCreateUser, apiUpdateUser, apiUsers } from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SkeletonList from '@/components/ui/SkeletonList.vue'
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
}

const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))

const form = ref<{ name: string; email: string; password: string; role: string }>({
  name: '',
  email: '',
  password: '',
  role: 'bartender',
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
  form.value = { name: '', email: '', password: '', role: 'bartender' }
  showForm.value = true
}

function openEdit(user: TeamUser) {
  editing.value = user
  form.value = { name: user.name, email: user.email, password: '', role: user.role }
  showForm.value = true
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await apiUpdateUser(editing.value._id, {
        name: form.value.name,
        role: form.value.role,
        ...(form.value.password ? { password: form.value.password } : {}),
      })
      toast.success('Persona actualizada')
    } else {
      await apiCreateUser(form.value as { name: string; email: string; password: string; role: UserRole })
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
          <span class="user-role">{{ ROLE_LABELS[user.role] }}</span>
        </div>
        <div class="user-actions">
          <button type="button" class="edit-btn" @click="openEdit(user)">Editar</button>
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
          <input id="u-pass" v-model="form.password" type="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label id="u-role-label">Rol</label>
          <BaseSelect v-model="form.role" :options="roleOptions" aria-labelledby="u-role-label" />
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

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
</style>
