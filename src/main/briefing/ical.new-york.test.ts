// The iCalendar suite under TZ=America/New_York. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'America/New_York'

import { defineIcalSuite } from './ical.suite'

defineIcalSuite('America/New_York')
