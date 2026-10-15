// When a day of the notebook ends, under TZ=Asia/Tokyo. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'Asia/Tokyo'

import { defineWritableSuite } from './notebook.suite'

defineWritableSuite('Asia/Tokyo')
