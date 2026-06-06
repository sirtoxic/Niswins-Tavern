// utils.js — pure utilities + constants, no state, no imports from other app modules

export const RARITY_COLORS = {
  Common:    '#9d9d9d',
  Uncommon:  '#1eff00',
  Rare:      '#0070dd',
  Epic:      '#a335ee',
  Legendary: '#ff8000',
};

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function sectionHeader(title) {
  return el('div', 'section-header mt-4', title);
}

export function sign(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

const _busyTimers = new Map();

export function setBusy(btnId, spinnerId, textId, busy, label) {
  const btn = document.getElementById(btnId);
  const spin = document.getElementById(spinnerId);
  const txt = document.getElementById(textId);
  btn.disabled = busy;
  spin.classList.toggle('hidden', !busy);

  if (_busyTimers.has(textId)) {
    clearInterval(_busyTimers.get(textId));
    _busyTimers.delete(textId);
  }

  if (busy) {
    const start = Date.now();
    txt.textContent = label;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      txt.textContent = `${label} ${elapsed}s`;
    }, 1000);
    _busyTimers.set(textId, id);
  } else {
    txt.textContent = label;
  }
}

export function _escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function _escAttr(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}

export function _showTokenUsage(usage, elementId = 'tokenUsage') {
  const e = document.getElementById(elementId);
  if (!e || !usage) return;
  const costStr = usage.cost_usd < 0.001
    ? `< $0.001`
    : `$${usage.cost_usd.toFixed(4)}`;
  e.innerHTML = `
    <span title="Input tokens">${usage.input_tokens.toLocaleString()} in</span>
    <span class="text-gray-600">/</span>
    <span title="Output tokens">${usage.output_tokens.toLocaleString()} out</span>
    <span class="text-gray-600">·</span>
    <span title="Estimated cost (${usage.model})" class="text-gold">${costStr}</span>
  `;
  e.classList.remove('hidden');
}

export function _formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

export function _typeColor(type) {
  const map = {
    'Character':        '#c9a227',
    'Generic NPC':      '#8a7560',
    'Player Character': '#3b9e8e',
    'Beast':            '#4a7c59',
    'Location':         '#4a6e9e',
    'Encounter':        '#8b1a1a',
    'Item':             '#a335ee',
    'Shop':             '#2e86ab',
    'Faction':          '#e07b39',
    'Monster':          '#8b2020',
  };
  return map[type] || '#8a7560';
}

export function _entrySubtitle(entry) {
  if (entry.type === 'Item') {
    const rarityColor = RARITY_COLORS[entry.rarity] || '#9d9d9d';
    return `${entry.item_type} · <span style="color:${rarityColor}">${entry.rarity}</span> · Lvl ${entry.target_level_min}–${entry.target_level_max}`;
  }
  if (entry.type === 'Shop') {
    return `${entry.category} ${entry.shop_type} · ${entry.item_count ?? '?'} items`;
  }
  if (entry.type === 'Faction') {
    return `${entry.faction_type} · ${entry.size} · ${entry.alignment}`;
  }
  if (entry.type === 'Monster') {
    return `CR ${entry.cr} · ${entry.size} ${entry.monster_type}`;
  }
  return `${entry.character_class} · ${entry.race} · Lvl ${entry.level}`;
}

export function _editField(id, label, value, type = 'text') {
  const w = el('div');
  w.innerHTML = `<label class="text-xs text-gray-400 block mb-1">${label}</label>
    <input id="${id}" type="${type}" class="input-field text-sm w-full" value="${_escAttr(value)}" />`;
  return w;
}

export function _editTextarea(id, label, value, rows = 3) {
  const w = el('div');
  w.innerHTML = `<label class="text-xs text-gray-400 block mb-1">${label}</label>
    <textarea id="${id}" class="input-field text-sm w-full" rows="${rows}">${_escHtml(value)}</textarea>`;
  return w;
}

export function _editSelect(id, label, options, selected) {
  const w = el('div');
  const opts = options.map(o => `<option value="${o}" ${o === selected ? 'selected' : ''}>${o}</option>`).join('');
  w.innerHTML = `<label class="text-xs text-gray-400 block mb-1">${label}</label>
    <select id="${id}" class="input-field text-sm w-full">${opts}</select>`;
  return w;
}

export function _sectionLabel(text) {
  const d = el('div', 'text-xs text-gold uppercase font-bold mb-3');
  d.textContent = text;
  return d;
}

// ---------------------------------------------------------------------------
// Universal context / association picker
// ---------------------------------------------------------------------------

export function _apiDetail(detail, fallback = 'Request failed') {
  if (!detail) return fallback;
  if (Array.isArray(detail)) return detail.map(d => d.msg || JSON.stringify(d)).join('; ');
  if (typeof detail === 'object') return JSON.stringify(detail);
  return String(detail);
}

export function copyEntryLink(historyId) {
  if (!historyId) return;
  // Update the URL bar so the current address is already the shareable link
  history.replaceState(null, '', `#entry/${historyId}`);
  const url = `${window.location.origin}${window.location.pathname}#entry/${historyId}`;
  navigator.clipboard.writeText(url).then(
    () => toast('Link copied to clipboard', 'info'),
    () => toast('Could not access clipboard', 'error'),
  );
}

export function _renderAssocLinks(divId, historyId, assocSelectId) {
  const div = document.getElementById(divId);
  if (!div) return;
  const assocId = getContextId(assocSelectId);
  const entries = window._state?.historyEntries ?? [];
  const assoc = assocId ? entries.find(e => e.id === assocId) : null;

  if (!historyId && !assoc) { div.classList.add('hidden'); return; }

  div.innerHTML = '';
  div.classList.remove('hidden');

  if (assoc) {
    const chip = document.createElement('a');
    chip.className = 'flex items-center gap-1 text-gold hover:underline text-xs';
    chip.href = `#entry/${assoc.id}`;
    chip.title = `Open ${assoc.name} in History`;
    chip.innerHTML = `<i class="fa-solid fa-link opacity-60 shrink-0"></i><span>${_escHtml(assoc.name)}</span><span class="text-gray-500 shrink-0">(${_escHtml(assoc.type)})</span>`;
    div.appendChild(chip);
  }

  if (historyId) {
    const btn = document.createElement('button');
    btn.className = 'flex items-center gap-1 text-gray-500 hover:text-gold text-xs ml-auto';
    btn.innerHTML = '<i class="fa-solid fa-link"></i> Copy link';
    btn.onclick = () => copyEntryLink(historyId);
    div.appendChild(btn);
  }
}

export function cacheHistoryEntry(entry) {
  if (!window._state) return;
  // Remove any existing entry with the same id, then prepend
  window._state.historyEntries = [entry, ...window._state.historyEntries.filter(e => e.id !== entry.id)];
}

export function populateContextPicker(selectId, typeFilter = null) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;

  // Lazy import state to avoid circular deps — accessed at call time
  const allEntries = window._state?.historyEntries ?? [];
  const entries = typeFilter ? allEntries.filter(e => e.type === typeFilter) : allEntries;

  const TYPE_ORDER = ['Location', 'Faction', 'Shop', 'Character', 'Generic NPC', 'Player Character', 'Monster', 'Item'];
  const sorted = [...entries].sort((a, b) => {
    const ta = TYPE_ORDER.indexOf(a.type);
    const tb = TYPE_ORDER.indexOf(b.type);
    return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb) || a.name.localeCompare(b.name);
  });

  sel.innerHTML = '<option value="">None</option>';
  for (const entry of sorted) {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = typeFilter ? `${entry.name} (${entry.location_type || entry.type})` : `[${entry.type}] ${entry.name}`;
    if (entry.id === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

export function getContextId(selectId) {
  return document.getElementById(selectId)?.value || null;
}

export function buildContextNote(selectId) {
  const id = getContextId(selectId);
  if (!id) return '';
  const entries = window._state?.historyEntries ?? [];
  const entry = entries.find(e => e.id === id);
  if (!entry) return '';

  let detail = '';
  if (entry.type === 'Location') {
    detail = entry.location?.atmosphere || (entry.location?.description || '').substring(0, 120);
  } else if (entry.type === 'Faction') {
    detail = (entry.faction?.overview || '').substring(0, 120);
  } else if (entry.type === 'Shop') {
    detail = entry.shop?.atmosphere || `${entry.category} ${entry.shop_type}`;
  } else if (entry.type === 'Monster') {
    detail = `CR ${entry.cr} ${entry.size} ${entry.monster_type}`;
  } else if (entry.type === 'Item') {
    detail = `${entry.rarity} ${entry.item_type}`;
  } else {
    detail = `${entry.race || ''} ${entry.character_class || ''}`.trim();
  }

  const detailStr = detail ? ` — ${detail}` : '';
  return `World context: This content exists within or relates to "${entry.name}" (${entry.type})${detailStr}. Generate content that fits naturally within this established context.`;
}

export function toast(message, type = 'success') {
  let container = document.getElementById('_toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = '_toast-container';
    container.className = 'fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(container);
  }

  const styles = {
    success: { border: 'border-l-green-600', icon: 'fa-circle-check', text: 'text-green-400' },
    error:   { border: 'border-l-red-600',   icon: 'fa-circle-xmark', text: 'text-red-400' },
    info:    { border: 'border-l-amber-500', icon: 'fa-circle-info',  text: 'text-amber-400' },
  };
  const s = styles[type] || styles.info;

  const t = document.createElement('div');
  t.className = `pointer-events-auto flex items-start gap-2.5 bg-gray-900 border border-border border-l-4 ${s.border} rounded px-4 py-3 shadow-xl text-sm max-w-sm`;
  t.innerHTML = `<i class="fa-solid ${s.icon} ${s.text} mt-0.5 shrink-0"></i><span class="text-parchment leading-snug">${_escHtml(message)}</span>`;
  container.appendChild(t);

  setTimeout(() => {
    t.style.transition = 'opacity 0.3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 4000);
}
