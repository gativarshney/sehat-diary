import { EMIN_CASES } from '../emin-cases'
import CaseRecorder from './CaseRecorder'

/** Records the 12 pre-registered E-min utterances. */
export default function EminRecorder() {
  return <CaseRecorder title="E-min recorder" cases={EMIN_CASES} folder="bench/emin/audio/" />
}
