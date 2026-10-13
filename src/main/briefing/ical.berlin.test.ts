// The iCalendar suite under TZ=Europe/Berlin. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'Europe/Berlin'

import { defineIcalSuite } from './ical.suite'

defineIcalSuite('Europe/Berlin')
