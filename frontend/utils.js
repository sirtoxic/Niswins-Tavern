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

export function setBusy(btnId, spinnerId, textId, busy, label) {
  const btn = document.getElementById(btnId);
  const spin = document.getElementById(spinnerId);
  const txt = document.getElementById(textId);
  btn.disabled = busy;
  spin.classList.toggle('hidden', !busy);
  txt.textContent = label;
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
