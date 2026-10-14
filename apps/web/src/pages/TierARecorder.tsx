import { parse } from 'yaml'
import casesYaml from '../../../../bench/tier-a/cases.yaml?raw'
import CaseRecorder, { type RecCase } from './CaseRecorder'

interface YamlCase {
  id: string
  script_roman: string
}

const CASES: RecCase[] = (parse(casesYaml) as YamlCase[]).map((c) => ({ id: c.id, roman: c.script_roman }))

/** Records the 60 pre-registered Tier A utterances (single source of truth: bench/tier-a/cases.yaml). */
export default function TierARecorder() {
  return <CaseRecorder title="Tier A recorder (60)" cases={CASES} folder="bench/tier-a/audio/<speaker>/clean/" />
}
