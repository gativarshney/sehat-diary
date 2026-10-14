/**
 * Pre-registered E-min cases (TypeScript mirror of cases.yaml, which remains the canonical
 * human-readable pre-registration). Do not edit after results exist; add amendments to PROTOCOL.md.
 */
export type Kind = 'bp' | 'sugar' | 'weight' | 'correction' | 'none'

export interface Case {
  id: string
  scriptRoman: string
  scriptDev: string
  kind: Kind
  expect: number[]
  ambiguous: boolean
}

export const CASES: Case[] = [
  { id: 'bp_by', scriptRoman: 'BP ek sau atthais by bayasi', scriptDev: 'बीपी एक सौ अट्ठाईस बाय बयासी', kind: 'bp', expect: [128, 82], ambiguous: false },
  { id: 'bp_bata', scriptRoman: 'blood pressure ek sau bees bata assi', scriptDev: 'ब्लड प्रेशर एक सौ बीस बटा अस्सी', kind: 'bp', expect: [120, 80], ambiguous: false },
  { id: 'bp_upar_neeche', scriptRoman: 'upar ek sau tees neeche pachasi', scriptDev: 'ऊपर एक सौ तीस नीचे पचासी', kind: 'bp', expect: [130, 85], ambiguous: false },
  { id: 'bp_bare_pair', scriptRoman: 'BP ek sau chauvan chauranve', scriptDev: 'बीपी एक सौ चौवन चौरानवे', kind: 'bp', expect: [154, 94], ambiguous: true },
  { id: 'sugar_dedh', scriptRoman: 'sugar fasting dedh sau', scriptDev: 'शुगर फास्टिंग डेढ़ सौ', kind: 'sugar', expect: [150], ambiguous: true },
  { id: 'sugar_dhai', scriptRoman: 'khane ke baad sugar dhai sau', scriptDev: 'खाने के बाद शुगर ढाई सौ', kind: 'sugar', expect: [250], ambiguous: true },
  { id: 'sugar_sawa', scriptRoman: 'sugar sawa sau tha', scriptDev: 'शुगर सवा सौ था', kind: 'sugar', expect: [125], ambiguous: true },
  { id: 'sugar_paune', scriptRoman: 'sugar paune do sau', scriptDev: 'शुगर पौने दो सौ', kind: 'sugar', expect: [175], ambiguous: true },
  { id: 'weight_point', scriptRoman: 'weight chauvan point paanch kilo', scriptDev: 'वेट चौवन पॉइंट पाँच किलो', kind: 'weight', expect: [54.5], ambiguous: true },
  { id: 'weight_dashamlav', scriptRoman: 'vajan bahattar dashamlav do', scriptDev: 'वज़न बहत्तर दशमलव दो', kind: 'weight', expect: [72.2], ambiguous: true },
  { id: 'correction', scriptRoman: 'nahi, ek sau atthais', scriptDev: 'नहीं, एक सौ अट्ठाईस', kind: 'correction', expect: [128], ambiguous: false },
  { id: 'out_of_domain', scriptRoman: 'aaj mausam bahut accha hai', scriptDev: 'आज मौसम बहुत अच्छा है', kind: 'none', expect: [], ambiguous: false },
]

/** TTS checks (not part of the hypothesis): same sentence, two voices. */
export const TTS_CHECKS = {
  text: 'आपका बीपी एक सौ अट्ठाईस बाय बयासी है। सही है?',
  voices: [
    { voice: 'Nalini', model: 'timbre-v2.5', language: 'hi-IN' },
    { voice: 'Poorvi', model: 'timbre-v2.5', language: 'hi-en' },
  ],
}
