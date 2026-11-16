// Shared helpers for the tool pages.
//
// KEEP THIS FILE SMALL. It is loaded by ~240 tool pages, so anything only one page
// needs belongs in that page, not here.
//
// 2026-11-16 (redundancy cleanup, BUG-550 follow-up): this file used to carry 28
// helpers. 26 of them (formatJSON, encodeBase64, timestampToDate, encodeURL,
// generateHash, generateCron, parseCron, updateNextRuns, generateUUID, createUUID,
// copyAllUUID, hexToRgb, rgbToHsl, ...) were legacy copies that no page ever
// called - every page that referenced them already shipped its own copy in the
// same scope, so the global binding was shadowed dead weight on all ~240 pages.
// They were removed; only the two helpers that pages really do call from the
// global scope stayed.
function showStatus(id,msg,type) { const el=document.getElementById(id); if(!el) return; el.textContent=msg; el.className='status '+(type||''); const tok=(el._stTok=(el._stTok||0)+1); setTimeout(()=>{ if(el._stTok===tok) el.textContent=''; },3000); }
function copyToClipboard(id) { const el=document.getElementById(id); if(el) navigator.clipboard.writeText(el.value||el.textContent).catch(()=>{}); }
