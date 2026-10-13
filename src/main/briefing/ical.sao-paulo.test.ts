// The iCalendar suite under TZ=America/Sao_Paulo. The zone is process-wide state, so each zone has a file.
process.env.TZ = 'America/Sao_Paulo'

import { defineIcalSuite } from './ical.suite'

defineIcalSuite('America/Sao_Paulo')
