// The quick-add parser under TZ=UTC. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'UTC'

import { defineParseSuite } from './parse.suite'

defineParseSuite('UTC')
