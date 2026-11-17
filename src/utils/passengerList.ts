import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { COUNTRIES } from '@/utils/countries'

/**
 * Lista de pasajeros del operador (PDF, pedido del cliente 16-nov-2026): una
 * fila por cama («1A», «1B»…) con nombre, pasaporte y nacionalidad. Se lee por
 * la posición de cada texto bajo su encabezado, así un país en dos líneas
 * («United / Kingdom») o columnas extra no la rompen.
 */
export interface ListRow {
  cabin: number
  bed: string
  name: string
  idNumber: string
  /** En español, como la usa la app (Estados Unidos, Reino Unido…). */
  nationality: string
  dates: string
}

export interface TextItem {
  str: string
  x: number
  y: number
  w: number
}

type Col = 'dates' | 'cab' | 'name' | 'passport' | 'nationality' | 'other'

const HEADERS: Array<[RegExp, Col]> = [
  [/crucero/i, 'dates'],
  [/^(#|(#\s*)?cab(ina)?\.?)$/i, 'cab'],
  [/nombre|name/i, 'name'],
  [/passport|pasaporte|documento/i, 'passport'],
  [/nacionalidad|nationality/i, 'nationality'],
]

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** «SCOTT HUNTER» → «Scott Hunter»; lo escrito con mayúsculas y minúsculas se deja. */
function displayName(raw: string) {
  const name = clean(raw)
  return name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : name
}

export function rowsFromItems(items: TextItem[]): ListRow[] {
  const text = items.filter((i) => i.str.trim())
  const nameHeader = text.find((i) => /nombre|name/i.test(i.str))
  if (!nameHeader) return []
  // Encabezados: la franja de la fila de «Nombre y Apellido»; uno en dos líneas («Fecha de / Crucero») se junta.
  const heads: Array<{ center: number; label: string }> = []
  for (const i of text.filter((t) => Math.abs(t.y - nameHeader.y) <= 6).sort((a, b) => b.y - a.y)) {
    const center = i.x + i.w / 2
    const same = heads.find((h) => Math.abs(h.center - center) < 8)
    if (same) same.label = `${same.label} ${i.str}`
    else heads.push({ center, label: i.str })
  }
  const columns = heads.map((h) => ({
    center: h.center,
    col: HEADERS.find(([re]) => re.test(clean(h.label)))?.[1] ?? ('other' as Col),
  }))
  const colOf = (i: TextItem) =>
    columns.reduce((best, c) => (Math.abs(c.center - (i.x + i.w / 2)) < Math.abs(best.center - (i.x + i.w / 2)) ? c : best))
      .col

  const body = text.filter((i) => i.y < nameHeader.y - 6)
  const anchors = body.filter((i) => colOf(i) === 'cab' && /^\d{1,2}\s*[A-Za-z]?$/.test(clean(i.str)))
  if (!anchors.length) return []
  const rows = anchors.map((a) => ({ anchor: a, cells: new Map<Col, TextItem[]>() }))
  for (const item of body) {
    const col = colOf(item)
    if (col === 'other' || col === 'cab') continue
    // Cada texto va a la fila (cama) más cercana en altura.
    const row = rows.reduce((best, r) => (Math.abs(r.anchor.y - item.y) < Math.abs(best.anchor.y - item.y) ? r : best))
    if (Math.abs(row.anchor.y - item.y) > 14) continue
    row.cells.set(col, [...(row.cells.get(col) ?? []), item])
  }
  const read = (cells: TextItem[] | undefined) =>
    clean(
      [...(cells ?? [])]
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((i) => i.str)
        .join(' '),
    )

  return rows
    .map(({ anchor, cells }) => {
      const bed = clean(anchor.str).toUpperCase()
      return {
        cabin: Number.parseInt(bed, 10),
        bed,
        name: displayName(read(cells.get('name'))),
        idNumber: read(cells.get('passport')).replace(/\s/g, ''),
        nationality: countryEs(read(cells.get('nationality'))),
        dates: read(cells.get('dates')),
      }
    })
    .filter((r) => r.name && r.cabin > 0)
}

// ---- País en español ----

const ALIASES: Record<string, string> = {
  usa: 'US', 'u.s.a.': 'US', 'united states of america': 'US', us: 'US', america: 'US',
  uk: 'GB', 'u.k.': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'great britain': 'GB', britain: 'GB',
  holland: 'NL', 'the netherlands': 'NL', 'south korea': 'KR', korea: 'KR', 'czech republic': 'CZ', russia: 'RU',
}

let byName: Map<string, string> | null = null

/** Nombre del país en inglés (o español) → como está en la lista de la app. Si no se reconoce, queda igual. */
export function countryEs(raw: string): string {
  const name = clean(raw)
  if (!name) return ''
  if (!byName) {
    byName = new Map()
    const en = new Intl.DisplayNames(['en'], { type: 'region' })
    const es = new Intl.DisplayNames(['es'], { type: 'region' })
    const A = 'A'.charCodeAt(0)
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j)
        const english = en.of(code)
        if (english && english !== code) byName.set(english.toLowerCase(), code)
        const spanish = es.of(code)
        if (spanish && spanish !== code) byName.set(spanish.toLowerCase(), code)
      }
    }
  }
  const key = name.toLowerCase()
  const code = ALIASES[key] ?? byName.get(key)
  if (!code) return name
  const spanish = new Intl.DisplayNames(['es'], { type: 'region' }).of(code) ?? name
  // La app usa su propia lista: se toma el nombre que ya conoce si coincide sin tildes.
  const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return COUNTRIES.find((c) => plain(c) === plain(spanish)) ?? spanish
}

/** Lee todas las páginas del PDF en la tableta (el archivo no sale del dispositivo). */
export async function readPassengerList(file: File): Promise<ListRow[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const rows: ListRow[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const { items } = await page.getTextContent()
    rows.push(
      ...rowsFromItems(
        items.flatMap((i) =>
          'str' in i ? [{ str: i.str, x: i.transform[4] as number, y: i.transform[5] as number, w: i.width }] : [],
        ),
      ),
    )
  }
  return rows
}
