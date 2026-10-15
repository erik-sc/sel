// When a day of the notebook ends, under TZ=UTC. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'UTC'

import { defineWritableSuite } from './notebook.suite'

defineWritableSuite('UTC')
