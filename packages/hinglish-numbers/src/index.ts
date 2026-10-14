/**
 * Hinglish number parsing for spoken health readings.
 *
 * Turns Prisma transcripts (Devanagari or Latin script, digits or number words,
 * including Hindi fraction words such as dedh, dhai, sawa, paune) into candidate
 * numeric values with an explicit doubt flag. Pure rules, no model, no clinical logic.
 */
export { parseNumbers, parseReading, normalizeDigits, wordsToNumbers, tokenize } from './parser'
export type { Candidate, ParseResult } from './parser'
