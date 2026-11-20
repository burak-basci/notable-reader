/* skipCode (reading rule "skip code blocks"): default on for new installs, a stored choice is kept, partial/absent stored reading blocks get the default.
   Run: node tests/reading-skipcode-default.test.mjs  -> "SKIPCODE DEFAULT OK (n checks)" */
import assert from 'node:assert/strict';
import {READING_DEFAULTS, cleanReading, validReading} from '../extension/playback/reading-rules.js';
import {migrate, defaults} from '../extension/config.mjs';
let checks = 0; const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
eq(READING_DEFAULTS.skipCode, true, 'default is on');
eq(cleanReading().skipCode, true, 'cleanReading() default');
eq(cleanReading({}).skipCode, true, 'empty block');
eq(cleanReading({skipCode: false}).skipCode, false, 'stored false is kept');
eq(cleanReading({skipCode: true}).skipCode, true, 'stored true is kept');
eq(validReading({...READING_DEFAULTS}), true, 'defaults are valid');
// a user who already has saved settings: the full reading block was stored (config.migrate writes cleanReading output), so the old default false stays
const stored = {voices: {}, configVersion: 2, reading: {...READING_DEFAULTS, skipCode: false}};
eq(migrate(stored).reading.skipCode, false, 'existing user keeps their stored false after migration');
eq(migrate(migrate(stored)).reading.skipCode, false, 'and after a second load');
eq(migrate(undefined).reading.skipCode, true, 'fresh install (nothing stored): on');
eq(migrate({voices: {}, configVersion: 2}).reading.skipCode, true, 'stored settings without any reading block: on');
if (typeof defaults === 'function') eq(defaults().reading.skipCode, true, 'defaults() on');
console.log(`SKIPCODE DEFAULT OK (${checks} checks)`);
