// The iCalendar suite under TZ=UTC. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'UTC'

import { defineIcalSuite } from './ical.suite'

defineIcalSuite('UTC')
