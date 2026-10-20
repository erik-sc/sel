// The `pages` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'pages:ancestors',
  'pages:backlinks',
  'pages:deleteForever',
  'pages:duplicate',
  'pages:exportMarkdown',
  'pages:exportPdf',
  'pages:exportTex',
  'pages:importMarkdown',
  'pages:listArchived',
  'pages:listChildren',
  'pages:listFavorites',
  'pages:listRecent',
  'pages:listRoot',
  'pages:listTrash',
  'pages:restore'
]
