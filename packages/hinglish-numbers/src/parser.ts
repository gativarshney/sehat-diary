/**
 * Deterministic Hinglish number parser (v0, pre-registered for E-min).
 *
 * Scope of v0 (what E-min scores against)
 * - Devanagari and ASCII digits, decimal points ("point", "dashamlav", ".")
 * - Hindi cardinals 0 to 99 in Devanagari and common Roman spellings; "sau" (100), "hazaar" (1000)
 * - Fraction words: dedh (1.5x), dhai (2.5x), sawa (1.25x), paune (0.25 less than next), aadha (0.5x)
 * - Blood-pressure separators: "by", "bata", "upar ... neeche", "/" and bare pairs
 * - Correction phrases: a leading "nahi"/"galat" marks a correction
 *
 * The parser never invents numbers; when a token sequence is ambiguous it sets doubt=true with a reason.
 */

export interface Candidate {
  value: number
  span: [number, number]
  source: 'digits' | 'words' | 'fraction'
}

export interface ParseResult {
  numbers: Candidate[]
  values: number[]
  bp: [number, number] | null
  isCorrection: boolean
  doubt: boolean
  reasons: string[]
}

const DEV_UNITS: Record<string, number> = {
  'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5, 'छह': 6, 'छः': 6, 'छे': 6,
  'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14,
  'पंद्रह': 15, 'पन्द्रह': 15, 'सोलह': 16, 'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19, 'बीस': 20,
  'इक्कीस': 21, 'बाईस': 22, 'बाइस': 22, 'तेईस': 23, 'चौबीस': 24, 'पच्चीस': 25, 'छब्बीस': 26,
  'सत्ताईस': 27, 'सत्ताइस': 27, 'अट्ठाईस': 28, 'अट्ठाइस': 28, 'अठ्ठाईस': 28, 'उनतीस': 29, 'तीस': 30,
  'इकतीस': 31, 'बत्तीस': 32, 'तैंतीस': 33, 'चौंतीस': 34, 'पैंतीस': 35, 'छत्तीस': 36, 'सैंतीस': 37,
  'अड़तीस': 38, 'उनतालीस': 39, 'चालीस': 40, 'इकतालीस': 41, 'बयालीस': 42, 'तैंतालीस': 43,
  'चवालीस': 44, 'पैंतालीस': 45, 'छियालीस': 46, 'सैंतालीस': 47, 'अड़तालीस': 48, 'उनचास': 49,
  'पचास': 50, 'इक्यावन': 51, 'बावन': 52, 'तिरपन': 53, 'चौवन': 54, 'पचपन': 55, 'छप्पन': 56,
  'सत्तावन': 57, 'अट्ठावन': 58, 'उनसठ': 59, 'साठ': 60, 'इकसठ': 61, 'बासठ': 62, 'तिरसठ': 63,
  'चौंसठ': 64, 'पैंसठ': 65, 'छियासठ': 66, 'सड़सठ': 67, 'अड़सठ': 68, 'उनहत्तर': 69, 'सत्तर': 70,
  'इकहत्तर': 71, 'बहत्तर': 72, 'तिहत्तर': 73, 'चौहत्तर': 74, 'पचहत्तर': 75, 'छिहत्तर': 76,
  'सतहत्तर': 77, 'अठहत्तर': 78, 'उनासी': 79, 'अस्सी': 80, 'इक्यासी': 81, 'बयासी': 82, 'तिरासी': 83,
  'चौरासी': 84, 'पचासी': 85, 'छियासी': 86, 'सत्तासी': 87, 'अट्ठासी': 88, 'नवासी': 89, 'नब्बे': 90,
  'इक्यानवे': 91, 'बानवे': 92, 'तिरानवे': 93, 'चौरानवे': 94, 'पचानवे': 95, 'छियानवे': 96,
  'सत्तानवे': 97, 'अट्ठानवे': 98, 'निन्यानवे': 99, 'सौ': 100,
}

const ROMAN_UNITS: Record<number, string[]> = {
  0: ['shunya', 'zero'], 1: ['ek', 'one'], 2: ['do', 'two'], 3: ['teen', 'three'], 4: ['char', 'chaar', 'four'],
  5: ['panch', 'paanch', 'five'], 6: ['chhe', 'che', 'chah', 'six'], 7: ['saat', 'sat', 'seven'], 8: ['aath', 'ath', 'eight'],
  9: ['nau', 'nine'], 10: ['das', 'dus', 'ten'], 11: ['gyarah', 'gyaarah', 'eleven'], 12: ['barah', 'baarah', 'twelve'],
  13: ['terah', 'thirteen'], 14: ['chaudah', 'chodah', 'fourteen'], 15: ['pandrah', 'fifteen'], 16: ['solah', 'sixteen'],
  17: ['satrah', 'seventeen'], 18: ['atharah', 'eighteen'], 19: ['unnis', 'unees', 'nineteen'], 20: ['bees', 'bis', 'twenty'],
  21: ['ikkis', 'ikees'], 22: ['bais', 'baees'], 23: ['teis'], 24: ['chaubis', 'chaubees'], 25: ['pachhis', 'pachchis', 'pachees'],
  26: ['chhabbis', 'chabbis', 'chhabbees'], 27: ['sattais', 'sattaees'], 28: ['atthais', 'atthaees', 'athais'], 29: ['untis', 'untees'],
  30: ['tis', 'tees', 'thirty'], 31: ['iktis', 'ikattis'], 32: ['battis', 'battees'], 33: ['taintis', 'tentis'], 34: ['chauntis', 'chontis'],
  35: ['paintis', 'pentis'], 36: ['chhattis', 'chattis'], 37: ['saintis', 'sentis'], 38: ['adtis', 'artis'], 39: ['untalis', 'unchalis'],
  40: ['chalis', 'chaalis', 'forty'], 41: ['iktalis'], 42: ['bayalis', 'bayaalis'], 43: ['taintalis'], 44: ['chavalis', 'chauvalis'],
  45: ['paintalis'], 46: ['chhiyalis'], 47: ['saintalis'], 48: ['adtalis'], 49: ['unchas'], 50: ['pachas', 'pachaas', 'fifty'],
  51: ['ikyavan'], 52: ['bavan', 'baavan'], 53: ['tirpan'], 54: ['chauvan', 'chawan', 'chauwan'], 55: ['pachpan'],
  56: ['chhappan', 'chappan'], 57: ['sattavan'], 58: ['atthavan'], 59: ['unsath'], 60: ['sath', 'saath', 'sixty'], 61: ['iksath'],
  62: ['basath', 'baasath'], 63: ['tirsath'], 64: ['chaunsath'], 65: ['painsath'], 66: ['chhiyasath'], 67: ['sadsath'], 68: ['adsath'],
  69: ['unhattar'], 70: ['sattar', 'seventy'], 71: ['ikhattar'], 72: ['bahattar'], 73: ['tihattar'], 74: ['chauhattar'],
  75: ['pachhattar', 'pachattar'], 76: ['chhihattar'], 77: ['sathattar'], 78: ['athhattar'], 79: ['unasi', 'unaasi'],
  80: ['assi', 'eighty'], 81: ['ikyasi'], 82: ['bayasi', 'bayaasi'], 83: ['tirasi'], 84: ['chaurasi'], 85: ['pachasi', 'pachaasi'],
  86: ['chhiyasi'], 87: ['sattasi'], 88: ['atthasi'], 89: ['navasi'], 90: ['nabbe', 'ninety'], 91: ['ikyanve'], 92: ['banve', 'baanve'],
  93: ['tiranve'], 94: ['chauranve'], 95: ['pachanve'], 96: ['chhiyanve'], 97: ['sattanve'], 98: ['atthanve'], 99: ['ninyanve'],
  100: ['sau', 'so', 'hundred'],
}

const WORD_TO_NUM = new Map<string, number>()
for (const [n, spellings] of Object.entries(ROMAN_UNITS)) for (const s of spellings) WORD_TO_NUM.set(s, Number(n))
for (const [w, n] of Object.entries(DEV_UNITS)) WORD_TO_NUM.set(w, n)

const THOUSAND = new Set(['hazaar', 'hazar', 'thousand', 'हज़ार', 'हजार'])
const HUNDRED = new Set(['sau', 'so', 'hundred', 'सौ'])
const DECIMAL = new Set(['point', 'dashamlav', 'dashamlab', 'पॉइंट', 'पाइंट', 'दशमलव', '.'])
const FRACTION: Record<string, ['mul' | 'sub', number]> = {
  dedh: ['mul', 1.5], 'डेढ़': ['mul', 1.5], 'डेढ': ['mul', 1.5],
  dhai: ['mul', 2.5], dhaai: ['mul', 2.5], 'ढाई': ['mul', 2.5],
  sawa: ['mul', 1.25], sava: ['mul', 1.25], 'सवा': ['mul', 1.25],
  paune: ['sub', 0.25], pone: ['sub', 0.25], 'पौने': ['sub', 0.25],
  aadha: ['mul', 0.5], adha: ['mul', 0.5], 'आधा': ['mul', 0.5],
}
const HALF_WORDS = new Set(['aadha', 'adha', 'आधा'])
const BP_SEP = new Set(['by', 'bata', 'batta', 'बटा', 'बाय', '/', 'over', 'upon'])
const BP_UPAR = new Set(['upar', 'ऊपर', 'oopar'])
const BP_NEECHE = new Set(['neeche', 'niche', 'नीचे'])
const BP_WORDS = new Set(['bp', 'बीपी', 'blood', 'प्रेशर', 'pressure', 'ब्लड'])
const CORRECTION = new Set(['nahi', 'nahin', 'नहीं', 'नही', 'galat', 'ग़लत', 'गलत'])

const DEV_DIGITS = '०१२३४५६७८९'

/** Tokens Prisma has been observed to merge; split before parsing. Mirrors the server-side substitution map. */
export const KNOWN_MERGES: Record<string, string[]> = {
  'बटासी': ['बटा', 'अस्सी'],
  'बटाअस्सी': ['बटा', 'अस्सी'],
  'बायअस्सी': ['बाय', 'अस्सी'],
}

/** Map Devanagari digits to ASCII and drop commas inside integers. */
export function normalizeDigits(text: string): string {
  let t = ''
  for (const ch of text) {
    const i = DEV_DIGITS.indexOf(ch)
    t += i >= 0 ? String(i) : ch
  }
  return t.replace(/(?<=\d),(?=\d)/g, '')
}

export function tokenize(text: string): string[] {
  let t = normalizeDigits(text.toLowerCase())
  t = t.replace(/(\d)\s*\.\s*(\d)/g, '$1 . $2')
  t = t.replace(/\//g, ' / ')
  t = t.replace(/[,;!?।]/g, ' ')
  return t
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((tok) => KNOWN_MERGES[tok] ?? [tok])
}

const isDigits = (s: string) => /^\d+$/.test(s)

/** Scan tokens and fold number words/digits into candidates. */
export function wordsToNumbers(tokens: string[]): Candidate[] {
  const out: Candidate[] = []
  const n = tokens.length
  let i = 0
  while (i < n) {
    const tok = tokens[i]
    const start = i

    if (tok in FRACTION) {
      const [kind, f] = FRACTION[tok]
      let j = i + 1
      let base: number | null = null
      let unit = 1
      if (j < n && isDigits(tokens[j])) {
        // ITN output: fraction word + digits. The fraction applies to the leading power of ten.
        const num = Number(tokens[j])
        const pow = num >= 10 ? 10 ** Math.floor(Math.log10(num)) : 1
        const value = kind === 'mul' ? (HALF_WORDS.has(tok) ? num * f : num + (f - 1) * pow) : num - f * pow
        if (value > 0) out.push({ value, span: [start, j + 1], source: 'fraction' })
        i = j + 1
        continue
      }
      if (j < n && WORD_TO_NUM.has(tokens[j]) && !HUNDRED.has(tokens[j])) {
        base = WORD_TO_NUM.get(tokens[j])!
        j++
      }
      if (j < n && HUNDRED.has(tokens[j])) {
        unit = 100
        j++
      } else if (j < n && THOUSAND.has(tokens[j])) {
        unit = 1000
        j++
      }
      let value: number
      if (kind === 'mul') {
        if (base !== null && unit > 1) value = (base + (f - 1)) * unit
        else if (base !== null) value = HALF_WORDS.has(tok) ? f * base : base + (f - 1)
        else value = f * unit
      } else {
        if (base !== null) value = (base - f) * unit
        else if (unit > 1) value = (1 - f) * unit
        else value = -1
      }
      if (value >= 0) out.push({ value, span: [start, j], source: 'fraction' })
      i = j
      continue
    }

    if (isDigits(tok)) {
      let value = Number(tok)
      let j = i + 1
      if (j + 1 < n && DECIMAL.has(tokens[j]) && isDigits(tokens[j + 1])) {
        value = Number(`${tok}.${tokens[j + 1]}`)
        j += 2
      } else if (j + 1 < n && DECIMAL.has(tokens[j]) && WORD_TO_NUM.has(tokens[j + 1])) {
        value = Number(`${tok}.${WORD_TO_NUM.get(tokens[j + 1])}`)
        j += 2
      }
      out.push({ value, span: [start, j], source: 'digits' })
      i = j
      continue
    }

    if (WORD_TO_NUM.has(tok) || HUNDRED.has(tok) || THOUSAND.has(tok)) {
      let total = 0
      let cur = 0
      let j = i
      let consumed = false
      while (j < n) {
        const w = tokens[j]
        if (THOUSAND.has(w)) {
          cur = (cur || 1) * 1000
          total += cur
          cur = 0
          j++
          consumed = true
        } else if (HUNDRED.has(w)) {
          cur = (cur || 1) * 100
          j++
          consumed = true
        } else if (WORD_TO_NUM.has(w)) {
          const v = WORD_TO_NUM.get(w)!
          if (cur && cur % 100 === 0 && v < 100) cur += v
          else if (cur && v < 100) break // second bare unit starts a new number
          else cur = v
          j++
          consumed = true
        } else break
      }
      total += cur
      if (!consumed) {
        i++
        continue
      }
      if (j + 1 < n && DECIMAL.has(tokens[j])) {
        const ft = tokens[j + 1]
        const frac = WORD_TO_NUM.has(ft) ? WORD_TO_NUM.get(ft)! : isDigits(ft) ? Number(ft) : null
        if (frac !== null) {
          total = Number(`${Math.trunc(total)}.${frac}`)
          j += 2
        }
      }
      out.push({ value: total, span: [start, j], source: 'words' })
      i = j
      continue
    }
    i++
  }
  return out
}

export function parseNumbers(text: string): ParseResult {
  const tokens = tokenize(text)
  const numbers = wordsToNumbers(tokens)
  const res: ParseResult = {
    numbers,
    values: numbers.map((c) => c.value),
    bp: null,
    isCorrection: tokens.slice(0, 3).some((t) => CORRECTION.has(t)),
    doubt: false,
    reasons: [],
  }

  if (numbers.length >= 2) {
    const [a, b] = numbers
    const between = tokens.slice(a.span[1], b.span[0])
    const hasSep = between.some((t) => BP_SEP.has(t))
    const uparBefore = tokens.slice(0, a.span[0]).some((t) => BP_UPAR.has(t))
    const neecheBetween = between.some((t) => BP_NEECHE.has(t))
    if (hasSep || (uparBefore && neecheBetween)) res.bp = [a.value, b.value]
    else if (between.length === 0 && a.value >= 60 && a.value <= 260 && b.value >= 30 && b.value <= 160) {
      res.bp = [a.value, b.value]
      res.doubt = true
      res.reasons.push('bare pair without separator')
    }
  }

  if (numbers.length === 1 && tokens.some((t) => BP_WORDS.has(t))) {
    res.doubt = true
    res.reasons.push('blood pressure with a single number')
  }
  if (numbers.some((c) => c.source === 'fraction')) {
    res.doubt = true
    res.reasons.push('fraction word')
  }
  if (tokens.some((t) => DECIMAL.has(t))) {
    res.doubt = true
    res.reasons.push('spoken decimal')
  }
  if (numbers.length > 2) {
    res.doubt = true
    res.reasons.push('more than two numbers')
  }
  return res
}

/** A reading is one spoken entry. */
export const parseReading = parseNumbers
