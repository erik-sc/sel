// The quick-add parser under TZ=Pacific/Auckland. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'Pacific/Auckland'

import { defineParseSuite } from './parse.suite'

defineParseSuite('Pacific/Auckland')
