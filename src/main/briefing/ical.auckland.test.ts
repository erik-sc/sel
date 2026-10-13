// The iCalendar suite under TZ=Pacific/Auckland. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'Pacific/Auckland'

import { defineIcalSuite } from './ical.suite'

defineIcalSuite('Pacific/Auckland')
