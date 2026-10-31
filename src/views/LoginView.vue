<script setup lang="ts">
import { shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ROLE_HOME } from '@/router'
import { apiErrorMessage } from '@/services/httpBase'
import BrandSeal from '@/components/ui/BrandSeal.vue'
import PasswordInput from '@/components/ui/PasswordInput.vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const email = shallowRef('')
const password = shallowRef('')
const error = shallowRef('')
/** Tableta de confianza del barco: la sesión dura 30 días y se renueva sola. */
const remember = shallowRef(localStorage.getItem('treasure.remember') === '1')
const expired = route.query.expired === '1'

async function submit() {
  error.value = ''
  try {
    localStorage.setItem('treasure.remember', remember.value ? '1' : '0')
    await userStore.login(email.value, password.value, remember.value)
    const next = route.query.next as string | undefined
    const home = userStore.role ? ROLE_HOME[userStore.role] : '/'
    router.replace(next ?? home)
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}
</script>

<template>
  <main class="login">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-brand">
        <BrandSeal :size="112" class="login-seal" />
        <h1 class="login-title">Sistema del bar a bordo</h1>
        <p class="login-lead">Ingresa con tu correo y contraseña.</p>
      </div>

      <p v-if="expired" class="login-notice">
        <i class="fa-solid fa-clock-rotate-left" aria-hidden="true" />
        <span>
          La sesión caducó. Lo que estaba pendiente sigue guardado en esta tableta y se enviará al
          volver a entrar.
        </span>
      </p>

      <div class="field">
        <label for="email">Correo</label>
        <input id="email" v-model="email" type="email" inputmode="email" autocomplete="username" required />
      </div>

      <div class="field">
        <label for="password">Contraseña</label>
        <PasswordInput id="password" v-model="password" />
      </div>

      <label class="remember">
        <input v-model="remember" type="checkbox" />
        <span class="remember-box" aria-hidden="true"><i class="fa-solid fa-check" /></span>
        <span class="remember-text">
          Mantener sesión en esta tableta
          <small>No vuelve a pedir la clave por 30 días.</small>
        </span>
      </label>

      <Transition name="fade">
        <p v-if="error" class="login-error" role="alert">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> <span>{{ error }}</span>
        </p>
      </Transition>

      <button class="btn btn-primary btn-lg login-submit" type="submit" :disabled="userStore.loading">
        <i class="fa-solid" :class="userStore.loading ? 'fa-spinner fa-spin' : 'fa-arrow-right-to-bracket'" aria-hidden="true" />
        {{ userStore.loading ? 'Ingresando…' : 'Ingresar' }}
      </button>
    </form>
  </main>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

// Fondo: el patrón de algas de la portada del menú, en su azul empolvado.
.login {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--powder-300) url('/brand/algas.png') center / 520px auto repeat;
  padding: 1rem;
}

.login-card {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 2rem 1.5rem 1.75rem;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  animation: card-in 0.45s var(--ease-out) both;

  @include tablet {
    padding: 2.4rem 2.25rem 2.1rem;
  }
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

.login-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
  text-align: center;
}

.login-seal {
  margin-bottom: 0.6rem;
}

.login-title {
  font-size: 1.6rem;
  color: var(--navy-900);
}

.login-lead {
  margin: 0;
  font-size: 1rem;
  color: var(--ink-600);
}

.login-notice {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  margin: 0;
  padding: 0.8rem 0.95rem;
  border-radius: var(--radius-sm);
  background: var(--pill-info-bg);
  color: var(--pill-info-ink);
  font-size: 0.98rem;
  line-height: 1.45;
}

.remember {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 52px;
  cursor: pointer;
  user-select: none;

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
}

.remember-text {
  display: flex;
  flex-direction: column;
  font-size: 1rem;
  font-weight: 600;
  color: var(--ink-900);

  small {
    font-size: 0.9rem;
    font-weight: 400;
    color: var(--ink-600);
  }
}

.remember-box {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 2px solid var(--navy-600);
  color: transparent;
  font-size: 0.85rem;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s var(--ease-out);
}

.remember input:checked + .remember-box {
  background: var(--navy-800);
  border-color: var(--navy-800);
  color: #fff;
  transform: scale(1.04);
}

.remember input:focus-visible + .remember-box {
  outline: 3px solid var(--teal-400);
  outline-offset: 2px;
}

.login-error {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  padding: 0.75rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--pill-danger-bg);
  color: var(--pill-danger-ink);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}

.login-submit {
  width: 100%;
}

.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
