// When a day of the notebook ends, under TZ=America/New_York. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'America/New_York'

import { defineWritableSuite } from './notebook.suite'

defineWritableSuite('America/New_York')
