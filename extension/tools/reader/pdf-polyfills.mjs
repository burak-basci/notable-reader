/* Stand-ins for the newest built-ins that the bundled pdf.js calls without a fallback:
 * Map/WeakMap.prototype.getOrInsert, getOrInsertComputed (TC39 upsert), Math.sumPrecise, Promise.try, URL.parse,
 * Uint8Array toHex/toBase64/fromBase64 and Response.prototype.bytes.
 * Installed only where the browser lacks them, non-enumerable like built-ins. The functions are exported as well
 * so that tests can compare them with the native ones. No eval, no network, no global side effect beyond that. */

const mapHas = Map.prototype.has, mapGet = Map.prototype.get, mapSet = Map.prototype.set;
const weakHas = WeakMap.prototype.has, weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;

const callable = value => typeof value === 'function';
const heldWeakly = key => (typeof key === 'object' && key !== null) || typeof key === 'function'
  || (typeof key === 'symbol' && Symbol.keyFor(key) === undefined);

/* Method syntax: the functions get the right name and length and are not constructors, like built-ins. */
const methods = {
  getOrInsert(key, value) {
    if (mapHas.call(this, key)) return mapGet.call(this, key);
    mapSet.call(this, key, value);   // Map#set turns -0 into +0
    return value;
  },
  getOrInsertComputed(key, callback) {
    const present = mapHas.call(this, key);   // throws a TypeError for a receiver that is no Map
    if (!callable(callback)) throw new TypeError('callback is not a function');
    if (present) return mapGet.call(this, key);
    const value = callback(key === 0 ? 0 : key);
    mapSet.call(this, key, value);   // also right when the callback has inserted the key meanwhile
    return value;
  },
};
const weakMethods = {
  getOrInsert(key, value) {
    weakHas.call(this, key);   // receiver check
    if (!heldWeakly(key)) throw new TypeError('invalid value used as weak map key');
    if (weakHas.call(this, key)) return weakGet.call(this, key);
    weakSet.call(this, key, value);
    return value;
  },
  getOrInsertComputed(key, callback) {
    weakHas.call(this, key);
    if (!heldWeakly(key)) throw new TypeError('invalid value used as weak map key');
    if (!callable(callback)) throw new TypeError('callback is not a function');
    if (weakHas.call(this, key)) return weakGet.call(this, key);
    const value = callback(key);
    weakSet.call(this, key, value);
    return value;
  },
};
const mathMethods = {
  sumPrecise(items) {
    let plain = -0, magnitude = 0, simple = true, count = 0, nan = false, up = false, down = false;
    const finite = [];
    for (const item of items) {   // for-of closes the iterator when a TypeError leaves the loop
      if (typeof item !== 'number') throw new TypeError('Math.sumPrecise: values must be numbers');
      count++;
      if (item !== item) nan = true;
      else if (item === Infinity) up = true;
      else if (item === -Infinity) down = true;
      else {
        finite.push(item);
        if (simple) {   // integers whose absolute sum stays below 2^53 add without any rounding
          magnitude += Math.abs(item);
          simple = Number.isInteger(item) && magnitude < 9007199254740992;
          plain += item;
        }
      }
    }
    if (nan || (up && down)) return NaN;
    if (up) return Infinity;
    if (down) return -Infinity;
    if (count === 0) return -0;
    if (simple) return plain;   // starts at -0, so only an all -0 input keeps it
    return exactSum(finite);
  },
};
const bits = new DataView(new ArrayBuffer(8));

const uint8Tag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get;
const requireUint8 = value => { if (uint8Tag.call(value) !== 'Uint8Array') throw new TypeError('not a Uint8Array'); };
const responseBuffer = Response.prototype.arrayBuffer;
const ALPHABETS = {base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'};
const optionsOf = options => {
  if (options !== undefined && (typeof options !== 'object' || options === null)
    && typeof options !== 'function') throw new TypeError('options must be an object');
  return options ?? {};
};
const alphabetOf = options => {
  const name = options.alphabet === undefined ? 'base64' : options.alphabet;
  if (name !== 'base64' && name !== 'base64url') throw new TypeError('alphabet must be "base64" or "base64url"');
  return name;
};

const bytesMethods = {
  toHex() {
    requireUint8(this);
    let out = '';
    for (let i = 0; i < this.length; i++) out += (this[i] < 16 ? '0' : '') + this[i].toString(16);
    return out;
  },
  toBase64(options) {
    requireUint8(this);
    const settings = optionsOf(options), name = alphabetOf(settings), omit = !!settings.omitPadding;
    let text = '';
    for (let i = 0; i < this.length; i += 8192) text += String.fromCharCode.apply(null, this.subarray(i, i + 8192));
    text = btoa(text);
    if (name === 'base64url') text = text.replace(/\+/g, '-').replace(/\//g, '_');
    return omit ? text.replace(/=+$/, '') : text;
  },
};
const bytesStatics = {
  /* Decoder after the proposal: ASCII whitespace is skipped, errors are SyntaxErrors, three last-chunk modes. */
  fromBase64(string, options) {
    if (typeof string !== 'string') throw new TypeError('input must be a string');
    const settings = optionsOf(options), table = ALPHABETS[alphabetOf(settings)];
    const mode = settings.lastChunkHandling === undefined ? 'loose' : settings.lastChunkHandling;
    if (mode !== 'loose' && mode !== 'strict'
      && mode !== 'stop-before-partial') throw new TypeError('invalid lastChunkHandling');
    const out = [];
    let chunk = [];
    const flush = (strict) => {   // 2 or 3 sextets of a last chunk, 4 sextets of a full one
      if (strict && chunk.length < 4) {
        const spare = chunk.length === 2 ? chunk[1] & 15 : chunk[2] & 3;
        if (spare) throw new SyntaxError('non-zero padding bits');
      }
      out.push((chunk[0] << 2) | (chunk[1] >> 4));
      if (chunk.length > 2) out.push(((chunk[1] & 15) << 4) | (chunk[2] >> 2));
      if (chunk.length > 3) out.push(((chunk[2] & 3) << 6) | chunk[3]);
      chunk = [];
    };
    const blank = c => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
    for (let i = 0; i < string.length; i++) {
      const c = string[i];
      if (blank(c)) continue;
      if (c === '=') {
        if (chunk.length < 2) throw new SyntaxError('misplaced padding');
        let next = i + 1;
        while (next < string.length && blank(string[next])) next++;
        if (chunk.length === 2) {
          if (next === string.length) {
            if (mode === 'stop-before-partial') return Uint8Array.from(out);
            throw new SyntaxError('incomplete padding');
          }
          if (string[next] !== '=') throw new SyntaxError('incomplete padding');
          next++;
          while (next < string.length && blank(string[next])) next++;
        }
        if (next < string.length) throw new SyntaxError('data after padding');
        flush(mode === 'strict');
        return Uint8Array.from(out);
      }
      const value = table.indexOf(c);
      if (value < 0) throw new SyntaxError('invalid character');
      chunk.push(value);
      if (chunk.length === 4) flush(false);
    }
    if (chunk.length) {
      if (mode === 'stop-before-partial') return Uint8Array.from(out);
      if (mode === 'strict' || chunk.length === 1) throw new SyntaxError('incomplete last chunk');
      flush(false);
    }
    return Uint8Array.from(out);
  },
};
const promiseStatics = {
  try(callback, ...args) {
    if ((typeof this !== 'object' && typeof this !== 'function')
      || this === null) throw new TypeError('Promise.try called on a non-object');
    return new this(resolve => resolve(callback(...args)));   // a throw inside the executor rejects the promise
  },
};
const urlStatics = {
  parse(url, base) {
    const text = `${url}`, baseText = base === undefined ? undefined : `${base}`;
    try { return new URL(text, baseText); } catch { return null; }
  },
};
const responseMethods = {
  bytes() { return responseBuffer.call(this).then(buffer => new Uint8Array(buffer)); },
};

/* Exact sum as one big integer in units of 2^-1074, then a single correct rounding (ties to even). */
function exactSum(values) {
  let total = 0n, onlyNegativeZero = true;
  for (const value of values) {
    if (!Object.is(value, -0)) onlyNegativeZero = false;
    bits.setFloat64(0, value);
    const raw = bits.getBigUint64(0), exponent = Number((raw >> 52n) & 0x7ffn), fraction = raw & 0xfffffffffffffn;
    const scaled = (exponent === 0 ? fraction : fraction | 0x10000000000000n) << BigInt(Math.max(exponent, 1) - 1);
    total += raw >> 63n ? -scaled : scaled;
  }
  if (total === 0n) return onlyNegativeZero ? -0 : 0;
  const negative = total < 0n, size = (negative ? -total : total).toString(2).length;
  let magnitude = negative ? -total : total;
  if (size <= 53) return (negative ? -1 : 1) * Number(magnitude) * Number.MIN_VALUE;
  const shift = BigInt(size - 53), rest = magnitude & ((1n << shift) - 1n), half = 1n << (shift - 1n);
  magnitude >>= shift;
  if (rest > half || (rest === half && (magnitude & 1n))) magnitude++;
  const scale = Number(shift) - 1074;   // 2^scale is exact in a double, and a product that is too big becomes Infinity
  const result = scale > 970 ? Number(magnitude) * 2 ** 970 * 2 ** (scale - 970) : Number(magnitude) * 2 ** scale;
  return negative ? -result : result;
}

export const mapGetOrInsert = methods.getOrInsert;
export const mapGetOrInsertComputed = methods.getOrInsertComputed;
export const weakMapGetOrInsert = weakMethods.getOrInsert;
export const weakMapGetOrInsertComputed = weakMethods.getOrInsertComputed;
export const sumPrecise = mathMethods.sumPrecise;
export const uint8ToHex = bytesMethods.toHex;
export const uint8ToBase64 = bytesMethods.toBase64;
export const uint8FromBase64 = bytesStatics.fromBase64;
export const promiseTry = promiseStatics.try;
export const urlParse = urlStatics.parse;
export const responseBytes = responseMethods.bytes;

function define(target, name, value) {
  if (typeof target[name] === 'function') return false;
  Object.defineProperty(target, name, {value, writable: true, enumerable: false, configurable: true});
  return true;
}
export function installPdfPolyfills() {
  return {
    mapGetOrInsert: define(Map.prototype, 'getOrInsert', methods.getOrInsert),
    mapGetOrInsertComputed: define(Map.prototype, 'getOrInsertComputed', methods.getOrInsertComputed),
    weakMapGetOrInsert: define(WeakMap.prototype, 'getOrInsert', weakMethods.getOrInsert),
    weakMapGetOrInsertComputed: define(WeakMap.prototype, 'getOrInsertComputed', weakMethods.getOrInsertComputed),
    sumPrecise: define(Math, 'sumPrecise', mathMethods.sumPrecise),
    promiseTry: define(Promise, 'try', promiseStatics.try),
    urlParse: define(URL, 'parse', urlStatics.parse),
    uint8ToHex: define(Uint8Array.prototype, 'toHex', bytesMethods.toHex),
    uint8ToBase64: define(Uint8Array.prototype, 'toBase64', bytesMethods.toBase64),
    uint8FromBase64: define(Uint8Array, 'fromBase64', bytesStatics.fromBase64),
    responseBytes: define(Response.prototype, 'bytes', responseMethods.bytes),
  };
}
installPdfPolyfills();
