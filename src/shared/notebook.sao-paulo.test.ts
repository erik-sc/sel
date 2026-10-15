// When a day of the notebook ends, under TZ=America/Sao_Paulo. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'America/Sao_Paulo'

import { defineWritableSuite } from './notebook.suite'

defineWritableSuite('America/Sao_Paulo')
