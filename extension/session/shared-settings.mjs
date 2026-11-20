import {installReaderScrollbars} from '../scrollbars.mjs';
import {createSpeechControls} from './speech-controls.mjs';
import {createVoicePicker} from '../voice-picker.mjs';
// Shared settings styles stay inline for content-script CSP and serializable consumers.
export const SHARED_SETTINGS_CSS=`
.settings-panel{box-sizing:border-box;color:var(--reader-ink);font:12px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:normal;overflow-wrap:anywhere;scrollbar-width:thin;cursor:default;pointer-events:auto}
.settings-panel *{box-sizing:border-box}
.settings-panel [hidden]{display:none!important}
:where(.settings-panel) svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;flex:none}
:where(.settings-panel) button,:where(.settings-panel) select{font:inherit;color:inherit;background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:7px;min-height:30px;padding:4px 8px;cursor:pointer}
:where(.settings-panel) button:hover,:where(.settings-panel) select:hover{border-color:var(--reader-muted)}
:where(.settings-panel) button:focus-visible,:where(.settings-panel) select:focus-visible,.settings-panel input:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}
:where(.settings-panel) button:disabled,:where(.settings-panel) select:disabled{opacity:.5;cursor:default}
:where(.settings-panel) label{display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer;font-size:11px}
:where(.settings-panel) input{accent-color:var(--reader-accent);margin:0}
:where(.settings-panel) input[type=checkbox]{width:12px;height:12px}
.settings-panel .settings-note{font-size:10px;color:var(--reader-muted);margin:10px 0;line-height:1.5}
.settings-panel label{justify-content:space-between;margin:13px 0}
.settings-panel h2{font-size:12px;font-weight:600;margin:0 0 12px}
.settings-panel .reader-select-trigger{width:100%}

.settingsToggle{flex:none;display:flex;align-items:center;justify-content:center;width:26px;min-height:26px;padding:0;border-color:transparent;background:transparent;color:var(--reader-muted);}
.settingsToggle[aria-expanded=true]{color:var(--reader-accent);border-color:var(--reader-line);}

    .settings-panel{position:absolute;left:0;right:0;top:100%;margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;overscroll-behavior:contain;max-height:min(280px,calc(100vh - 110px));background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:11px;padding:14px 16px;box-shadow:var(--reader-shadow);font-size:12px;line-height:1.5;color:var(--reader-ink);scrollbar-width:thin;cursor:default;z-index:3;}
.bar[data-expand-above] .settings-panel{top:auto;bottom:100%;margin-top:0;margin-bottom:8px;}
.settings-panel{display:none;left:auto;width:min(300px,100%);white-space:normal;}
.settings-panel[data-open]{display:block;}
.settings-panel h2{font-size:12px;font-weight:600;margin:0 0 12px;}
.settings-panel label{justify-content:space-between;margin:13px 0;}
.settings-note{font-size:10px;color:var(--reader-muted);margin:10px 0;line-height:1.5;}
.settings-actions{display:grid;gap:6px;border-top:1px solid var(--reader-line);padding-top:10px;margin-top:12px;}
.settings-actions button{display:flex;align-items:center;gap:9px;white-space:normal;text-align:left;font-size:11px;min-height:33px;}
.settings-actions svg{width:15px;height:15px;}
.kb-settings h3{font-size:11px;margin:12px 0 6px}
.voice-btn>.chevron svg{width:12px;height:12px;}
.voice-btn[aria-expanded=true]>.chevron svg{transform:rotate(180deg);}
.voice-btn[data-static]>.chevron{display:none;}
.select-shell{display:flex;align-items:center;gap:6px;border:1px solid var(--reader-line);border-radius:7px;padding:4px 8px;min-height:30px;background:var(--reader-paper);}
.speed-control .chevron svg,.select-shell .chevron svg{width:12px;height:12px;}
.select-shell:hover{border-color:var(--reader-muted);}
.select-shell:focus-within{outline:2px solid var(--reader-accent);outline-offset:2px;}
.select-shell select:focus-visible{outline:0;}
.select-shell select{appearance:none;flex:1;min-width:0;width:100%;border:0;min-height:20px;padding:0;background:transparent;}
.ui-language-row{align-items:flex-start;flex-direction:column;gap:6px;}
.ui-language-row .select-shell{width:100%;}
.settings-panel{overflow:hidden;padding:0;max-height:min(500px,calc(100vh - 140px));width:min(320px,calc(100% - 20px));right:10px;}
.settings-content{padding:14px 16px;max-height:inherit;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;border-radius:inherit;}
.settings-panel label{white-space:normal;}
.settings-panel .settings-actions{padding-bottom:0;}
:where(.settings-panel) select{max-width:100%;}
.settings-note{overflow-wrap:anywhere;}
.export-settings{border-top:1px solid var(--reader-line);margin-top:12px;padding-top:12px;}
.export-settings h3{font-size:11px;margin:0 0 6px;}
.chevron{display:flex;align-items:center;justify-content:center;line-height:0;flex:none;}
.reader-select-trigger{align-items:center;}
.reader-select-trigger>svg{width:17px;height:17px;}
.chevron svg{width:12px;height:12px;transform-origin:center;}
.settings-actions button{justify-content:flex-start;}
.reader-option{align-items:center;}
.reader-option-check{display:flex;align-items:center;justify-content:center;line-height:1;flex:none;width:14px;}
.select-shell{border:0;padding:0;background:transparent;}
.speed-control>.chevron,.select-shell>.chevron{display:none;}
.reader-select-trigger{width:100%;min-width:0;min-height:30px;gap:6px;padding:4px 8px;border:1px solid var(--reader-line);border-radius:7px;background:var(--reader-paper);color:var(--reader-ink);font:inherit;text-align:left;}
.reader-select-trigger[aria-expanded=true]{border-color:var(--reader-accent);}
.reader-select-trigger[aria-expanded=true]>.chevron svg{transform:rotate(180deg);}
.reader-select-menu{display:none;position:fixed;z-index:8;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);overflow:hidden;pointer-events:auto;}
.reader-select-menu[data-open]{display:block;}
.reader-options{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable;padding:6px;border-radius:inherit;}
.reader-option{display:flex;gap:8px;justify-content:flex-start;text-align:left;width:100%;min-height:32px;padding:6px 8px;line-height:1.4;border:1px solid transparent;border-radius:7px;background:transparent;}
/* List rows of every reader select (bar, Settings, chapter list): hover / keyboard focus = tinted row with a 2px accent ring (>= 3:1 against the next row),
   the chosen row = accent fill with the on-accent ink (>= 4.5:1). One set of tokens, derived from the active palette (custom overlay colors included).
   Text field borders mix ink and paper (>= 3:1 with every preset): the popup's own muted tone differs from the player's in dark, ink and paper do not. */
:host{--reader-field-line:color-mix(in srgb,var(--reader-ink) 60%,var(--reader-paper));--reader-option-hover:color-mix(in srgb,var(--reader-accent) 12%,var(--reader-paper));--reader-option-ring:var(--reader-accent);--reader-option-current:var(--reader-accent);--reader-option-current-ink:var(--reader-on-accent,#fff)}
.reader-option:hover,.reader-option:focus-visible{background:var(--reader-option-hover);box-shadow:inset 0 0 0 2px var(--reader-option-ring);outline:none;}
.reader-option[aria-selected=true]{background:var(--reader-option-current);color:var(--reader-option-current-ink);font-weight:600;}
.reader-option[aria-selected=true]:hover,.reader-option[aria-selected=true]:focus-visible{background:var(--reader-option-current);box-shadow:inset 0 0 0 2px var(--reader-option-current),inset 0 0 0 4px var(--reader-paper);}
.reader-option-label{min-width:0;overflow-wrap:anywhere;}
.ui-language-row .select-shell{width:100%;}
.download-menu .export-settings{border:0;margin:0;padding:0;}
.speed-menu .reader-option{font-size:14px;min-height:34px;padding:6px 8px;gap:6px}
.speed-menu .reader-option-check{width:12px}
.speed-menu .reader-option-label,.chapter-menu .reader-option-label{white-space:nowrap}
.chapter-head{padding:8px 8px 2px}
.chapter-search{display:block;width:100%;min-height:30px;margin:0;padding:4px 8px;border:1px solid var(--reader-muted);border-radius:7px;background:var(--reader-paper);color:var(--reader-ink);font:inherit;font-size:12px}
.chapter-search::placeholder{color:var(--reader-muted);opacity:1}
.chapter-search:focus-visible{outline:2px solid var(--reader-accent);outline-offset:1px}
.chapter-empty{margin:0;padding:6px 14px 12px;font-size:12px;color:var(--reader-muted)}
.chapter-list .reader-option{position:relative;min-height:34px;padding-top:6px;padding-bottom:6px;font-size:13px;line-height:1.4;align-items:center;gap:6px}
.chapter-list .reader-option[hidden],.chapter-list [hidden]{display:none!important}
.chapter-list .reader-option-label{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal}
.chapter-list .reader-option-check{width:12px;font-size:11px;color:var(--reader-muted)}
.chapter-list .reader-option[data-done]:not([aria-selected=true]) .reader-option-label{color:var(--reader-muted)}
.chapter-meta{flex:none;padding-left:8px;font-size:11px;font-weight:400;color:var(--reader-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.chapter-list .reader-option[aria-selected=true] :is(.chapter-meta,.reader-option-check){color:inherit}
.reader-guide{position:absolute;top:-1px;bottom:-1px;width:0;border-left:1px solid color-mix(in srgb,var(--reader-muted) 55%,transparent);pointer-events:none}
.bar>.reader-controls>.controls-right>.speed-control>.reader-select-trigger{width:100%;min-width:0}
.follow-position-row{display:grid!important;grid-template-columns:1fr!important;gap:5px!important;white-space:normal!important}
.follow-position-value{display:flex;align-items:center;gap:8px}
.follow-position-value input{min-width:0;flex:1}
.follow-position-value output{min-width:42px;text-align:right}
.follow-position-row small{font-size:10px;color:var(--reader-muted);line-height:1.4}
.settings-content>h2{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.settings-section{display:flex;flex-direction:column;gap:10px;min-width:0}
.settings-section-title{display:flex;align-items:center;gap:8px;margin:6px 0 0;font-size:11px;font-weight:700;line-height:1.3;letter-spacing:.04em;text-transform:uppercase;color:var(--reader-ink)}
.settings-section-title::after{content:"";flex:1 1 auto;min-width:12px;border-top:1px solid var(--reader-line)}
.settings-block{display:flex;flex-direction:column;gap:10px;min-width:0;margin:0;padding:10px 12px 12px;border:1px solid var(--reader-line);border-radius:10px}
.settings-block>legend{font-size:11px;font-weight:700;padding:0 5px;color:var(--reader-ink)}
.block-sub{margin:0;font-size:10px;line-height:1.45;color:var(--reader-muted);font-weight:400}
.settings-block>label,.settings-block .appearance-row,.settings-block .block-cell>.appearance-row{margin:0!important}
.settings-block>.settings-note{margin:0;font-size:10px}
.settings-block>.settings-actions{margin:0;padding-top:0;border-top:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
.block-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--reader-line);border-bottom:1px solid var(--reader-line)}
.block-cell{min-width:0;padding:10px 10px;display:flex;flex-direction:column;gap:8px}
.block-cell:nth-child(odd){padding-left:0;border-right:1px solid var(--reader-line)}
.block-cell:nth-child(even){padding-right:0}
.block-cell:nth-child(-n+2){border-bottom:1px solid var(--reader-line)}
.cell-title{font-size:11px;font-weight:700;color:var(--reader-ink);line-height:1.4}
.block-cell>.block-sub{margin:-4px 0 0}
.settings-block .appearance-row>span:first-child{flex:1 1 70px}
.settings-panel button.switch-input{position:relative;display:inline-block;flex:none;width:36px;height:20px;min-width:36px;min-height:0;padding:0;margin:0;border:1px solid var(--reader-line);border-radius:10px;background:var(--reader-soft);cursor:pointer;transition:background-color .15s,border-color .15s}
.switch-input::before{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--reader-muted);transition:transform .15s,background-color .15s}
.settings-panel button.switch-input[aria-checked=true]{background:var(--reader-accent);border-color:var(--reader-accent)}
.switch-input[aria-checked=true]::before{transform:translateX(16px);background:var(--reader-on,#fff)}
.switch-input:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}
/* The 36x20 switch keeps its approved look; an invisible margin makes the pointer target at least 24px high. */
.settings-panel button.switch-input::after,.kb-switch::after{content:"";position:absolute;inset:-3px 0}
.switch-input:disabled{opacity:.55;cursor:default}
.appearance-export-group,.appearance-mode-group{display:contents}
@media(prefers-reduced-motion:reduce){.switch-input,.switch-input::before{transition:none}
}
.appearance-settings{border-top:1px solid var(--reader-line);margin-top:12px;padding-top:12px}
.appearance-settings summary{cursor:pointer;font-size:11px;line-height:1.5;padding:4px 0;color:var(--reader-ink)}
.appearance-group{border-top:1px solid var(--reader-line);padding-top:5px;margin-top:8px}
.appearance-content{padding-top:8px}
.appearance-row{display:flex!important;flex-wrap:wrap;align-items:center;gap:6px;margin:10px 0!important}
.appearance-row>span:first-child{flex:1 1 120px;min-width:0;font-size:11px}
.appearance-row .select-shell{width:100%;flex-basis:100%}
.appearance-row input[type=range]{width:100%;flex-basis:100%;height:20px}
.appearance-row input[type=color]{width:44px;height:28px;padding:1px;border:1px solid var(--reader-line);border-radius:5px;background:transparent}
.appearance-row input[type=checkbox]{width:14px;height:14px}
.appearance-row output{font-size:10px;color:var(--reader-muted);font-variant-numeric:tabular-nums}
.appearance-row output:empty{display:none}
.appearance-reset{font-size:11px;margin-top:10px}
.document-export-settings{border-top:1px solid var(--reader-line);margin-top:12px;padding-top:12px}

    .settings-panel{position:fixed!important;inset:auto!important;margin:0!important;width:min(480px,calc(100vw - 24px));max-width:none}
.settings-content{padding:12px;display:flex;flex-direction:column;gap:10px}
.settings-content>h2{margin:0}
.settings-content>label{margin:0!important}
.settings-content>.settings-note{margin:0;font-size:10px}
.settings-content>.settings-actions{margin:0;padding-top:8px;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
.settings-actions .jump{grid-column:1/-1}
.settings-actions button{font-size:10px!important;min-height:30px!important;padding:5px 7px!important}
.settings-actions svg{width:14px;height:14px}
.appearance-settings{margin:0!important;padding-top:8px!important}
.appearance-settings>h3{font-size:11px;margin:0 0 8px}
.appearance-content{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:8px;padding:0!important}
.appearance-mode-group{grid-column:1/-1}
.appearance-group{min-width:0;border:1px solid var(--reader-line)!important;border-radius:7px;padding:7px!important;margin:0!important}
.appearance-group legend{font-size:10px;font-weight:600;padding:0 4px;overflow-wrap:anywhere}
.appearance-group>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.appearance-group[data-settings-group=appearanceImages]>div{grid-template-columns:1fr}
.appearance-group[data-settings-group=appearanceDarkColors]>div{grid-template-columns:repeat(2,minmax(0,1fr));gap:0}
.appearance-group[data-settings-group=appearanceDarkColors]>div>.appearance-row{grid-template-columns:minmax(0,1fr)!important;justify-items:start;gap:5px!important;padding:6px 7px!important}
.appearance-group[data-settings-group=appearanceDarkColors]>div>.appearance-row:nth-child(1){border-right:1px solid var(--reader-line);border-bottom:1px solid var(--reader-line);padding-left:0!important}
.appearance-group[data-settings-group=appearanceDarkColors]>div>.appearance-row:nth-child(2){border-bottom:1px solid var(--reader-line);padding-right:0!important}
.appearance-group[data-settings-group=appearanceDarkColors]>div>.appearance-row:nth-child(3){grid-column:1/-1;grid-template-columns:minmax(0,1fr) auto!important;padding:6px 0 0!important}
.appearance-group[data-settings-group=appearanceLightColors]>div{grid-template-columns:repeat(2,minmax(0,1fr));gap:0}
.appearance-group[data-settings-group=appearanceLightColors]>div>.appearance-row{grid-template-columns:minmax(0,1fr)!important;justify-items:start;gap:5px!important;padding:6px 7px!important}
.appearance-group[data-settings-group=appearanceLightColors]>div>.appearance-row:nth-child(1){border-right:1px solid var(--reader-line);border-bottom:1px solid var(--reader-line);padding-left:0!important}
.appearance-group[data-settings-group=appearanceLightColors]>div>.appearance-row:nth-child(2){border-bottom:1px solid var(--reader-line);padding-right:0!important}
.appearance-group[data-settings-group=appearanceLightColors]>div>.appearance-row:nth-child(3){grid-column:1/-1;grid-template-columns:minmax(0,1fr) auto!important;padding:6px 0 0!important}
.appearance-group:last-of-type{grid-column:1/-1}
.appearance-group .settings-note{grid-column:1/-1;font-size:9px;line-height:1.4;margin:0}
.appearance-row{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:3px!important;margin:0!important;align-items:center!important;min-width:0}
.appearance-row>span:first-child{font-size:10px!important;min-width:0;overflow-wrap:anywhere}
.appearance-row .select-shell,.appearance-row input[type=range]{grid-column:1/-1;min-width:0}
.appearance-row input[type=range]{height:18px!important}
.appearance-row input[type=color]{width:32px!important;height:24px!important}
.appearance-row output{font-size:9px!important;grid-column:2;grid-row:1}
.appearance-reset,.appearance-status{grid-column:1/-1;margin:0!important}
.appearance-reset{justify-self:start;font-size:10px}
.appearance-status{font-size:9px}
.global-settings-fields{min-width:0;margin:0;padding:8px;border:1px solid var(--reader-line);border-radius:7px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.global-settings-fields[hidden]{display:none!important}
.global-settings-fields legend{font-size:10px;font-weight:600;padding:0 4px}
.global-settings-fields label{min-width:0;margin:0!important;font-size:10px;gap:3px}
.global-settings-fields .select-shell{width:100%}
.global-settings-fields .reader-select-trigger{font-size:10px;min-height:28px}
.auto-show-row{white-space:normal}
.auto-show-row[hidden]{display:none!important}
.settings-panel[data-inline]{display:block!important;position:relative!important;inset:auto!important;margin:0!important;width:100%!important;max-height:none!important;border:0;border-top:1px solid var(--reader-line);border-radius:0;box-shadow:none;overflow:visible}
.settings-panel[data-inline] .settings-content{max-height:none!important;overflow:visible}
.bar[data-settings-inline]>.reader-top .settingsToggle{display:none}
.bar[data-settings-inline] .settings-panel{pointer-events:auto}
.settings-panel .export-settings{display:none}
.settings-panel[data-inline] .settings-note{font-size:9px}
.reader-select-menu.speed-pop[data-open]{display:flex}
.settings-section>.section-sub{margin:-6px 0 0}
.download-menu .export-settings{display:flex;flex-direction:column;gap:10px;border:0;margin:0;padding:0}
.download-menu .document-export-settings{border:0;margin:0;padding:0}

.settings-panel .appearance-row input[type=range]{width:100%;max-width:none;min-width:0}
.settings-panel .follow-position-value{width:100%}
.settings-panel .follow-position-value input{width:100%;max-width:none;min-width:0}
.settings-panel .mark-switch{width:100%;min-width:0}
.settings-panel .mark-switch>span{flex:1;min-width:0;overflow-wrap:anywhere}
.settings-panel .mark-switch>.switch-input{flex:none;margin-inline-start:auto}
.settings-panel input[type=checkbox]{flex:none;margin:0}
.settings-panel :is(.ov-reset,.appearance-reset){padding:6px 12px;min-height:32px;margin-block-start:8px}

.kb-switch-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.kb-switch{position:relative;display:inline-block;flex:none;width:36px;height:20px;min-width:36px;min-height:0;padding:0;margin:0;border:1px solid var(--reader-line);border-radius:10px;background:var(--reader-soft);cursor:pointer}
.kb-switch::before{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--reader-muted);transition:transform .15s,background-color .15s}
.kb-switch[aria-checked=true]{background:var(--reader-accent);border-color:var(--reader-accent)}
.kb-switch[aria-checked=true]::before{transform:translateX(16px);background:var(--reader-on-accent,#fff)}
.kb-switch:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}
.kb-help-open{align-self:flex-start;font-size:11px}
.reader-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.25;}
.speed-trigger .reader-value{flex:none;text-align:left;overflow:visible;}
.bar>.reader-controls .speed-trigger .reader-value{flex:1 1 auto;min-width:0}
.speed-trigger .reader-value,.chapter-trigger .reader-value{position:relative;top:1px}
.settings-panel .reader-select-trigger{display:flex}
.settings-panel .kb-help-open{align-self:flex-start}
.settings-block[data-settings-block=shortcuts]:disabled{opacity:.45}
.settings-block[data-settings-block=shortcuts]:disabled :is(.kb-edit-btn,.backup-btn){opacity:1;cursor:default}
.voice{font:12px/1.4 ui-sans-serif,system-ui,sans-serif}
.voice-btn{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;min-width:0;padding:4px 8px;min-height:30px;border:1px solid var(--reader-line);border-radius:7px;background:var(--reader-paper);color:var(--reader-ink);font:inherit;cursor:pointer}

/* Reading rule overview: one open editor, using the original settings switches. */
.settings-panel .reading-rules{display:flex;flex-direction:column;gap:6px;min-width:0}
.settings-panel .reading-rule{min-width:0;border:1px solid var(--reader-line);border-radius:7px;overflow:hidden}
.settings-panel .reading-rule[data-invalid]{border-color:var(--reader-accent)}
.settings-panel .reading-rule-head{display:flex;align-items:center;gap:6px;padding:4px}
.settings-panel .reading-rule-summary{display:flex;flex:1;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;min-width:0;min-height:38px;border-color:transparent;text-align:left;background:transparent;padding:4px 6px}
.settings-panel .reading-rule-summary-text{max-width:100%;font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.settings-panel .reading-rule-mode{max-width:100%;font-size:10px;color:var(--reader-muted);white-space:normal;overflow-wrap:anywhere}
.settings-panel .reading-rule-remove{flex:none;font-size:10px;min-height:30px}
.settings-panel .reading-rule-editor{display:flex;flex-direction:column;gap:10px;padding:10px;border-top:1px solid var(--reader-line)}
.settings-panel .reading-rule-field{display:flex;flex-direction:column;align-items:stretch;gap:5px;margin:0;cursor:default}
.settings-panel .reading-rule-field>span{align-self:flex-start}
.settings-panel .reading-rule-field input,.settings-panel .reading-timer-row input{width:100%;min-width:0;min-height:30px;padding:5px 8px;border:1px solid var(--reader-field-line);border-radius:7px;background:var(--reader-paper);color:var(--reader-ink);font:inherit}
.settings-panel .reading-rule-toggle,.settings-panel .reading-filter-row,.settings-panel .reading-timer-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;min-height:28px}
.settings-panel .reading-rule-toggle>span,.settings-panel .reading-filter-row>span{flex:1;min-width:0;overflow-wrap:anywhere}
.settings-panel .reading-timer-row input{width:76px;flex:none}
.settings-panel .reading-tools-actions{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.settings-panel .reading-tools-actions button{min-height:30px;max-width:100%;white-space:normal;text-align:left}
.settings-panel .reading-rule-count,.settings-panel .reading-tools-status,.settings-panel .reading-timer-status{margin:0;font-size:10px;line-height:1.45;overflow-wrap:anywhere}
.settings-panel .reading-rule-count,.settings-panel .reading-timer-status{color:var(--reader-muted);font-variant-numeric:tabular-nums}
.settings-panel .reading-tools-status[data-error]{font-weight:600;color:var(--reader-ink)}

/* Category 1 bar mirror: the bar's own triggers (icon + value + chevron) with room for their icons. */
.settings-speech{display:flex;flex-direction:column;gap:10px;min-width:0}
.ss-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.ss-label{font-size:11px;line-height:1.3;color:var(--reader-ink)}
.ss-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.settings-voice,.settings-speed,.settings-vol,.settings-chapter{display:block;min-width:0;padding:0;font:inherit}
.settings-panel .settings-voice .voice-btn{position:relative;display:flex;align-items:center;justify-content:flex-start;gap:6px;width:100%;max-width:none;min-height:32px;padding:4px 8px}
.settings-panel .settings-voice .voice-btn>.language-icon{display:inline-flex!important;flex:none;align-items:center;justify-content:center;width:17px;height:17px}
.settings-panel .settings-voice .voice-btn>.language-icon svg{width:17px;height:17px}
.settings-panel .settings-voice .voice-btn>small{display:inline-flex!important}
.settings-panel .settings-voice .voice-btn>.chevron{display:flex!important;margin-left:auto}
.settings-panel .settings-voice .voice-btn[data-missing]::after{right:3px}
.settings-voice .voice-menu{display:none;position:fixed;z-index:8;overflow:hidden;padding:0;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);font-size:12px;cursor:default;white-space:normal}
.settings-voice .voice-menu[data-open]{display:block}
.settings-panel .settings-speed .speed-trigger,.settings-panel .settings-vol .vol-btn,.settings-panel .settings-chapter .reader-select-trigger{display:flex;align-items:center;justify-content:flex-start;gap:6px;width:100%;min-width:0;max-width:none;min-height:32px;padding:4px 8px}
.settings-panel .settings-vol .vol-icon{display:inline-flex;flex:none}
.settings-panel .settings-vol .vol-btn>.chevron svg{width:12px;height:12px}
.settings-panel .settings-vol .vol-btn svg,.settings-panel .settings-speed .speed-trigger>svg,.settings-panel .settings-chapter .reader-select-trigger>svg{width:17px;height:17px}
.settings-panel :is(.settings-speed .speed-trigger,.settings-vol .vol-btn,.settings-chapter .reader-select-trigger) .reader-value{flex:1 1 auto;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;top:0}
.settings-panel :is(.settings-speed .speed-trigger,.settings-vol .vol-btn)>.chevron{display:flex!important;margin-left:auto}
/* the dialogs keep the bar's geometry: the panel's generic label rule (flex, 13px margins) must not reach their slider labels */
.settings-panel .settings-pop .fx-label{display:block;margin:0;white-space:normal;cursor:default}
.settings-panel .voice-menu label{margin:0}
.ss-actions{display:grid;gap:6px}
.settings-panel .ss-action{display:flex;align-items:center;justify-content:flex-start;gap:9px;width:100%;min-height:32px;text-align:left;font-size:11px;white-space:normal}
.ss-action-icon{display:inline-flex;flex:none}.ss-action-icon svg{width:16px;height:16px}
.ss-action[data-saved] .ss-action-icon svg{fill:var(--reader-accent);stroke:var(--reader-accent)}

/* Category 1 (round 3): three short groups, two columns, label above control, no paragraphs */
.ss-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 10px;min-width:0}
.ss-grid>label{margin:0!important;min-width:0}
.ss-grid>.ui-language-row{gap:2px}.settings-tabpanel[data-tab-panel=func] :is(.ss-label,.ss-grid>label>span:first-child){line-height:1.25}
.ss-grid>.auto-show-row{align-self:end;display:flex!important;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;min-height:30px;white-space:normal}
.settings-block:is([data-settings-block=reading],[data-settings-block=toolbar],[data-settings-block=explain]){gap:3px;padding:0;border:0;border-radius:0}
.settings-block:is([data-settings-block=reading],[data-settings-block=toolbar],[data-settings-block=explain])>legend{padding:0 6px 0 0;margin:0;font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--reader-ink)}
.settings-tabpanel[data-tab-panel=func]>[data-settings-block]:not([hidden])~[data-settings-block]:not([hidden]){border-top:1px solid var(--reader-line);padding-top:4px}
/* reading row: voice, speed and volume side by side (the voice takes half the width) */
[data-settings-block=reading] .settings-speech{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:5px 10px;align-items:end}
[data-settings-block=reading] .ss-field{gap:2px}
.settings-tabpanel[data-tab-panel=func]>[data-settings-block]{margin:0 0 6px!important}
[data-settings-block=reading] .ss-pair{display:contents}
.settings-block:is([data-settings-block=reading],[data-settings-block=toolbar],[data-settings-block=explain]) .reader-select-trigger{min-height:30px}
.settings-speech{gap:8px}.ss-field{gap:4px}
.settings-panel :is(.settings-voice .voice-btn,.settings-speed .speed-trigger,.settings-vol .vol-btn){min-height:30px!important}
`;

/* Original settings construction and control lifecycle, shared by page/file overlays and the document-independent popup. */
export function mountSharedSettings({shadow,settings,t,icon,locales,formats,getLocale,getFormatPrefs,settingsScope='all',send,appearanceController,onPlayerTheme=()=>{},keyboard=null,makeSwitch,createSelect,listen,disposers=[],onAppearance=null,speech=null}={}) {
 installReaderScrollbars(shadow);
 const style=shadow.ownerDocument.createElement('style');style.dataset.sharedSettings='';style.textContent=SHARED_SETTINGS_CSS;shadow.append(style);
 const $=s=>shadow.querySelector(s);let latest={},appearanceInfo={code:'appearanceOff'},updateExplain=()=>{};
  const content=document.createElement('div');content.className='settings-content';content.append(...settings.childNodes);settings.append(content);
  const localeRow=document.createElement('label');localeRow.className='ui-language-row';localeRow.innerHTML='<span data-i18n="uiLanguage"></span><span class="select-shell"><select class="ui-language"></select><span class="chevron">'+icon('down')+'</span></span>';content.querySelector('h2').after(localeRow);const localeSelect=localeRow.querySelector('select');for(const language of locales.languages)localeSelect.add(new Option(language.label,language.code));
  const localeUi=createSelect(localeSelect,'ui-language','','uiLanguage');
  // No clock-format row any more (elapsed/remaining stay in minutes); the stored timeFormat preference is untouched in the backend.
  const regionalSelects={};
  const regionalOptions=()=>{for(const [field,{select,ui}] of Object.entries(regionalSelects)){const entries=field==='formatLocale'?formats.regions(getLocale(),t('formatAutomatic')):[['auto',t('formatAutomatic')],['12h',t('time12h')],['24h',t('time24h')]],signature=JSON.stringify(entries);if(select.dataset.entries!==signature){select.replaceChildren(...entries.map(([code,label])=>new Option(label,code)));select.dataset.entries=signature;}select.value=getFormatPrefs()[field];ui.render();}};

  const followPositionRow=document.createElement('label');followPositionRow.className='follow-position-row';followPositionRow.innerHTML='<span data-i18n="followPosition"></span><span class="follow-position-value"><input class="follow-position" type="range" min="10" max="90" step="1" value="33"><output aria-live="off">33 %</output></span>';content.querySelector('.settings-note').before(followPositionRow);const followPosition=followPositionRow.querySelector('input'),followPositionOutput=followPositionRow.querySelector('output');
  // Live range sliders: throttled send while dragging (last value guaranteed), no overwrite by snapshots while held, value kept until a matching/newer snapshot.
  const liveRange=(input,output,key)=>{const state={choice:null,held:false,last:0,timer:0};
    const flush=()=>{clearTimeout(state.timer);state.timer=0;if(!state.choice||state.choice.sent===state.choice.value)return;state.choice.sent=state.choice.value;state.choice.sentAt=Date.now();state.choice.version=Number(latest.preferenceVersion)||0;state.last=Date.now();send(key,state.choice.value);};
    const queue=()=>{const wait=80-(Date.now()-state.last);if(wait<=0)flush();else if(!state.timer)state.timer=setTimeout(flush,wait);};
    input.addEventListener('input',()=>{const value=Number(input.value);output.textContent=value+' %';state.choice={...(state.choice||{}),value,sent:state.choice?.sent,version:state.choice?.version??(Number(latest.preferenceVersion)||0),sentAt:state.choice?.sentAt||0};queue();});
    input.addEventListener('change',flush);input.addEventListener('blur',flush);
    input.addEventListener('pointerdown',()=>{state.held=true;});
    const release=()=>{if(!state.held)return;state.held=false;flush();};listen(window,'pointerup',release,true);listen(window,'pointercancel',release,true);
    disposers.push(()=>clearTimeout(state.timer));
    return {state,value:fallback=>state.choice?.value??fallback,settle(message){const c=state.choice;if(!c||state.held||state.timer||c.sent!==c.value)return;if(message[key]===c.value||(Number(message.preferenceVersion)>c.version&&Date.now()-c.sentAt>600)||message.statusKind==='error'&&message.statusKey==='save_failed')state.choice=null;}};};
  const followPositionLive=liveRange(followPosition,followPositionOutput,'followPosition');
  const followModeRow=document.createElement('label');followModeRow.className='ui-language-row follow-mode-row';followModeRow.innerHTML='<span data-i18n="followMode"></span><span class="select-shell"><select class="follow-mode"></select></span>';followPositionRow.before(followModeRow);const followModeSelect=followModeRow.querySelector('select'),followModeUi=createSelect(followModeSelect,'follow-mode','','followMode');let followModeChoice=null;
  followModeSelect.addEventListener('change',()=>{followModeChoice={value:followModeSelect.value,version:Number(latest.preferenceVersion)||0};send('followMode',followModeChoice.value);});
  const followMarginRow=document.createElement('label');followMarginRow.className='follow-position-row follow-margin-row';followMarginRow.innerHTML='<span data-i18n="followMargin"></span><span class="follow-position-value"><input class="follow-margin" type="range" min="5" max="30" step="1" value="10"><output aria-live="off">10 %</output></span>';followPositionRow.after(followMarginRow);const followMargin=followMarginRow.querySelector('input'),followMarginOutput=followMarginRow.querySelector('output');
  const followMarginLive=liveRange(followMargin,followMarginOutput,'followMargin');
  const globalFields=document.createElement('fieldset');globalFields.className='global-settings-fields';globalFields.dataset.settingsGroup='global';globalFields.innerHTML='<legend data-i18n="globalSettings"></legend>';
  content.querySelector('h2').after(globalFields);globalFields.append(localeRow,...[...content.querySelectorAll('.regional-row')]);
  const themeRow=document.createElement('label');themeRow.className='ui-language-row player-theme-row';themeRow.innerHTML='<span data-i18n="playerTheme"></span><span class="select-shell"><select class="player-theme"></select></span>';globalFields.append(themeRow);const themeSelect=themeRow.querySelector('select'),themeUi=createSelect(themeSelect,'player-theme','','playerTheme');let themeChoice=null;
  themeSelect.addEventListener('change',()=>{themeChoice={value:themeSelect.value,version:Number(latest.preferenceVersion)||0};onPlayerTheme(themeChoice.value);send('playerTheme',themeChoice.value);});
  const overlayRow=document.createElement('label');overlayRow.className='ui-language-row overlay-mode-row';overlayRow.innerHTML='<span data-i18n="overlayModeTitle"></span><span class="select-shell"><select class="overlay-mode"></select></span>';globalFields.append(overlayRow);const overlaySelect=overlayRow.querySelector('select'),overlayUi=createSelect(overlaySelect,'overlay-mode','','overlayModeTitle');let overlayChoice=null;
  overlaySelect.addEventListener('change',()=>{overlayChoice={value:overlaySelect.value,version:Number(latest.preferenceVersion)||0};send('overlayMode',overlayChoice.value);});
  const overlayHint=document.createElement('p');overlayHint.className='block-sub';overlayHint.dataset.i18n='overlayModeHint';
  const autoRow=document.createElement('label');autoRow.className='auto-show-row';autoRow.innerHTML='<span data-i18n="extAutoShow"></span><button type="button" class="auto-show"></button>';globalFields.append(autoRow);const autoShow=makeSwitch(autoRow.querySelector('button'));let autoChoice=null;autoShow.addEventListener('change',()=>{autoChoice={value:autoShow.checked,version:Number(latest.preferenceVersion)||0};send('autoShow',autoChoice.value);});
  const updateGlobals=message=>{if(overlayChoice&&(message.overlayMode===overlayChoice.value||Number(message.preferenceVersion)>overlayChoice.version||message.statusKind==='error'&&message.statusKey==='save_failed'))overlayChoice=null;const modeEntries=[['light',t('overlayModeLight')],['expert',t('overlayModeExpert')]],modeSignature=JSON.stringify(modeEntries);if(overlaySelect.dataset.entries!==modeSignature){overlaySelect.replaceChildren(...modeEntries.map(([value,label])=>new Option(label,value)));overlaySelect.dataset.entries=modeSignature;}overlaySelect.value=overlayChoice?.value||(message.overlayMode==='light'?'light':'expert');overlayUi.render();overlaySelect.setAttribute('aria-label',t('overlayModeTitle'));const settled=(choice,key)=>choice&&(message[key]===choice.value||Number(message.preferenceVersion)>choice.version||message.statusKind==='error'&&message.statusKey==='save_failed');if(settled(followModeChoice,'followMode'))followModeChoice=null;followMarginLive.settle(message);{const entries=[['paragraph',t('followModeParagraph')],['section',t('followModeSection')],['line',t('followModeLine')]],signature=JSON.stringify(entries);if(followModeSelect.dataset.entries!==signature){followModeSelect.replaceChildren(...entries.map(([value,label])=>new Option(label,value)));followModeSelect.dataset.entries=signature;}followModeSelect.value=followModeChoice?.value||(['paragraph','section','line'].includes(message.followMode)?message.followMode:'paragraph');followModeUi.render();const margin=followMarginLive.value(Number.isFinite(message.followMargin)?message.followMargin:10);if(!followMarginLive.state.held)followMargin.value=String(margin);followMarginOutput.textContent=formats.number(margin,getFormatPrefs())+' %';followMargin.setAttribute('aria-label',t('followMargin'));followMargin.setAttribute('aria-valuetext',margin+' %');}followPositionLive.settle(message);const height=followPositionLive.value(message.followPosition??33);if(!followPositionLive.state.held)followPosition.value=String(height);followPositionOutput.textContent=formats.number(height,getFormatPrefs())+' %';followPosition.setAttribute('aria-label',t('followPosition'));followPosition.setAttribute('aria-valuetext',height+' %');for(const [choice,key]of [[themeChoice,'playerTheme'],[autoChoice,'autoShow']])if(choice&&(message[key]===choice.value||Number(message.preferenceVersion)>choice.version||message.statusKind==='error'&&message.statusKey==='save_failed')){if(key==='playerTheme')themeChoice=null;else autoChoice=null;}const wanted=themeChoice?.value||message.playerTheme||'system';onPlayerTheme(wanted);const entries=[['system',t('playerThemeSystem')],['light',t('playerThemeLight')],['dark',t('playerThemeDark')]],signature=JSON.stringify(entries);if(themeSelect.dataset.entries!==signature){themeSelect.replaceChildren(...entries.map(([value,label])=>new Option(label,value)));themeSelect.dataset.entries=signature;}themeSelect.value=wanted;themeUi.render();autoShow.checked=autoChoice?.value??message.autoShow===true;};
  globalFields.hidden=settingsScope==='document';

  const appearanceSection=document.createElement('section');appearanceSection.className='appearance-settings';appearanceSection.innerHTML='<h3 data-i18n="appearanceTitle"></h3><div class="appearance-content"></div>';content.querySelector('.settings-actions').before(appearanceSection);const appearanceContent=appearanceSection.querySelector('.appearance-content'),appearanceControls=new Map(),appearancePending=new Map();
  const appearanceGroup=(key)=>{const group=document.createElement('fieldset');group.className='appearance-group';group.dataset.settingsGroup=key;group.innerHTML='<legend data-i18n="'+key+'"></legend><div></div>';appearanceContent.append(group);return group.lastElementChild;};
  const appearanceModeGroup=document.createElement('div');appearanceModeGroup.className='appearance-mode-group';appearanceContent.append(appearanceModeGroup);
  const exportGroup=document.createElement('div');exportGroup.className='appearance-export-group';appearanceContent.append(exportGroup);const groups={export:exportGroup,mode:appearanceModeGroup,tone:appearanceGroup('appearanceTone'),images:appearanceGroup('appearanceImages'),dark:appearanceGroup('appearanceDarkColors'),light:appearanceGroup('appearanceLightColors'),type:appearanceGroup('appearanceTypography')};
  const appearanceFields=[['mode','appearanceMode','select','mode',['off','appearanceOff','dark','appearanceDark','light','appearanceLight','auto','appearanceAuto']],['brightness','appearanceBrightness','range','tone',[50,150,1]],['contrast','appearanceContrast','range','tone',[50,150,1]],['sepia','appearanceSepia','range','tone',[0,100,1]],['grayscale','appearanceGrayscale','range','tone',[0,100,1]],['background','appearanceBackground','color','dark'],['text','appearanceText','color','dark'],['link','appearanceLink','color','dark'],['lightBackground','appearanceBackground','color','light'],['lightText','appearanceText','color','light'],['lightLink','appearanceLink','color','light'],['imageMode','appearanceImageMode','select','images',['preserve','appearanceImagePreserve','dim','appearanceImageDim','invert','appearanceImageInvert','smart','appearanceImageSmart']],['imageBrightness','appearanceImageBrightness','range','images',[25,150,1]],['fontFamily','appearanceFontFamily','select','type',['serif','appearanceFontSerif','sans','appearanceFontSans','readable','appearanceFontReadable','book','appearanceFontBook','modern','appearanceFontModern','classic','appearanceFontClassic','system','appearanceFontSystem','mono','appearanceFontMono']],['fontSize','appearanceFontSize','range','type',[12,32,1]],['lineHeight','appearanceLineHeight','range','type',[1.2,2.4,.1]],['contentWidth','appearanceContentWidth','range','type',[480,1200,20]],['hidePageNumbers','appearanceHidePageNumbers','checkbox','export']];
  const appearanceValue=()=>({...appearanceController?.defaults,...latest.appearance,...Object.fromEntries([...appearancePending].map(([key,choice])=>[key,choice.value]))});
  let appearanceFrame=0;// input: ein Neuzeichnen je Frame; change: sofort und endgueltig
  const appearanceChanged=(key,input,commit)=>{const value=input.getAttribute('role')==='switch'?input.checked:input.type==='color'||input.tagName==='SELECT'&&key!=='pdfDpi'?input.value:Math.round(Number(input.value)*100)/100;appearancePending.set(key,{value,version:Number(latest.preferenceVersion)||0});if(!commit){if(!appearanceFrame)appearanceFrame=requestAnimationFrame(()=>{appearanceFrame=0;appearanceController?.update?.(appearanceValue(),{preview:true});renderAppearance();});return;}if(appearanceFrame){cancelAnimationFrame(appearanceFrame);appearanceFrame=0;}appearanceController?.update?.(appearanceValue());send('appearance',{[key]:value});renderAppearance();};
  for(const [key,label,type,group,values]of appearanceFields){const row=document.createElement('label');row.className='appearance-row';row.innerHTML='<span data-i18n="'+label+'"></span>';const input=document.createElement(type==='select'?'select':type==='checkbox'?'button':'input');input.dataset.appearance=key;input.className='appearance-'+key;if(type==='select'){const wrap=document.createElement('span');wrap.className='select-shell';row.append(wrap);wrap.append(input);const ui=createSelect(input,'appearance-'+key,'',label);appearanceControls.set(key,{input,ui,values});}else{if(type==='checkbox')makeSwitch(input);else input.type=type;if(type==='range'){input.min=values[0];input.max=values[1];input.step=values[2];}row.append(input);const output=document.createElement('output');output.setAttribute('aria-live','off');row.append(output);appearanceControls.set(key,{input,output});if(type==='range'||type==='color')input.addEventListener('input',()=>appearanceChanged(key,input,false));}input.addEventListener('change',()=>appearanceChanged(key,input,true));groups[group].append(row);}
  const appearanceReset=document.createElement('button');appearanceReset.type='button';appearanceReset.className='appearance-reset';appearanceReset.dataset.i18n='appearanceReset';appearanceContent.append(appearanceReset);appearanceReset.addEventListener('click',()=>{if(appearanceController?.defaults){appearancePending.clear();send('appearance',{...appearanceController.defaults});}});const appearanceStatus=document.createElement('p');appearanceStatus.className='appearance-status settings-note';appearanceStatus.setAttribute('role','status');appearanceContent.append(appearanceStatus);
  // Settings hierarchy: sections (one heading with a rule right of it) hold framed blocks (title, subtitle, all their settings inside); elements are only moved, never recreated.
  {const section=(key,title,sub)=>{const node=document.createElement('section');node.className='settings-section';node.dataset.settingsSection=key;node.innerHTML='<h3 class="settings-section-title" data-i18n="'+title+'"></h3>'+(sub?'<p class="block-sub section-sub" data-i18n="'+sub+'"></p>':'');return node;};
  const block=(key,title,sub,...rows)=>{const node=document.createElement('fieldset');node.className='settings-block';node.dataset.settingsBlock=key;node.innerHTML='<legend data-i18n="'+title+'"></legend>'+(sub?'<p class="block-sub" data-i18n="'+sub+'"></p>':'');node.append(...rows);return node;};
  const cell=(key,title,sub,source)=>{const node=document.createElement('div');node.className='block-cell';node.dataset.settingsCell=key;node.setAttribute('role','group');node.setAttribute('aria-labelledby','cell-'+key);node.innerHTML='<strong class="cell-title" id="cell-'+key+'" data-i18n="'+title+'"></strong><p class="block-sub" data-i18n="'+sub+'"></p>';node.append(...source.children);return node;};
  const clickRow=content.querySelector('.click-seek,.clickseek').closest('label'),mainNote=content.querySelector(':scope>.settings-note'),actions=content.querySelector(':scope>.settings-actions');mainNote.classList.add('settings-main-note');
  const globalSection=section('global','settingsSectionGlobal'),appearanceGroupSection=section('appearance','settingsSectionAppearance','settingsSectionAppearanceSub'),viewSection=section('view','settingsSectionView');
  /* Category 1, round 3 (owner: "too much"): only settings, in three short groups of 2-4 fields on a two-column grid, no paragraphs (hints are tooltips);
     actions (focus view, bookmark, close, summarize, download, chapters) live on the bar and in its More menu. Reading = voice (the reading language is inside
     the voice picker), speed, volume; Reader bar = view, color mode, interface language, show automatically; Summarize = scope, depth, language, keep marks. */
  const grid2=(...cells)=>{const node=document.createElement('div');node.className='ss-grid';node.append(...cells);return node;};
  overlayRow.dataset.i18nTitle='overlayModeHint';themeRow.dataset.i18nTitle='blockToolbarSub';localeRow.dataset.i18nTitle='blockLanguageSub';overlayHint.remove();
  const explainSelect=(key,label,options)=>{const row=document.createElement('label');row.className='ui-language-row explain-row';row.innerHTML='<span data-i18n="'+label+'"></span><span class="select-shell"><select></select></span>';const select=row.querySelector('select');select.dataset.setting=key;const ui=createSelect(select,key,'',label);let choice=null;select.addEventListener('change',()=>{choice={value:select.value,version:Number(latest.preferenceVersion)||0};send(key,select.value);});return {row,select,ui,options,key,get choice(){return choice;},set choice(v){choice=v;}};};
  const explainFields=[explainSelect('explainScope','explainScopeLabel',()=>[['auto',t('explainScopeAuto')],['page',t('tutor_scope_page')],['here',t('tutor_scope_here')]]),explainSelect('explainDepth','explainDepthLabel',()=>[['short',t('tutor_depth_short')],['long',t('tutor_depth_long')]]),explainSelect('explainLanguage','tutor_language',()=>[['ui',t('explainLanguageUi')],['page',t('explainLanguagePage')],...['de','en','fr','es','it','pt'].map(code=>{let name=code;try{name=new Intl.DisplayNames([code],{type:'language'}).of(code);name=name.charAt(0).toLocaleUpperCase(code)+name.slice(1);}catch{}return [code,name];})])];
  const keepRow=document.createElement('label');keepRow.className='auto-show-row explain-keep-row';keepRow.innerHTML='<span data-i18n="explainKeepMarks"></span><button type="button"></button>';const keepSwitch=makeSwitch(keepRow.querySelector('button'));keepSwitch.dataset.setting='explainKeepMarks';let keepChoice=null;keepSwitch.addEventListener('change',()=>{keepChoice={value:keepSwitch.checked,version:Number(latest.preferenceVersion)||0};send('explainKeepMarks',keepSwitch.checked);});
  updateExplain=message=>{const settled=(choice,key)=>choice&&(message[key]===choice.value||Number(message.preferenceVersion)>choice.version||message.statusKind==='error'&&message.statusKey==='save_failed');const fallback={explainScope:'auto',explainDepth:'short',explainLanguage:'page'};for(const field of explainFields){if(settled(field.choice,field.key))field.choice=null;const entries=field.options(),signature=JSON.stringify(entries);if(field.select.dataset.entries!==signature){field.select.replaceChildren(...entries.map(([value,label])=>new Option(label,value)));field.select.dataset.entries=signature;}const wanted=field.choice?.value??message[field.key]??fallback[field.key];field.select.value=entries.some(([value])=>value===wanted)?wanted:fallback[field.key];field.ui.render();}if(settled(keepChoice,'explainKeepMarks'))keepChoice=null;keepSwitch.checked=keepChoice?.value??message.explainKeepMarks===true;};
  globalSection.append(block('reading','settingsGroupReading',null),block('toolbar','blockToolbarTitle',null,grid2(overlayRow,themeRow,localeRow,autoRow)),block('explain','tutor_title',null,grid2(...explainFields.map(field=>field.row),keepRow)));globalSection.hidden=settingsScope==='document';globalFields.remove();
  const grid=document.createElement('div');grid.className='block-grid';grid.dataset.grid='2x2';grid.append(cell('tone','appearanceTone','appearanceToneSub',groups.tone),cell('images','appearanceImages','appearanceImagesSub',groups.images),cell('dark','appearanceDarkColors','appearanceDarkColorsSub',groups.dark),cell('light','appearanceLightColors','appearanceLightColorsSub',groups.light));
  // Focus group = typography + the page-number switch (moved here from the removed "page numbers and export" block). The status line under the reset button is gone: the selected mode already shows it.
  const typographyBlock=block('typography','appearanceTypography','appearanceFocusHint',...groups.type.children,...groups.export.children);
  appearanceGroupSection.append(block('appearance','blockAppearanceTitle',null,...appearanceModeGroup.children,grid,appearanceReset),typographyBlock);appearanceSection.remove();
  viewSection.append(block('follow','extFollow','blockFollowSub',followModeRow,followPositionRow,followMarginRow));
  if(keyboard)viewSection.append(block('keyboard','kbSettingsTitle','kbSettingsSub',...keyboard.settingsRow()));
  // The former READING section is gone from the UI (those commands live in the bar). The nodes stay in a hidden holder because the bar wiring (restart/stop/selection refs, click-seek switch behind the bar's select-text icon) still addresses them.
  const retired=document.createElement('div');retired.className='retired-controls';retired.hidden=true;retired.setAttribute('aria-hidden','true');retired.append(clickRow,mainNote,actions);content.append(retired);
  content.querySelector('h2').after(globalSection,viewSection,appearanceGroupSection);
  }
  /* Category 1 is the whole bar (owner request 14.11.2026): voice, speed (with the four extra pauses) and volume (with the sound) come from the bar's own
     factories on their own triggers (icon + value + chevron), the chapter row is the bar's chapter list, and focus / bookmark / close mirror the bar's own
     buttons. A popover builds them when it opens and drops them when it closes, so while the dialog is shut the bar's controls are the only ones in the tree;
     an inline panel (file view, popup) keeps them. Without `speech` (callers that predate it) the rows stay empty and hidden. */
  const speechRows=document.createElement('div');speechRows.className='settings-speech';speechRows.dataset.settingsSpeech='';speechRows.hidden=!speech;
  {const row=(key,name,slot)=>'<div class="ss-field" data-speech-row="'+name+'"><span class="ss-label" data-i18n="'+key+'"></span>'+slot+'</div>';
   speechRows.innerHTML=row('languageVoice','voice','<span class="voice settings-voice"></span>')+'<div class="ss-pair">'+row('speed','speed','<span class="settings-speed"></span>')+row('volume','volume','<span class="settings-vol"></span>')+'</div>'+row('chapters','chapter','<span class="settings-chapter"></span>')+'<div class="ss-actions" data-speech-row="actions" hidden></div>';
   speechRows.querySelector('[data-speech-row=chapter]').hidden=true;content.querySelector('[data-settings-block=reading]>legend').after(speechRows);}
  let speechLive=null,speechMessage={},voiceMessage=null;
  const mountSpeech=()=>{
   const controls=createSpeechControls(),G=controls.GLYPHS,glyph=name=>'<svg aria-hidden="true" viewBox="0 0 24 24">'+G[name]+'</svg>',own=[],anchor=speech.anchorPanel||controls.defaultAnchor(document),sendSpeech=speech.send||send,num=v=>formats.number(v,getFormatPrefs(),{maximumFractionDigits:2}),shared=speech.dropdowns||[],closeOthers=speech.closeOtherMenus||(()=>{});
   if(speech.css!==false&&!shadow.querySelector('style[data-speech-css]')){const css=document.createElement('style');css.dataset.speechCss='';css.textContent=controls.RANGE_CSS+controls.FX_CSS;shadow.append(css);}
   const ownListen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);own.push(()=>target.removeEventListener(type,fn,options));};
   const voiceWrap=speechRows.querySelector('.settings-voice');voiceWrap.innerHTML='<button class="voice-btn" type="button" data-static tabindex="-1"><span class="language-icon">'+glyph('language')+'</span><span class="vn"></span><small></small><span class="chevron">'+icon('down')+'</span></button><div class="voice-menu" role="menu"></div>';voiceWrap.querySelector('.vn').textContent=t('voice');
   const voiceUi=createVoicePicker({shadow,root:voiceWrap,idPrefix:speech.idPrefix||'svp',send:sendSpeech,uiText:t,getLocale,listen:ownListen,disposers:own,place:(menu,button)=>anchor(menu,button,{width:500,cap:540,min:120,fit:room=>{menu.style.maxHeight=room+'px';}}),isPlaying:speech.isPlaying||(()=>false),getVolume:speech.getVolume||(()=>({volume:speechMessage.volume??100,muted:speechMessage.muted===true})),registryUrl:speech.registryUrl||'',eloUrl:speech.eloUrl||'',sampleBase:speech.sampleBase||'',onSample:speech.onSample||(()=>{})});
   const speedSelect=document.createElement('select');speedSelect.className='settings-speed-select';speechRows.querySelector('.settings-speed').append(speedSelect);
   const relabel=()=>{const signature=getLocale()+JSON.stringify(getFormatPrefs());if(speedSelect.dataset.signature===signature)return;const value=speedSelect.value||'1.00';speedSelect.replaceChildren(...Array.from({length:71},(_,i)=>{const v=(.5+i*.05).toFixed(2);return new Option(num(Number(v))+'×',v);}));speedSelect.value=value;speedSelect.dataset.signature=signature;};relabel();
   const fx=controls.createFxRows({doc:document,send:sendSpeech,uiText:t,formatNumber:num,idPrefix:'reader-settings-fx-'});let sound=null;
   const speedUi=controls.createSpeedSlider({select:speedSelect,bar:settings,t,formatNumber:num,glyph,icon,anchorPanel:anchor,closeOtherMenus:closeOthers,dropdowns:shared,disposers:own,fxUi:fx,doc:document,id:'reader-settings-speed-options',onOpen:()=>sound?.close(false)});
   speedSelect.addEventListener('change',()=>sendSpeech('speed',Number(speedSelect.value)));
   sound=controls.createSoundControls({wrap:speechRows.querySelector('.settings-vol'),send:sendSpeech,uiText:t,formatNumber:num,icon:null,anchorPanel:anchor,fxUi:fx,doc:document,showValue:true,onOpen:()=>{speedUi.close(false);closeOthers(null);}});
   for(const node of [speedUi.panel,sound.panel])node.classList.add('settings-pop');
   let chapterUi=null,mirror=null;
   if(speech.chapterSelect){mirror=document.createElement('select');mirror.className='settings-chapter-select';speechRows.querySelector('.settings-chapter').append(mirror);chapterUi=createSettingsSelect({shadow,bar:settings,t,icon,anchorPanel:anchor,closeOtherMenus:closeOthers,dropdowns:shared,disposers:own,centerIcons:speech.centerIcons||(()=>{})},mirror,'settings-chapter',speech.chapterIcon||'','chooseChapter',{id:'reader-settings-chapter-options',chapter:true});mirror.addEventListener('change',()=>{const real=speech.chapterSelect;if(real.disabled)return;real.value=mirror.value;real.dispatchEvent(new Event('change',{bubbles:true}));});}
   const actionsRow=speechRows.querySelector('[data-speech-row=actions]'),mirrors=[];
   for(const [key,find,options={}] of speech.actions||[]){const button=document.createElement('button');button.type='button';button.className='ss-action';button.dataset.barAction=key;button.innerHTML='<span class="ss-action-icon"></span><span class="ss-action-label"></span>';button.addEventListener('click',()=>{const real=find();if(!real||real.disabled)return;if(options.closeSettings&&settings.hasAttribute('data-open')){settings.removeAttribute('data-open');shadow.querySelector('.settingsToggle')?.setAttribute('aria-expanded','false');}real.click();setTimeout(syncActions,0);});   /* closeSettings: an action that leads away from the dialog (the guided explanation runs on the page) closes the popover first */actionsRow.append(button);mirrors.push({find,button});}
   return {voiceUi,speedUi,sound,fx,chapterUi,mirror,mirrors,relabel,voiceApplied:null,locale:getLocale(),destroy(){speedUi.close(false);sound.close(false);chapterUi?.destroy();for(const fn of own)fn();const at=shared.indexOf(speedUi);if(at>=0)shared.splice(at,1);voiceWrap.querySelector('.vp-audio')?.pause?.();sound.destroy();fx.dispose();speedUi.panel.remove();for(const node of [voiceWrap,speechRows.querySelector('.settings-speed'),speechRows.querySelector('.settings-chapter'),actionsRow])node.replaceChildren();}};
  };
  /* One bar action mirrored: same glyph, the bar's own label and state (bookmark saved, focus open); a click is a click on the bar's button. */
  const syncActions=()=>{const live=speechLive;if(!live)return;let any=false;for(const {find,button} of live.mirrors){const real=find(),gone=!real||!real.isConnected||real.hidden||!!real.closest('[hidden]');button.hidden=gone;if(gone)continue;any=true;const label=real.getAttribute('aria-label')||real.title||'',glyph=real.querySelector('svg')?.outerHTML||'';if(button.dataset.label!==label){button.dataset.label=label;button.querySelector('.ss-action-label').textContent=label;button.setAttribute('aria-label',label);}if(button.dataset.glyph!==glyph){button.dataset.glyph=glyph;button.querySelector('.ss-action-icon').innerHTML=glyph;}button.disabled=real.disabled;const pressed=real.getAttribute('aria-pressed');if(pressed===null)button.removeAttribute('aria-pressed');else button.setAttribute('aria-pressed',pressed);button.toggleAttribute('data-saved',real.hasAttribute('data-saved'));}speechRows.querySelector('[data-speech-row=actions]').hidden=!any;};
  /* The chapter row copies the bar's chapter select (same values, levels, length/position and done marks); a choice is handed to the bar's select. */
  const syncChapters=()=>{const real=speech?.chapterSelect,row=speechRows.querySelector('[data-speech-row=chapter]');if(!real){row.hidden=true;return;}const usable=[...real.options].some(option=>!option.disabled),sections=[...real.options].some(option=>option.value.startsWith('s:')),label=row.querySelector('.ss-label');row.hidden=!usable;label.dataset.i18n=sections?'sections':'chapters';label.textContent=t(label.dataset.i18n);const live=speechLive;if(!live?.mirror)return;
   const signature=JSON.stringify([...real.options].map(option=>[option.value,option.textContent,option.disabled,option.dataset.level||'',option.dataset.meta||'',option.dataset.done||'']));if(live.mirror.dataset.signature!==signature){live.mirror.replaceChildren(...[...real.options].map(option=>option.cloneNode(true)));live.mirror.dataset.signature=signature;}live.mirror.value=real.value;live.mirror.disabled=real.disabled;live.chapterUi.setLabel(sections?'chooseSection':'chooseChapter');live.chapterUi.render();};
  const applySpeech=()=>{const live=speechLive;if(!live)return;if(live.locale!==getLocale()){live.locale=getLocale();live.voiceUi.refreshLocale();live.sound.refreshLocale();live.fx.refreshLocale();}live.relabel();live.speedUi.update(speechMessage);live.sound.update(speechMessage);if(voiceMessage&&live.voiceApplied!==voiceMessage){live.voiceApplied=voiceMessage;live.voiceUi.update(voiceMessage);}syncChapters();syncActions();};
  const speechLife=()=>{if(!speech)return;const shown=settings.hasAttribute('data-open')||settings.hasAttribute('data-inline');if(shown&&!speechLive){speechLive=mountSpeech();applySpeech();}else if(!shown&&speechLive){const live=speechLive;speechLive=null;live.destroy();}};
  if(speech){const life=new MutationObserver(speechLife);life.observe(settings,{attributes:true,attributeFilter:['data-open','data-inline']});disposers.push(()=>{life.disconnect();speechLive?.destroy();speechLive=null;});queueMicrotask(speechLife);}
  const extraSwitches=[];
  for(const [key,label,block]of [['follow','follow','follow'],['clickSeek','clickSeek','follow'],['focusMotion','focusMotion','follow']]){const row=document.createElement('label');const title=document.createElement('span');title.dataset.i18n=label;const toggle=makeSwitch(document.createElement('button'));toggle.dataset.setting=key;row.append(title,toggle);content.querySelector('[data-settings-block='+block+']').append(row);listen(toggle,'change',()=>send(key,toggle.checked));extraSwitches.push(()=>toggle.checked=key==='focusMotion'?latest[key]===true:latest[key]!==false);}
  localeSelect.dataset.setting='uiLanguage';followModeSelect.dataset.setting='followMode';followPosition.dataset.setting='followPosition';followMargin.dataset.setting='followMargin';
  const renderAppearance=()=>{const value=appearanceValue(),supported=Array.isArray(latest.controls?.appearanceFields)?new Set(latest.controls.appearanceFields.filter(key=>typeof key==='string')):null;for(const [key,record]of appearanceControls){const {input,output,ui,values}=record,available=!supported||supported.has(key),row=input.closest('.appearance-row');row.hidden=!available;if(available)row.style.removeProperty('display');else row.style.setProperty('display','none','important');input.disabled=!available;if(ui){const entries=[];for(let i=0;i<values.length;i+=2)entries.push([String(values[i]),t(values[i+1])]);const signature=JSON.stringify(entries);if(input.dataset.entries!==signature){input.replaceChildren(...entries.map(([value,label])=>new Option(label,value)));input.dataset.entries=signature;}input.value=String(value[key]??values[0]);ui.render();}else{if(input.getAttribute('role')==='switch')input.checked=value[key]===true;else if(shadow.activeElement!==input&&value[key]!==undefined)input.value=String(value[key]);if(output){output.textContent=input.type==='range'?key==='contentWidth'&&Number(input.value)>=1200?t('appearanceContentWidthFull'):formats.number(Number(input.value),getFormatPrefs(),{maximumFractionDigits:1})+(key==='fontSize'||key==='contentWidth'?' px':key==='lineHeight'?'':' %'):'';if(key==='contentWidth')input.setAttribute('aria-valuetext',output.textContent);}}}onAppearance?.();appearanceStatus.textContent=t(appearanceInfo.code||'appearanceOff');shadow.dispatchEvent(new Event('notable-appearance-rendered'));};

 const syncKeyboardEditor=()=>{const off=(keyboard?.bindings?.().enabled??latest.keyboard?.enabled)===false;if(off)keyboard?.cancelRecording?.();for(const group of shadow.querySelectorAll('fieldset[data-settings-block=shortcuts]')){if(group.disabled!==off)group.disabled=off;group.setAttribute('aria-disabled',String(off));}};
 const keyboardEditorObserver=new MutationObserver(syncKeyboardEditor);keyboardEditorObserver.observe(shadow,{childList:true,subtree:true});listen(shadow,'notable-keyboard-state',syncKeyboardEditor);
 const syncLabels=()=>{for(const n of content.querySelectorAll('[data-i18n]')){const text=t(n.dataset.i18n);if(n.textContent!==text)n.textContent=text;}for(const n of content.querySelectorAll('[data-i18n-title]')){const text=t(n.dataset.i18nTitle);if(n.title!==text)n.title=text;}content.querySelector('h2').textContent=t('settings');};
 return {content,localeSelect,localeUi,regionalOptions,appearanceValue,appearancePending,appearanceStatus,renderAppearance,syncLabels,setAppearanceCallback(fn){onAppearance=fn;},speech:()=>speechLive,updateVoice(message){voiceMessage=message;applySpeech();},syncChapters,syncActions,appearanceStatusChanged(info){appearanceInfo=info;appearanceStatus.textContent=t(info.code||'appearanceOff');},update(message){latest=message;speechMessage=message;if(Array.isArray(message?.catalog)&&message.catalog.length)voiceMessage=message;syncKeyboardEditor();syncLabels();regionalOptions();updateGlobals(message);updateExplain(message);applySpeech();for(const sync of extraSwitches)sync();for(const [key,choice]of appearancePending)if(message.appearance?.[key]===choice.value||Number(message.preferenceVersion)>choice.version||message.statusKind==='error'&&message.statusKey==='save_failed')appearancePending.delete(key);appearanceController?.update?.(appearanceValue());renderAppearance();},destroy(){keyboardEditorObserver.disconnect();cancelAnimationFrame(appearanceFrame);const live=speechLive;speechLive=null;live?.destroy();}};
}

export function createSettingsSelect({shadow,bar,t,icon,anchorPanel,closeOtherMenus,dropdowns,disposers,centerIcons},select,name,iconMarkup,labelKey,{id='reader-'+name+'-options',chapter=name==='chapter'}={}){
    const wrapper=select.parentElement;select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const button=document.createElement('button');button.type='button';button.className='reader-select-trigger '+name+'-trigger';button.setAttribute('aria-haspopup',chapter?'dialog':'listbox');button.setAttribute('aria-expanded','false');button.innerHTML=(iconMarkup||'')+'<span class="reader-value"></span><span class="chevron">'+icon('down')+'</span>';wrapper.prepend(button);
    const panel=document.createElement('div');panel.className='reader-select-menu '+name+'-menu'+(chapter?' chapter-list':'');panel.setAttribute('role',chapter?'dialog':'listbox');panel.id=id;button.setAttribute('aria-controls',panel.id);const list=document.createElement('div');list.className='reader-options';
    /* Chapter lists (bar and Settings): the list is the listbox, a filter field heads it from SEARCH_FROM entries on; a row = done mark, title on one line (full title in title/aria-label), length or position. */
    const SEARCH_FROM=12;let head=null,search=null,empty=null,typed='',typedAt=0;
    if(chapter){list.id=id+'-list';list.setAttribute('role','listbox');head=document.createElement('div');head.className='chapter-head';head.hidden=true;search=document.createElement('input');search.type='search';search.className='chapter-search';search.autocomplete='off';search.spellcheck=false;search.setAttribute('aria-controls',list.id);head.append(search);empty=document.createElement('p');empty.className='chapter-empty';empty.hidden=true;panel.append(head,list,empty);}else panel.append(list);
    bar.append(panel);let open=false,optionsSignature=null,natural=0,needMeasure=false;const measure=()=>{const was=panel.style.width;panel.style.width='max-content';natural=Math.ceil(panel.getBoundingClientRect().width)+2;panel.style.width=was;};const menuWidth=(min,max)=>Math.max(min,Math.min(max,natural));
    const items=()=>[...list.querySelectorAll('.reader-option')],shown=()=>items().filter(row=>!row.hidden);
    const fold=value=>String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
    const filter=()=>{if(!search)return;const query=fold(search.value.trim());let hits=0;for(const row of items()){const hit=!query||fold(row.dataset.label).includes(query);row.hidden=!hit;if(hit)hits++;}empty.hidden=hits>0;empty.textContent=hits?'':t('chapterSearchEmpty');if(hits)empty.removeAttribute('role');else empty.setAttribute('role','status');};   // a live region only while it says something: the bar keeps ONE polite region otherwise
    const focusOption=row=>{if(!row)return;row.focus({preventScroll:true});const r=row.getBoundingClientRect(),l=list.getBoundingClientRect();if(r.top<l.top)list.scrollTop+=r.top-l.top;else if(r.bottom>l.bottom)list.scrollTop+=r.bottom-l.bottom;};
    const close=refocus=>{if(!open)return;open=false;panel.removeAttribute('data-open');button.setAttribute('aria-expanded','false');if(refocus)button.focus();};
    const place=()=>{if(!open)return;const r=button.getBoundingClientRect(),room=innerWidth-24;anchorPanel(panel,button,{width:chapter?menuWidth(Math.min(room,Math.max(r.width,300)),Math.min(440,room)):name==='speed'?menuWidth(Math.max(r.width,64),room):Math.max(r.width,220),cap:chapter?380:300,fit:height=>{list.style.maxHeight=(chapter?Math.max(64,height-2-(head.hidden?0:head.offsetHeight)-(empty.hidden?0:empty.offsetHeight)):height-2)+'px';}});};
    const render=()=>{
      const selected=select.selectedOptions[0];button.disabled=select.disabled;button.querySelector('.reader-value').textContent=selected?.textContent||'—';button.title=t(labelKey)+(selected?' · '+selected.textContent:'');button.setAttribute('aria-label',button.title);panel.setAttribute('aria-label',t(labelKey));if(chapter){list.setAttribute('aria-label',t(labelKey));search.placeholder=t(labelKey==='chooseSection'?'sectionSearch':'chapterSearch');search.setAttribute('aria-label',search.placeholder);}
      if(open){
        const options=[...select.options].filter(option=>!(option.disabled&&(option.value===''||option.value==='none')));
        // Playback updates are frequent. Preserve the actual pressed/focused row
        // while values, labels and hierarchy are unchanged; flags are not structure.
        const signature=JSON.stringify(options.map(option=>[option.value,option.textContent,option.dataset.level||'']));
        if(signature!==optionsSignature){
          const focused=shadow.activeElement?.dataset.value,scroll=list.scrollTop;optionsSignature=signature;const nodes=[];
          for(const option of options){
            const row=document.createElement('button');row.type='button';row.className='reader-option';row.tabIndex=-1;row.dataset.value=option.value;row.setAttribute('role','option');const check=document.createElement('span');check.className='reader-option-check';check.setAttribute('aria-hidden','true');const text=document.createElement('span');text.className='reader-option-label';text.textContent=option.textContent;row.append(check,text);row.title=option.textContent;if(chapter){row.dataset.label=option.textContent;const meta=document.createElement('span');meta.className='chapter-meta';meta.setAttribute('aria-hidden','true');row.append(meta);}const level=option.dataset.level?Math.max(1,Math.min(6,Number(option.dataset.level)||1)):0;if(level){row.setAttribute('aria-level',String(level));row.dataset.level=String(level);for(let k=1;k<level;k++){const guide=document.createElement('span');guide.className='reader-guide';guide.setAttribute('aria-hidden','true');guide.style.left=(9+(k-1)*12)+'px';row.append(guide);}row.style.paddingLeft=(6+(level-1)*12)+'px';}
            row.addEventListener('click',()=>{const current=[...select.options].find(item=>item.value===row.dataset.value);if(select.disabled||row.disabled||!current||current.disabled)return;select.value=current.value;close(true);select.dispatchEvent(new Event('change',{bubbles:true}));render();});nodes.push(row);
          }
          list.replaceChildren(...nodes);needMeasure=true;list.scrollTop=scroll;if(chapter){head.hidden=options.length<SEARCH_FROM;filter();}items().find(row=>row.dataset.value===focused)?.focus({preventScroll:true});
        }
        const rows=items();for(let index=0;index<options.length;index++){const row=rows[index],option=options[index],checked=String(option.selected),done=chapter&&option.dataset.done==='1',mark=chapter?(done?'✓':''):option.selected?'✓':'';if(row.getAttribute('aria-selected')!==checked)row.setAttribute('aria-selected',checked);row.disabled=select.disabled||option.disabled;row.setAttribute('aria-disabled',String(row.disabled));const check=row.querySelector('.reader-option-check');if(check.textContent!==mark)check.textContent=mark;
          if(chapter){const meta=option.dataset.meta||'',label=option.textContent+(meta?', '+meta:'')+(done?', '+t('chapterDone'):'');row.toggleAttribute('data-done',done);const cell=row.querySelector('.chapter-meta');if(cell.textContent!==meta)cell.textContent=meta;if(row.getAttribute('aria-label')!==label)row.setAttribute('aria-label',label);}}
        if(needMeasure){needMeasure=false;measure();}place();
      }
    };
    const api={button,panel,render,close,place,setLabel:key=>labelKey=key,destroy(){close(false);document.removeEventListener('pointerdown',outside,true);const at=dropdowns.indexOf(api);if(at>=0)dropdowns.splice(at,1);panel.remove();button.remove();}};dropdowns.push(api);
    const openMenu=()=>{if(button.disabled)return;closeOtherMenus(api);if(!select.closest('.settings-panel')){shadow.querySelector('.settings-panel')?.removeAttribute('data-open');shadow.querySelector('.settingsToggle')?.setAttribute('aria-expanded','false');}open=true;if(search)search.value='';panel.setAttribute('data-open','');button.setAttribute('aria-expanded','true');render();if(search)filter();const selected=items().find(item=>item.getAttribute('aria-selected')==='true')||items()[0];focusOption(selected);place();if(chapter&&selected){const r=selected.getBoundingClientRect(),l=list.getBoundingClientRect();list.scrollTop+=(r.top+r.height/2)-(l.top+list.clientHeight/2);}if(name==='speed'&&selected){const r=selected.getBoundingClientRect(),l=list.getBoundingClientRect();list.scrollTop+=(r.top+r.height/2)-(l.top+list.clientHeight/2);}centerIcons();};
    button.addEventListener('click',event=>{event.stopPropagation();if(open)close(false);else openMenu();});button.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();openMenu();}else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);}});
    search?.addEventListener('input',()=>{filter();list.scrollTop=0;place();});
    /* Keys: arrows / Home / End move through the shown rows, Enter or Space takes the focused row (a button), Escape closes; in a chapter list typing filters (field shown) or jumps to the next title that starts with the typed letters. */
    panel.addEventListener('keydown',event=>{const rows=shown(),index=rows.indexOf(shadow.activeElement),inSearch=!!search&&shadow.activeElement===search;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
      else if(event.key==='Tab')close(true);
      else if(inSearch){event.stopPropagation();if(event.key==='ArrowDown'&&rows.length){event.preventDefault();focusOption(rows[0]);}else if(event.key==='Enter'&&rows.length){event.preventDefault();rows[0].click();}}
      else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(!rows.length)return;if(event.key==='ArrowUp'&&index<=0&&search&&!head.hidden){search.focus();return;}const next=event.key==='Home'?0:event.key==='End'?rows.length-1:event.key==='ArrowDown'?(index+1)%rows.length:(index<=0?rows.length-1:index-1);focusOption(rows[next]);}
      else if(chapter&&event.key.length===1&&event.key!==' '&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopPropagation();
        if(!head.hidden){search.focus();search.value+=event.key;filter();list.scrollTop=0;place();return;}
        const now=Date.now();typed=(now-typedAt>800?'':typed)+fold(event.key);typedAt=now;const from=typed.length===1?index+1:Math.max(0,index),order=[...rows.slice(from),...rows.slice(0,from)];const find=prefix=>order.find(row=>fold(row.dataset.label).startsWith(prefix))||order.find(row=>fold(row.dataset.label).includes(prefix));let hit=find(typed);if(!hit&&typed.length>1){typed=fold(event.key);hit=find(typed);}if(hit)focusOption(hit);}
      else event.stopPropagation();});
    panel.addEventListener('pointerdown',event=>event.stopPropagation());panel.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});const outside=event=>{if(open&&!event.composedPath().includes(panel)&&!event.composedPath().includes(button))close(false);};document.addEventListener('pointerdown',outside,true);disposers.push(()=>document.removeEventListener('pointerdown',outside,true));render();return api;
  }
export const settingsPanelMarkup=icon=>`<div id="reader-settings" class="settings-panel"><h2>Einstellungen</h2><label title="Ausschalten für normale Textauswahl">Klick auf Wort startet hier<button type="button" class="click-seek clickseek switch-input" role="switch" aria-checked="true"></button></label><p class="settings-note">Zum Markieren Klicksprung ausschalten. Bella liest Englisch. Deine Lesestelle und dein Tempo werden gespeichert.</p><div class="settings-actions"><button class="jump" data-command="selection" aria-label="Ab markierter Stelle weiterlesen" title="Text markieren, dann hier klicken">${icon('selection')}Markierte Stelle vorlesen</button><button class="restart" data-command="restart" title="Ab sichtbarer Textstelle neu starten" aria-label="Ab sichtbarer Textstelle neu starten">${icon('restart')}Ab sichtbarer Stelle neu starten</button><button class="stop" data-command="stop" title="Stoppen" aria-label="Vorlesen stoppen">${icon('stop')}Vorlesen stoppen</button></div></div>`;

export function createKeyboardSettingsRow({document:doc=globalThis.document,t,enabled=true,onEnabled=()=>{},onHelp=()=>{}}={}) {
 const row=doc.createElement('label');row.className='kb-switch-row';row.innerHTML='<span data-i18n="kbEnable"></span><button type="button" class="kb-switch" role="switch" aria-checked="true" data-keyboard-enabled></button>';
 const toggle=row.querySelector('button');toggle.setAttribute('aria-checked',String(enabled));toggle.addEventListener('click',()=>{const on=toggle.getAttribute('aria-checked')!=='true';onEnabled(on,toggle);row.getRootNode().dispatchEvent(new CustomEvent('notable-keyboard-state',{detail:{enabled:on}}));});
 const open=doc.createElement('button');open.type='button';open.className='kb-help-open';open.dataset.i18n='kbOpenHelp';open.textContent=t('kbOpenHelp');open.title=t('kbOpenHelp');open.addEventListener('click',onHelp);return [row,open];
}

export function createSettingsSwitch(node,on=false) {
 node.type='button';node.setAttribute('role','switch');node.classList.add('switch-input');node.setAttribute('aria-checked',String(on));Object.defineProperty(node,'checked',{configurable:true,get:()=>on,set:value=>{on=value===true;node.setAttribute('aria-checked',String(on));}});node.addEventListener('click',()=>{if(node.disabled)return;node.checked=!on;node.dispatchEvent(new Event('change',{bubbles:true}));});return node;
}
