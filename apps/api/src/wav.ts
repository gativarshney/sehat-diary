/** Read duration and sample rate from a PCM WAV header. Throws on non-WAV input. */
export function wavInfo(bytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; seconds: number } {
  if (bytes.length < 44) throw new Error('not a wav file')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a wav file')
  // walk chunks to find fmt and data
  let off = 12
  let sampleRate = 0
  let channels = 1
  let bits = 16
  let dataLen = 0
  while (off + 8 <= bytes.length) {
    const id = tag(off)
    const size = dv.getUint32(off + 4, true)
    if (id === 'fmt ') {
      channels = dv.getUint16(off + 10, true)
      sampleRate = dv.getUint32(off + 12, true)
      bits = dv.getUint16(off + 22, true)
    } else if (id === 'data') {
      dataLen = Math.min(size, bytes.length - off - 8)
      break
    }
    off += 8 + size + (size % 2)
  }
  if (!sampleRate || !dataLen) throw new Error('not a wav file')
  const seconds = dataLen / (sampleRate * channels * (bits / 8))
  return { sampleRate, channels, bitsPerSample: bits, seconds }
}
