<script setup lang="ts">
import CruiseTag from '@/components/cruises/CruiseTag.vue'
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import GoalsModal from '@/components/summary/GoalsModal.vue'
import BarMovementsList from '@/components/barstock/BarMovementsList.vue'
import {
  apiBarControlClosed,
  apiBarControlCurrent,
  apiBarControlPeriod,
  apiBarStockSettings,
  apiControlDecision,
  apiDecideClosingCount,
  apiDecideDifference,
  apiDecideOutlier,
  apiSaveBarStockSettings,
  apiStartAuthorization,
  type BarControlClosed,
  type BarControlCurrent,
  type BarControlPeriod,
  type BarDecision,
  type BarStockSettings,
} from '@/services/api'
import { apiErrorMessage } from '@/services/httpBase'
import { useToastStore } from '@/stores/toast'
import { useConfirmStore } from '@/stores/confirm'
import { formatMoney, todayKey } from '@/utils/format'
import { fmt, monthTitle } from '@/components/owner/insights'

/**
 * Control del bar (Bar-stock › Control del bar, solo Gerencia; especificación
 * del 26-nov-2026). Siempre abre en Crucero en curso. «Por decidir» es la
 * única lista y solo trae lo que necesita autoridad de Gerencia, ordenado por
 * dinero en juego; lo informativo va como etiqueta dentro de su bloque y se
 * quita solo. Cruceros cerrados, Mes y Año no repiten Por decidir ni el ciclo.
 */
const router = useRouter()
const toast = useToastStore()
const confirm = useConfirmStore()

type Tab = 'curso' | 'cerrados' | 'mes' | 'ano'
const tab = shallowRef<Tab>('curso')
const loading = shallowRef(true)
const current = shallowRef<BarControlCurrent | null>(null)
const closed = shallowRef<BarControlClosed[]>([])
const period = shallowRef<BarControlPeriod | null>(null)
const month = shallowRef(todayKey().slice(0, 7))
const year = shallowRef(todayKey().slice(0, 4))
const openCruise = shallowRef('')

async function load() {
  loading.value = true
  try {
    if (tab.value === 'curso') current.value = await apiBarControlCurrent()
    else if (tab.value === 'cerrados') closed.value = await apiBarControlClosed()
    else period.value = await apiBarControlPeriod(tab.value, tab.value === 'mes' ? month.value : year.value)
  } catch (err) {
    toast.error(apiErrorMessage(err))
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([tab, month, year], load)

function shiftMonth(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  month.value = new Date(Date.UTC(y!, m! - 1 + delta, 1)).toISOString().slice(0, 7)
}

const money = (v: number) => formatMoney(v)
const day = (k: string) => fmt(k, { weekday: 'short', day: 'numeric', month: 'short' })
const pct = (v: number | null) => (v === null ? '' : `${v >= 0 ? '+' : ''}${v} %`)

/* ── Por decidir: cada tipo con sus botones ── */
async function act(d: BarDecision, action: string) {
  try {
    if (d.type === 'merma') {
      if (action === 'Aprobar') await apiDecideClosingCount(d.ref, true, '')
      else {
        const comment = await confirm.askReason({
          title: '¿Rechazar la merma?',
          message: 'Vuelve a la directora con tu comentario.',
          confirmLabel: 'Rechazar',
          danger: true,
          icon: 'fa-rotate-left',
          reason: { label: 'Comentario (obligatorio)', suggestions: ['Recontar con el bartender', 'Revisar las roturas registradas'] },
        })
        if (!comment) return
        await apiDecideClosingCount(d.ref, false, comment)
      }
    } else if (d.type === 'inicio') {
      await apiStartAuthorization(d.ref, action === 'Autorizar' ? 'autorizar' : 'negar', action === 'Autorizar' ? 'Autorizado desde Control del bar' : '')
    } else if (d.type === 'pedido') {
      if (action === 'Ajustar') {
        void router.push({ path: '/bar-stock', query: { vista: 'pedidos' } })
        return
      }
      await apiDecideOutlier(d.ref)
    } else if (d.type === 'recepcion') {
      if (action === 'Aceptar') await apiDecideDifference(d.ref, d.key!, 'aceptada')
      else {
        const note = await confirm.askReason({
          title: 'Pedir explicación',
          message: 'Le llega al responsable de compras: quien compra y quien recibe se controlan entre sí.',
          confirmLabel: 'Pedir explicación',
          icon: 'fa-comment',
          reason: { label: '¿Qué tiene que explicar?', suggestions: ['¿Por qué llegó menos de lo comprado?'] },
        })
        if (!note) return
        await apiDecideDifference(d.ref, d.key!, 'explicacion', note)
      }
    } else if (d.type === 'control') {
      await apiControlDecision(d.ref, action === 'Registrar merma' ? 'merma' : 'recuento')
    }
    toast.success('Listo: queda en el historial con tu nombre')
    await load()
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}

/* ── Configuración: metas con vigencia y responsable de compras ── */
const goalsOpen = shallowRef(false)
const settingsOpen = shallowRef(false)
const settings = shallowRef<BarStockSettings | null>(null)
const buyerId = shallowRef('')
const buyerUntil = shallowRef('')
async function openSettings() {
  try {
    settings.value = await apiBarStockSettings()
    buyerId.value = settings.value.purchaseResponsible?.isDefault ? '' : (settings.value.purchaseResponsible?.id ?? '')
    buyerUntil.value = settings.value.purchaseResponsible?.until?.slice(0, 10) ?? ''
    settingsOpen.value = true
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}
async function saveBuyer() {
  try {
    await apiSaveBarStockSettings(buyerId.value || null, buyerUntil.value || null)
    toast.success('Responsable de compras guardado: la siguiente notificación le llega a esa persona')
    settingsOpen.value = false
  } catch (err) {
    toast.error(apiErrorMessage(err))
  }
}
const buyerOptions = computed(() => [
  { value: '', label: 'Administración (por defecto)' },
  ...(settings.value?.candidates ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${c.role === 'admin' ? 'Administración' : c.role === 'bartender' ? 'bartender' : 'directora'}` })),
])

const TAB_LABEL: Record<Tab, string> = { curso: 'Crucero en curso', cerrados: 'Cruceros cerrados', mes: 'Mes', ano: 'Año' }
const endDay = computed(() => (current.value?.cruise ? fmt(current.value.cruise.end, { weekday: 'long' }) : 'cierre'))
const progress = computed(() => (current.value?.cruise ? (current.value.cruise.dayX / current.value.cruise.totalDays) * 100 : 0))
const MOTIVE: Record<string, string> = { rotura: 'Rotura no reg.', cortesia: 'Cortesía no reg.', consumo: 'Consumo no reg.', faltante: 'Faltante' }
const barMax = (rows: Array<{ value: number }>) => Math.max(1, ...rows.map((r) => r.value))
</script>

<template>
  <section class="control">
    <h2 class="control-title">Control del bar · {{ TAB_LABEL[tab] }}</h2>
    <header class="control-head">
      <nav class="segs" aria-label="Control del bar">
        <button v-for="t in (['curso', 'cerrados', 'mes', 'ano'] as const)" :key="t" type="button" class="segs-item" :class="{ 'segs-item--on': tab === t }" :aria-current="tab === t ? 'page' : undefined" @click="tab = t">
          {{ TAB_LABEL[t] }}
        </button>
      </nav>
      <button type="button" class="btn btn-secondary" @click="openSettings"><i class="fa-solid fa-gear" aria-hidden="true" /> Configuración</button>
    </header>

    <SkeletonBlock v-if="loading" height="420px" />

    <!-- Crucero en curso -->
    <template v-else-if="tab === 'curso' && current">
      <p v-if="!current.cruise" class="card muted">Todavía no hay cruceros.</p>
      <template v-else>
        <section class="card cruise">
          <div class="cruise-top">
            <h2><CruiseTag :code="current.cruise.code" /> · {{ current.navigating ? `Día ${current.cruise.dayX} de ${current.cruise.totalDays}` : 'último cerrado' }}</h2>
            <span class="tone" :class="current.navigating ? 'tone--verde' : 'tone--gris'">{{ current.navigating ? 'En curso' : 'Cerrado' }}</span>
            <span v-if="current.decisions.length" class="tone tone--rojo">{{ current.decisions.length }} por decidir</span>
            <span class="muted cruise-meta">
              {{ day(current.cruise.start) }} → {{ day(current.cruise.end) }} · {{ current.cruise.passengers }} pasajeros · bartender {{ current.cruise.bartender || '—' }} · directora {{ current.cruise.directora || '—' }}
            </span>
          </div>
          <div v-if="current.navigating" class="bar" aria-hidden="true"><span :style="{ width: `${progress}%` }" /></div>
          <p v-else-if="current.next" class="muted">No hay crucero navegando. Siguiente programado: {{ current.next.code }} el {{ day(current.next.start) }}.</p>
          <p v-else class="muted">No hay crucero navegando ni programado.</p>
        </section>

        <dl v-if="current.figures" class="kpis">
          <div>
            <dt>Ventas del bar</dt>
            <dd>{{ money(current.figures.sold) }}</dd>
            <small v-if="current.figures.soldPct !== null" class="tone" :class="current.figures.soldPct >= 0 ? 'tone--verde' : 'tone--amarillo'">
              {{ pct(current.figures.soldPct) }} vs. promedio al día {{ current.cruise.dayX }}
            </small>
            <small v-else class="muted">sin cruceros anteriores</small>
          </div>
          <div>
            <dt>Por pasajero y día</dt>
            <dd>{{ current.figures.perPaxDay === null ? '—' : money(current.figures.perPaxDay) }}</dd>
            <small v-if="current.figures.avgPerPaxDay !== null" class="tone" :class="(current.figures.perPaxDay ?? 0) >= current.figures.avgPerPaxDay ? 'tone--verde' : 'tone--amarillo'">promedio {{ money(current.figures.avgPerPaxDay) }}</small>
          </div>
          <div>
            <dt>Cortesías, roturas, salidas</dt>
            <dd>{{ money(current.figures.exits) }}</dd>
            <small v-if="current.figures.exitsPct !== null" class="tone tone--amarillo">{{ current.figures.exitsPct }} % de las ventas</small>
          </div>
          <div>
            <dt>Stock bajo cero</dt>
            <dd>{{ current.figures.belowZero }}</dd>
            <small class="tone" :class="current.figures.belowZero ? 'tone--rojo' : 'tone--verde'" :title="current.figures.belowZeroNames.join(', ')">
              {{ current.figures.belowZero ? 'falta registrar una recepción o un conteo' : 'todo cuadra' }}
            </small>
          </div>
        </dl>

        <!-- Por decidir: la única lista -->
        <section class="card">
          <h3>Por decidir · {{ current.decisions.length }}</h3>
          <p v-if="!current.decisions.length" class="muted">Nada por decidir.</p>
          <div v-else class="table">
            <table>
              <thead>
                <tr><th scope="col">Qué</th><th scope="col">Detalle</th><th scope="col" class="num">En juego</th><th scope="col">Hace</th><th scope="col"><span class="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                <tr v-for="d in current.decisions" :key="`${d.type}-${d.ref}-${d.key ?? ''}`">
                  <td><span class="tone" :class="d.type === 'merma' || d.type === 'recepcion' ? 'tone--rojo' : 'tone--amarillo'">{{ d.label }}</span></td>
                  <td>{{ d.detail }}</td>
                  <td class="num">{{ d.amount ? money(d.amount) : '—' }}</td>
                  <td>{{ d.days === 0 ? 'hoy' : `${d.days} día${d.days === 1 ? '' : 's'}` }}</td>
                  <td class="actions">
                    <button v-for="a in d.actions" :key="a" type="button" class="btn-text" @click="act(d, a)">{{ a }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Puede faltar antes del cierre -->
        <section v-if="current.navigating" class="card">
          <h3>Puede faltar antes del cierre</h3>
          <p v-if="!current.short?.length" class="muted">Todo alcanza hasta el final del crucero.</p>
          <div v-else class="table">
            <table>
              <thead>
                <tr><th scope="col">Producto</th><th scope="col" class="num">Hay ahora</th><th scope="col" class="num">Se consume hasta el {{ endDay }}</th><th scope="col">Próxima recepción</th><th scope="col"><span class="sr-only">Estado</span></th></tr>
              </thead>
              <tbody>
                <tr v-for="r in current.short" :key="r.product">
                  <td>{{ r.product }}</td>
                  <td class="num">{{ r.now }}</td>
                  <td class="num">≈ {{ Math.ceil(r.need) }}</td>
                  <td>{{ r.incoming }}</td>
                  <td><span class="tone" :class="`tone--${r.tone}`">{{ r.state }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="muted small">Consumo estimado con el promedio por pasajero de los últimos 4 cruceros.</p>
        </section>

        <div class="grid">
          <section v-if="current.payments" class="card">
            <h3>Cobros de este crucero</h3>
            <dl class="lines">
              <div><dt>Tarjeta</dt><dd>{{ money(current.payments.tarjeta) }}</dd></div>
              <div><dt>Efectivo</dt><dd>{{ money(current.payments.efectivo) }}</dd></div>
              <div><dt>Transferencia</dt><dd>{{ money(current.payments.transferencia) }}</dd></div>
              <div class="total"><dt>Total {{ current.cruise.code }}</dt><dd>{{ money(current.payments.total) }}</dd></div>
              <div>
                <dt>Facturas</dt>
                <dd>
                  <span class="tone" :class="current.payments.badEmails ? 'tone--amarillo' : 'tone--verde'">
                    {{ current.payments.badEmails ? `${current.payments.badEmails} sin enviar por correo · ya facturadas` : 'todas enviadas' }}
                  </span>
                </dd>
              </div>
            </dl>
            <p class="muted small">El efectivo se cuenta por crucero: el de este no se mezcla con el del anterior.</p>
          </section>
          <section v-if="current.top" class="card">
            <h3>Más vendido en este crucero</h3>
            <ul class="hbars">
              <li v-for="t in current.top" :key="t.name">
                <span>{{ t.name }}</span>
                <span class="hbar"><span class="hbar-fill" :style="{ width: `${(t.units / Math.max(1, current.top[0]?.units ?? 1)) * 100}%` }" /></span>
                <strong>{{ t.units }} · {{ money(t.amount) }}</strong>
              </li>
            </ul>
            <p v-if="!current.top.length" class="muted">Sin ventas todavía.</p>
          </section>
        </div>

        <section class="card">
          <h3>Ciclo de la semana</h3>
          <ul class="cycle">
            <li v-for="c in current.cycle" :key="c.label"><span>{{ c.label }}</span><span class="tone" :class="`tone--${c.tone}`">{{ c.state }}</span></li>
          </ul>
        </section>

        <section class="card">
          <h3>Cortesías, roturas y salidas de este crucero · {{ money(current.figures?.exits ?? 0) }}</h3>
          <BarMovementsList :cruise-id="current.cruise.id" />
        </section>
      </template>
    </template>

    <!-- Cruceros cerrados -->
    <template v-else-if="tab === 'cerrados'">
      <p v-if="!closed.length" class="card muted">Todavía no hay cruceros cerrados.</p>
      <article v-for="c in closed" :key="c.id" class="card">
        <button type="button" class="closed-head" :aria-expanded="openCruise === c.id" @click="openCruise = openCruise === c.id ? '' : c.id">
          <strong><CruiseTag :code="c.code" /></strong>
          <span class="muted">{{ day(c.start) }} → {{ day(c.end) }} · {{ c.bartender || '—' }}</span>
          <span v-if="!c.count" class="tone tone--rojo">sin conteo de cierre</span>
          <span v-else class="tone" :class="c.count.status === 'aprobado' ? 'tone--verde' : 'tone--amarillo'">
            {{ c.count.status === 'aprobado' ? 'verificado' : c.count.status === 'gerencia' ? 'en Gerencia' : 'por verificar' }} · merma {{ money(c.count.wasteTotal) }}
          </span>
        </button>
        <div v-if="openCruise === c.id" class="closed-body">
          <template v-if="c.count">
            <p class="muted">Conteo {{ c.count.code }} · contó {{ c.count.bartender || '—' }} · verificó {{ c.count.directora || '—' }}</p>
            <ul v-if="c.count.lines.length" class="cycle">
              <li v-for="l in c.count.lines" :key="l.name"><span>{{ l.name }} · −{{ l.units }} · {{ MOTIVE[l.motive] ?? 'sin motivo' }}</span><strong>{{ l.value ? money(l.value) : 'sin costo' }}</strong></li>
            </ul>
            <p v-else class="muted">Sin merma.</p>
          </template>
          <h4>Cortesías, roturas y salidas</h4>
          <BarMovementsList :cruise-id="c.id" />
        </div>
      </article>
    </template>

    <!-- Mes y Año -->
    <template v-else-if="period">
      <div class="stepper">
        <template v-if="tab === 'mes'">
          <button type="button" class="icon-btn" aria-label="Mes anterior" @click="shiftMonth(-1)"><i class="fa-solid fa-chevron-left" aria-hidden="true" /></button>
          <strong>{{ monthTitle(month) }}</strong>
          <button type="button" class="icon-btn" aria-label="Mes siguiente" @click="shiftMonth(1)"><i class="fa-solid fa-chevron-right" aria-hidden="true" /></button>
        </template>
        <template v-else>
          <button type="button" class="icon-btn" aria-label="Año anterior" @click="year = String(Number(year) - 1)"><i class="fa-solid fa-chevron-left" aria-hidden="true" /></button>
          <strong>{{ year }}</strong>
          <button type="button" class="icon-btn" aria-label="Año siguiente" @click="year = String(Number(year) + 1)"><i class="fa-solid fa-chevron-right" aria-hidden="true" /></button>
        </template>
      </div>

      <section class="card">
        <h3>Merma de {{ tab === 'mes' ? monthTitle(month).toLowerCase() : year }} · {{ money(period.waste.total) }}</h3>
        <p v-if="!period.waste.total" class="muted">Sin merma registrada en conteos de cierre.</p>
        <div v-else class="grid">
          <div v-for="g in ([['Por crucero', period.waste.byCruise, 'red'], ['Por producto', period.waste.byProduct, 'red'], ['Por persona', period.waste.byPerson, 'gold'], ['Por motivo', period.waste.byMotive, 'violet']] as const)" :key="g[0]">
            <p class="sub">{{ g[0] }}</p>
            <ul class="hbars">
              <li v-for="r in g[1]" :key="r.label">
                <span>{{ r.label }}</span>
                <span class="hbar"><span class="hbar-fill" :class="`hbar-fill--${g[2]}`" :style="{ width: `${(r.value / barMax(g[1])) * 100}%` }" /></span>
                <strong>{{ money(r.value) }}</strong>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <div class="grid">
        <section class="card">
          <h3>Salidas registradas (no son merma)</h3>
          <dl class="lines">
            <div><dt>Cortesías</dt><dd>{{ money(period.exits.cortesias) }}</dd></div>
            <div><dt>Roturas registradas</dt><dd>{{ money(period.exits.roturas) }}</dd></div>
            <div><dt>Cocina</dt><dd>{{ money(period.exits.cocina) }}</dd></div>
            <div><dt>Tripulación</dt><dd>{{ money(period.exits.tripulacion) }}</dd></div>
            <div><dt>Brindis</dt><dd>{{ money(period.exits.brindis) }}</dd></div>
            <div><dt>Devoluciones a tierra</dt><dd>{{ money(period.exits.devoluciones) }}</dd></div>
          </dl>
        </section>
        <section class="card">
          <h3>Pedidos y compras</h3>
          <dl class="lines">
            <div><dt>Pedidos</dt><dd>{{ period.purchases.orders }}</dd></div>
            <div><dt>Aprobados a tiempo</dt><dd>{{ period.purchases.approvedOnTime }} de {{ period.purchases.orders }}</dd></div>
            <div><dt>Recepciones a tiempo</dt><dd>{{ period.purchases.receptionsOnTime }} de {{ period.purchases.receptions }}</dd></div>
            <div><dt>No conseguidos</dt><dd>{{ period.purchases.notFound }} producto{{ period.purchases.notFound === 1 ? '' : 's' }}</dd></div>
          </dl>
        </section>
      </div>

      <section class="card">
        <h3>Cobros por crucero</h3>
        <div class="table">
          <table>
            <thead>
              <tr><th scope="col">Crucero</th><th scope="col">Fechas</th><th scope="col" class="num">Tarjeta</th><th scope="col" class="num">Efectivo</th><th scope="col" class="num">Transferencia</th><th scope="col" class="num">Total</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in period.collections" :key="c.code">
                <td><CruiseTag :code="c.code" /><template v-if="c.status === 'abordo'"> (en curso)</template></td>
                <td>{{ fmt(c.start, { day: 'numeric', month: 'short' }) }}–{{ fmt(c.end, { day: 'numeric', month: 'short' }) }}</td>
                <td class="num">{{ money(c.tarjeta) }}</td>
                <td class="num">{{ money(c.efectivo) }}</td>
                <td class="num">{{ money(c.transferencia) }}</td>
                <td class="num"><strong>{{ money(c.total) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h3>Control cruzado · Administración vs bartender vs sistema</h3>
        <p v-if="!period.cross.length" class="muted">Sin controles de Administración en este período.</p>
        <div v-else class="table">
          <table>
            <thead>
              <tr><th scope="col">Producto</th><th scope="col" class="num">Administración</th><th scope="col" class="num">Bartender</th><th scope="col" class="num">Sistema</th><th scope="col">Diferencia</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in period.cross" :key="`${r.date}-${r.product}`">
                <td>{{ r.product }}</td>
                <td class="num">{{ r.admin }}</td>
                <td class="num">{{ r.bartender ?? '—' }}</td>
                <td class="num">{{ r.system }}</td>
                <td><span class="tone" :class="r.diff ? 'tone--rojo' : 'tone--verde'">{{ r.diff ? `${r.diff > 0 ? '+' : ''}${r.diff}` : 'Cuadra' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">Administración cuenta justo después del bartender, sin ver su conteo. Si encuentra menos, alguien cuenta mal o algo está saliendo.</p>
      </section>
    </template>

    <GoalsModal v-if="goalsOpen" @close="goalsOpen = false" @saved="goalsOpen = false" />
    <BaseModal v-if="settingsOpen" title="Configuración" subtitle="Responsable de compras, metas y límites del bar." @close="settingsOpen = false">
      <div class="settings">
        <h3 class="settings-sub">Responsable de compras</h3>
        <p class="muted">A esta persona le llega el pedido aprobado para comprar el jueves.</p>
        <p class="muted">Hoy: <strong>{{ settings?.purchaseResponsible?.name ?? '—' }}</strong><template v-if="settings?.purchaseResponsible?.until"> hasta el {{ settings.purchaseResponsible.until.slice(0, 10) }}</template>.</p>
        <div class="field">
          <label>Quién compra</label>
          <BaseSelect v-model="buyerId" :options="buyerOptions" />
        </div>
        <div v-if="buyerId" class="field">
          <label for="buyer-until">Hasta (vacío = fijo)</label>
          <input id="buyer-until" v-model="buyerUntil" type="date" />
        </div>
        <h3 class="settings-sub">Metas y límites</h3>
        <button type="button" class="btn btn-secondary" @click="settingsOpen = false; goalsOpen = true"><i class="fa-solid fa-sliders" aria-hidden="true" /> Abrir metas y límites (con «Rige desde»)</button>
      </div>
      <template #footer>
        <button type="button" class="btn btn-secondary" @click="settingsOpen = false">Cancelar</button>
        <button type="button" class="btn btn-primary" @click="saveBuyer">Guardar</button>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped lang="scss">
.control {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.control-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.control-title {
  margin: 0;
  font-size: 1.3rem;
  color: var(--navy-900);
}

.settings-sub {
  margin: 0.4rem 0 0;
  font-size: 1rem;
  color: var(--navy-900);
}

.card h3 {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
  color: var(--navy-900);
}

.muted {
  margin: 0;
  color: var(--ink-600);
}

.small {
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.cruise-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.75rem;

  h2 {
    margin: 0;
    font-size: 1.35rem;
  }
}

.cruise-meta {
  flex: 1 1 260px;
  text-align: right;
  font-size: 0.9rem;
}

.bar {
  height: 8px;
  margin-top: 0.75rem;
  border-radius: 999px;
  background: var(--cream-100);

  span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--navy-600);
  }
}

.kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0;

  > div {
    flex: 1 1 180px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  dt {
    font-size: 0.85rem;
    color: var(--ink-600);
  }

  dd {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  small {
    align-self: flex-start;
  }
}

.tone {
  display: inline-flex;
  padding: 0.12rem 0.55rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--pill-neutral-bg);
  color: var(--pill-neutral-ink);

  &--rojo {
    background: var(--pill-danger-bg);
    color: var(--pill-danger-ink);
  }

  &--amarillo {
    background: var(--pill-warn-bg);
    color: var(--pill-warn-ink);
  }

  &--verde {
    background: var(--pill-ok-bg);
    color: var(--pill-ok-ink);
  }
}

.table {
  overflow-x: auto;

  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }

  thead th {
    font-size: 0.8rem;
    color: var(--ink-600);
  }

  .num {
    text-align: right;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  white-space: nowrap;

  .btn-text {
    min-height: 40px;
    font-weight: 700;
    color: var(--navy-700);
  }
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;

  > * {
    flex: 1 1 320px;
    min-width: 0;
  }
}

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;

  > div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  dt {
    color: var(--ink-600);
  }

  dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .total {
    padding-top: 0.35rem;
    border-top: 1px solid var(--line);
  }
}

.hbars {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: grid;
    grid-template-columns: minmax(6rem, 10rem) minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
    font-variant-numeric: tabular-nums;
  }
}

.hbar {
  height: 12px;
  border-radius: 999px;
  background: var(--cream-100);
}

.hbar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--navy-600);

  &--red {
    background: var(--danger);
  }

  &--gold {
    background: var(--warning);
  }

  &--violet {
    background: #6a5acd;
  }
}

.sub {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  color: var(--ink-600);
}

.cycle {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem 1rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
  }
}

.closed-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.75rem;
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.closed-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.75rem;

  h4 {
    margin: 0.5rem 0 0;
    font-size: 0.95rem;
  }
}

.stepper {
  display: flex;
  align-items: center;
  gap: 0.5rem;

  strong {
    min-width: 9.5rem;
    text-align: center;
  }
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--navy-800);
}

.settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
