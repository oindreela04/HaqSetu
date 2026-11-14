// Writes the shared field catalogue used by the Python voice service.
const fs = require('fs');
const path = require('path');
const F = require('../src/profileFields');
const out = { FIELDS: F.FIELDS, EDU_ORDER: F.EDU_ORDER, FLAGS: F.FLAGS };
fs.writeFileSync(path.join(__dirname, '..', 'voice', 'fields.json'), JSON.stringify(out, null, 1));
console.log('voice/fields.json written');
