// The quick-add parser under TZ=America/Sao_Paulo. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'America/Sao_Paulo'

import { defineParseSuite } from './parse.suite'

defineParseSuite('America/Sao_Paulo')
