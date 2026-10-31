import { useConfirmStore } from '@/stores/confirm'
import { apiBonifyConsumption, apiUndoConsumption } from '@/services/api'
import type { CabinSummary } from '@/types'

/**
 * Correcciones de un consumo, iguales en Cuentas y en el Bar (pedido del
 * cliente, 31-oct-2026): Cortesía (se sirvió, deja de cobrarse) y Retirar
 * consumo (pregunta si se sirvió). Las dos piden motivo, actualizan el
 * total y quedan en el historial con quién y cuándo. El servidor decide
 * quién puede: el bar solo con la cuenta sin aprobar.
 */
export interface CorrectableLine {
  orderId: string
  name: string
  qty: number
  /** Ya es cortesía: retirarla solo cabe si no se sirvió. */
  courtesy?: boolean
}

export interface CorrectionResult {
  message: string
  summary?: CabinSummary
}

const COURTESY_REASONS = ['Cortesía de la casa', 'Compensación al pasajero']
const APPROVED_NOTE = ' La cuenta está aprobada: este cambio anula la aprobación y habrá que volver a aprobarla.'

export function useConsumptionCorrections() {
  const confirmStore = useConfirmStore()

  /** Pregunta el motivo y marca la cortesía. null si se cancela. */
  async function courtesy(line: CorrectableLine, opts: { approved?: boolean } = {}): Promise<CorrectionResult | null> {
    const reason = await confirmStore.askReason({
      title: `¿Marcar ${line.qty} ${line.name} como cortesía?`,
      message: `Deja de cobrarse, pero se sirvió: los ingredientes siguen descontados. Queda en el historial.${opts.approved ? APPROVED_NOTE : ''}`,
      confirmLabel: 'Marcar como cortesía',
      icon: 'fa-gift',
      reason: { label: 'Motivo (obligatorio)', suggestions: COURTESY_REASONS },
    })
    if (!reason) return null
    const data = await apiBonifyConsumption(line.orderId, reason)
    return { message: 'Marcada como cortesía', summary: data.summary }
  }

  /**
   * Retirar un consumo: si no se sirvió vuelven los ingredientes; si se
   * sirvió queda como cortesía y el stock sigue descontado.
   */
  async function retire(line: CorrectableLine, opts: { approved?: boolean } = {}): Promise<CorrectionResult | null> {
    if (line.courtesy) {
      const reason = await confirmStore.askReason({
        title: `¿Retirar ${line.qty} ${line.name} de la cuenta?`,
        message: `Ya es cortesía: retirarla es porque no se sirvió y vuelven los ingredientes. Queda en el historial.${opts.approved ? APPROVED_NOTE : ''}`,
        confirmLabel: 'Retirar consumo',
        danger: true,
        icon: 'fa-rotate-left',
        reason: { label: 'Motivo (obligatorio)', suggestions: ['No se sirvió', 'Cabina equivocada', 'Toqué otra bebida'] },
      })
      if (!reason) return null
      const data = await apiUndoConsumption(line.orderId, reason)
      return { message: 'Consumo retirado: ingredientes devueltos', summary: data.summary }
    }
    const answer = await confirmStore.askChoice({
      title: `¿Retirar ${line.qty} ${line.name} de la cuenta?`,
      message: `El total se actualiza al instante y la corrección queda en el historial.${opts.approved ? APPROVED_NOTE : ''}`,
      confirmLabel: 'Retirar consumo',
      danger: true,
      icon: 'fa-rotate-left',
      choice: {
        label: '¿Se sirvió la bebida?',
        options: [
          { value: 'no', label: 'No se sirvió', hint: 'Vuelven los ingredientes' },
          { value: 'si', label: 'Sí se sirvió', hint: 'Queda como cortesía; el stock sigue descontado' },
        ],
      },
      reason: {
        label: 'Motivo (obligatorio)',
        suggestions: ['El pasajero dice que no lo pidió', 'Cabina equivocada', 'Toqué otra bebida', 'Compensación al pasajero'],
      },
    })
    if (!answer) return null
    if (answer.choice === 'no') {
      const data = await apiUndoConsumption(line.orderId, answer.reason)
      return { message: 'Consumo retirado: ingredientes devueltos', summary: data.summary }
    }
    const data = await apiBonifyConsumption(line.orderId, `Retirado por reclamo (se sirvió): ${answer.reason}`)
    return { message: 'Consumo retirado como cortesía', summary: data.summary }
  }

  return { courtesy, retire, COURTESY_REASONS }
}
