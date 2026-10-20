// The `meetings` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'meetings:audio.delete',
  'meetings:audio.info',
  'meetings:cancelTranscribe',
  'meetings:create',
  'meetings:engine.cancelDownload',
  'meetings:engine.download',
  'meetings:engine.pickModel',
  'meetings:engine.pickProgram',
  'meetings:engine.remove',
  'meetings:engine.status',
  'meetings:openFolder',
  'meetings:recording.begin',
  'meetings:recording.discard',
  'meetings:recording.pause',
  'meetings:recording.probe',
  'meetings:recording.recover',
  'meetings:recording.resume',
  'meetings:recording.stop',
  'meetings:setSpeakers',
  'meetings:status',
  'meetings:storage',
  'meetings:transcribe'
]
