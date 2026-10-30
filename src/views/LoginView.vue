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
        <BrandSeal :size="120" class="login-seal" />
        <p>Sistema del bar a bordo</p>
      </div>

      <p v-if="expired" class="login-notice">
        <i class="fa-solid fa-clock-rotate-left" aria-hidden="true" />
        Tu sesión caducó. Lo que estaba pendiente sigue guardado en esta tableta y se enviará al
        volver a entrar.
      </p>

      <div class="field">
        <label for="email">Correo</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required />
      </div>

      <div class="field">
        <label for="password">Contraseña</label>
        <PasswordInput id="password" v-model="password" />
      </div>

      <label class="remember">
        <input v-model="remember" type="checkbox" />
        <span class="remember-box" aria-hidden="true"><i class="fa-solid fa-check" /></span>
        Mantener sesión en esta tableta
      </label>

      <p v-if="error" class="login-error">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true" /> {{ error }}
      </p>

      <button class="btn btn-primary login-submit" type="submit" :disabled="userStore.loading">
        <i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true" />
        {{ userStore.loading ? 'Ingresando…' : 'Ingresar' }}
      </button>
    </form>
  </main>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.login-notice {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  background: rgba(200, 215, 231, 0.45);
  color: var(--navy-600);
  font-size: 0.85rem;
  line-height: 1.4;
}

.remember {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 48px;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
}

.remember-box {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 2px solid var(--navy-600);
  color: transparent;
  font-size: 0.8rem;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.remember input:checked + .remember-box {
  background: var(--navy-600);
  color: #fff;
  transform: scale(1.04);
}

.remember input:focus-visible + .remember-box {
  outline: 3px solid var(--powder-300);
  outline-offset: 2px;
}

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
  max-width: 400px;
  background: #fff;
  border-radius: var(--radius);
  box-shadow: 0 18px 50px rgba(27, 43, 37, 0.25);
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-top: 5px solid var(--navy-800);

  @include tablet {
    padding: 2.4rem 2rem;
  }
}

.login-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 0.4rem;

  p {
    margin: 0.75rem 0 0;
    font-family: var(--font-serif);
    font-size: 1.05rem;
    letter-spacing: 0.04em;
    color: var(--ink-600);
  }
}

.login-error {
  margin: 0;
  color: var(--danger);
  font-size: 0.9rem;
  font-weight: 600;
  text-align: center;
}

.login-submit {
  width: 100%;
}
</style>
