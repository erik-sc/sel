// The `briefing` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'briefing:addPhrase',
  'briefing:agenda',
  'briefing:anotherPhrase',
  'briefing:brief',
  'briefing:calendars.add',
  'briefing:calendars.list',
  'briefing:calendars.remove',
  'briefing:calendars.test',
  'briefing:calendars.update',
  'briefing:completeTask',
  'briefing:databases',
  'briefing:ensurePhrasesDatabase',
  'briefing:get',
  'briefing:undoCompleteTask'
]
