<script setup lang="ts">
import { shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ROLE_HOME } from '@/router'
import { apiErrorMessage } from '@/services/httpBase'
import BrandSeal from '@/components/ui/BrandSeal.vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const email = shallowRef('')
const password = shallowRef('')
const error = shallowRef('')

async function submit() {
  error.value = ''
  try {
    await userStore.login(email.value, password.value)
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
        <BrandSeal :size="92" class="login-seal" />
        <h1>Treasure of Galápagos</h1>
        <p>Sistema del bar a bordo</p>
      </div>

      <div class="field">
        <label for="email">Correo</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required />
      </div>

      <div class="field">
        <label for="password">Contraseña</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>

      <p v-if="error" class="login-error">{{ error }}</p>

      <button class="btn btn-gold login-submit" type="submit" :disabled="userStore.loading">
        {{ userStore.loading ? 'Ingresando…' : 'Ingresar' }}
      </button>
    </form>
  </main>
</template>

<style scoped lang="scss">
@use '@/styles/mixins' as *;

.login {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(185, 204, 224, 0.16), transparent 50%),
    radial-gradient(ellipse at 90% 100%, rgba(195, 161, 105, 0.18), transparent 50%),
    var(--navy-900);
  padding: 1rem;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;

  @include tablet {
    padding: 2.5rem 2rem;
  }
}

.login-brand {
  text-align: center;
  margin-bottom: 0.5rem;

  h1 {
    font-size: 1.5rem;
  }

  p {
    margin: 0.25rem 0 0;
    color: var(--ink-400);
    font-size: 0.9rem;
  }
}

.login-seal {
  margin: 0 auto 0.75rem;
  color: var(--navy-800);
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
