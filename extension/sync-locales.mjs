// Run after an intentional update to the shared native Reader catalog.
import {readFile,writeFile} from 'node:fs/promises';
const bytes=await readFile(new URL('../ui-locales.json',import.meta.url));
const catalog=JSON.parse(bytes);
if(catalog.schemaVersion!==1 || catalog.languages.map(item=>item.code).join(',')!=='de,en,fr,es,it,pt')throw Error('Invalid shared locale catalog');
const keys=Object.keys(catalog.messages.de).sort();
for(const {code}of catalog.languages)if(JSON.stringify(Object.keys(catalog.messages[code]).sort())!==JSON.stringify(keys))throw Error('Incomplete shared locale catalog');
await writeFile(new URL('./ui-locales.json',import.meta.url),bytes);
console.log('Shared Reader locale catalog copied: '+keys.length+' keys × 6 languages');
