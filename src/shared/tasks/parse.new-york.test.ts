// The quick-add parser under TZ=America/New_York. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'America/New_York'

import { defineParseSuite } from './parse.suite'

defineParseSuite('America/New_York')
