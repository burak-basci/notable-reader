/* beNotable! Reader · voice names and notes in the UI language (catalog keys model_note_*, model_name_*) · own code MIT. */
const cap = word => word.charAt(0).toLocaleUpperCase() + word.slice(1);
const say = (locales, language, key, params = {}) => {
  const table = locales?.messages || {}, text = table[language]?.[key] ?? table.en?.[key] ?? table.de?.[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
};
/* "Thorsten · Deutsch (kompakt)" -> "Thorsten · German (compact)". Technical suffixes (Kokoro FP32, Kitten nano) stay as they are. */
/* "af (Standardmischung)" -> "af (default mix)". */
export function voiceName(locales, language, name) {
  return String(name)
    .replace(/ · (Deutsch|Englisch)/, (_, word) => ' · ' + cap(say(locales, language, word === 'Deutsch' ? 'model_lang_de' : 'model_lang_en')))
    .replace(/\bsehr klein\b/, say(locales, language, 'model_name_tiny'))
    .replace(/\bkompakt\b/, say(locales, language, 'model_name_compact'))
    .replace(/Standardmischung/, say(locales, language, 'model_name_mix'));
}
export const voiceNote = (locales, language, kind, params) => say(locales, language, 'model_note_' + kind, params);
export const tierLabel = (locales, language, tier) => say(locales, language, 'model_tier_' + tier);
export const uiText = (locales, language, key, params) => say(locales, language, key, params);
