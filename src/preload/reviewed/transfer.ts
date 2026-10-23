// The `transfer` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = ['transfer:cancelImport', 'transfer:exportZip', 'transfer:pickImport', 'transfer:runImport', 'transfer:undoImport']
