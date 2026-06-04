// items.js — item generation, rendering, editing

import { el, sectionHeader, setBusy, _escHtml, _escAttr, _showTokenUsage, RARITY_COLORS, _editField, _editTextarea, _editSelect, _sectionLabel } from './utils.js';
import { state } from './state.js';

export async function generateItem() {
  const concept = document.getElementById('itemConcept').value.trim();
  const itemType = document.getElementById('itemType').value.trim();

  if (!concept || !itemType) {
    alert('Please fill in Concept and Item Type before generating.');
    return;
  }

  const minLevel = parseInt(document.getElementById('itemLevelMin').value);
  const maxLevel = parseInt(document.getElementById('itemLevelMax').value);
  if (minLevel > maxLevel) {
    alert('Min Level cannot be greater than Max Level.');
    return;
  }

  setBusy('generateItemBtn', 'generateItemSpinner', 'generateItemBtnText', true, 'Generating…');
  document.getElementById('itemSheet').classList.add('hidden');
  document.getElementById('itemPlaceholder').classList.remove('hidden');
  document.getElementById('itemSaveSection').classList.add('hidden');
  document.getElementById('itemTokenUsage').classList.add('hidden');

  try {
    const body = {
      concept,
      item_type: itemType,
      rarity: document.getElementById('itemRarity').value,
      target_level_min: minLevel,
      target_level_max: maxLevel,
      additional_notes: document.getElementById('itemNotes').value.trim(),
      magic_theme: document.getElementById('itemMagicTheme').value.trim(),
      material: document.getElementById('itemMaterial').value.trim(),
      stat_bonus_target: document.getElementById('itemStatBonus').value.trim(),
      damage_type: document.getElementById('itemDamageType').value.trim(),
      attunement: document.getElementById('itemAttunement').value,
    };

    const r = await fetch('/api/generate-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.detail || 'Generation failed');
    }

    const data = await r.json();
    state.currentItem = data.item;
    state.currentItemHistoryId = data.history_id ?? null;

    document.getElementById('itemPlaceholder').classList.add('hidden');
    document.getElementById('itemSheet').classList.remove('hidden');
    renderItemSheet(state.currentItem);
    document.getElementById('itemSaveSection').classList.remove('hidden');
    _showTokenUsage(data.usage, 'itemTokenUsage');
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    setBusy('generateItemBtn', 'generateItemSpinner', 'generateItemBtnText', false, 'Generate Item');
  }
}

export async function saveItem() {
  if (!state.currentItem) return;
  setBusy('saveItemBtn', 'saveItemSpinner', 'saveItemBtnText', true, 'Saving…');
  const resultEl = document.getElementById('saveItemResult');
  resultEl.classList.add('hidden');

  try {
    const r = await fetch('/api/save-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: state.currentItem, history_id: state.currentItemHistoryId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const entry = state.historyEntries.find(e => e.id === state.currentItemHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }

    resultEl.textContent = `✓ Saved to Items / ${state.currentItem.item_type}`;
    resultEl.className = 'text-xs text-center py-1 text-green-400';
    resultEl.classList.remove('hidden');
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-center py-1 text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('saveItemBtn', 'saveItemSpinner', 'saveItemBtnText', false, 'Save to Docmost');
  }
}

export function exportItemToPDF() {
  if (!state.currentItem) return;
  window.print();
}

export function renderItemSheet(item, containerEl) {
  const sheet = containerEl || document.getElementById('itemSheet');
  sheet.innerHTML = '';

  const rarityColor = RARITY_COLORS[item.rarity] || '#9d9d9d';

  // Header
  const header = el('div', 'panel');
  let attuneLine = '';
  if (item.requires_attunement) {
    const byNote = item.attunement_by ? ` by ${item.attunement_by}` : '';
    attuneLine = `<span class="source-tag" style="color:#60a5fa;border-color:#60a5fa"><i class="fa-solid fa-bolt mr-1"></i>Requires Attunement${byNote}</span>`;
  }
  header.innerHTML = `
    <h2 class="text-3xl font-bold mb-2" style="color:${rarityColor}">${item.name}</h2>
    <div class="flex flex-wrap gap-2 text-sm mb-2">
      <span class="source-tag">${item.item_type}</span>
      <span class="source-tag font-bold" style="color:${rarityColor};border-color:${rarityColor}">${item.rarity}</span>
      <span class="source-tag">Levels ${item.target_level_min}–${item.target_level_max}</span>
      ${attuneLine}
    </div>
    <p class="text-sm text-gray-300 italic leading-relaxed">${item.description}</p>
  `;
  sheet.appendChild(header);

  // Lore
  if (item.lore) {
    sheet.appendChild(sectionHeader('Lore'));
    const lorePanel = el('div', 'panel');
    lorePanel.innerHTML = `<p class="text-sm text-gray-400 leading-relaxed italic">${item.lore}</p>`;
    sheet.appendChild(lorePanel);
  }

  // Bonuses
  if (item.bonuses && item.bonuses.length) {
    sheet.appendChild(sectionHeader('Bonuses'));
    const bonusPanel = el('div', 'panel space-y-1');
    for (const b of item.bonuses) {
      const row = el('div', 'flex items-center justify-between py-1 border-b border-panelbg');
      row.innerHTML = `
        <span class="text-sm text-parchment">${b.stat}</span>
        <span class="text-lg font-bold" style="color:${rarityColor}">${b.value >= 0 ? '+' : ''}${b.value}</span>
      `;
      bonusPanel.appendChild(row);
    }
    sheet.appendChild(bonusPanel);
  }

  // Magical Abilities
  if (item.abilities && item.abilities.length) {
    sheet.appendChild(sectionHeader('Magical Abilities'));
    const abPanel = el('div', 'panel space-y-4');
    for (const a of item.abilities) {
      const ab = el('div', 'border-l-2 pl-3');
      ab.style.borderColor = rarityColor;
      const activationTag = a.activation && a.activation !== 'Passive' && a.activation !== 'None'
        ? `<span class="source-tag">${a.activation}</span>` : '';
      ab.innerHTML = `
        <div class="flex flex-wrap items-center gap-2 mb-1">
          <span class="text-sm font-bold text-parchment">${a.name}</span>
          <span class="source-tag">${a.usage}</span>
          ${activationTag}
        </div>
        <p class="text-xs text-gray-300 leading-relaxed">${a.description}</p>
      `;
      abPanel.appendChild(ab);
    }
    sheet.appendChild(abPanel);
  }

  // Details
  const details = [];
  if (item.weight_lbs != null) details.push(['Weight', `${item.weight_lbs} lbs`]);
  if (item.value_gp != null) details.push(['Value', `${item.value_gp.toLocaleString()} gp`]);
  if (details.length) {
    sheet.appendChild(sectionHeader('Details'));
    const detailPanel = el('div', 'panel flex flex-wrap gap-6 text-sm');
    for (const [label, val] of details) {
      detailPanel.innerHTML += `<div><span class="text-gold font-bold">${label}:</span> <span class="text-gray-300">${val}</span></div>`;
    }
    sheet.appendChild(detailPanel);
  }
}

export function _buildItemEditForm(item) {
  const form = el('div', 'space-y-4');

  const basics = el('div', 'panel space-y-3');
  basics.appendChild(_sectionLabel('Basic Info'));
  const r1 = el('div', 'grid grid-cols-3 gap-3');
  r1.appendChild(_editField('edit_name', 'Name', item.name));
  r1.appendChild(_editField('edit_item_type', 'Type', item.item_type));
  r1.appendChild(_editSelect('edit_rarity', 'Rarity', ['Common','Uncommon','Rare','Epic','Legendary'], item.rarity));
  basics.appendChild(r1);
  const r2 = el('div', 'grid grid-cols-4 gap-3 items-end');
  r2.appendChild(_editField('edit_weight_lbs', 'Weight (lb)', item.weight_lbs ?? '', 'number'));
  r2.appendChild(_editField('edit_value_gp', 'Value (gp)', item.value_gp ?? '', 'number'));
  const attuneWrap = el('div');
  attuneWrap.innerHTML = `<label class="text-xs text-gray-400 block mb-1">Attunement</label>
    <div class="flex items-center gap-2 h-9"><input id="edit_requires_attunement" type="checkbox" ${item.requires_attunement ? 'checked' : ''} />
    <span class="text-xs text-gray-300">Required</span></div>`;
  r2.appendChild(attuneWrap);
  r2.appendChild(_editField('edit_attunement_by', 'Attuned by', item.attunement_by || ''));
  basics.appendChild(r2);
  basics.appendChild(_editTextarea('edit_description', 'Description', item.description, 3));
  basics.appendChild(_editTextarea('edit_lore', 'Lore', item.lore, 3));
  form.appendChild(basics);

  const bonusPanel = el('div', 'panel space-y-2');
  bonusPanel.appendChild(_sectionLabel('Stat Bonuses'));
  const bonusCont = el('div', 'space-y-2');
  bonusCont.id = 'edit_bonuses_container';
  for (const b of (item.bonuses || [])) bonusCont.appendChild(_makeBonusRow(b.stat, b.value));
  bonusPanel.appendChild(bonusCont);
  const addBonus = el('button', 'btn-secondary text-xs py-1 px-3 mt-2', '+ Add Bonus');
  addBonus.onclick = () => document.getElementById('edit_bonuses_container').appendChild(_makeBonusRow('', 0));
  bonusPanel.appendChild(addBonus);
  form.appendChild(bonusPanel);

  const abilPanel = el('div', 'panel space-y-3');
  abilPanel.appendChild(_sectionLabel('Special Abilities'));
  const abilCont = el('div', 'space-y-3');
  abilCont.id = 'edit_abilities_container';
  for (const a of (item.abilities || [])) abilCont.appendChild(_makeAbilityRow(a));
  abilPanel.appendChild(abilCont);
  const addAbil = el('button', 'btn-secondary text-xs py-1 px-3 mt-1', '+ Add Ability');
  addAbil.onclick = () => document.getElementById('edit_abilities_container').appendChild(_makeAbilityRow({name:'',description:'',usage:'',activation:'Passive'}));
  abilPanel.appendChild(addAbil);
  form.appendChild(abilPanel);

  return form;
}

export function _collectItemEdits() {
  const bonuses = [...document.querySelectorAll('#edit_bonuses_container .flex')].map(r => ({
    stat: r.querySelector('.edit-bonus-stat').value.trim(),
    value: parseInt(r.querySelector('.edit-bonus-val').value) || 0,
  })).filter(b => b.stat);
  const abilities = [...document.querySelectorAll('#edit_abilities_container .panel')].map(r => ({
    name: r.querySelector('.edit-ability-name').value.trim(),
    description: r.querySelector('.edit-ability-desc').value.trim(),
    usage: r.querySelector('.edit-ability-usage').value.trim(),
    activation: r.querySelector('.edit-ability-activation').value.trim() || 'Passive',
  })).filter(a => a.name);
  return {
    name: document.getElementById('edit_name').value.trim(),
    item_type: document.getElementById('edit_item_type').value.trim(),
    rarity: document.getElementById('edit_rarity').value,
    description: document.getElementById('edit_description').value.trim(),
    lore: document.getElementById('edit_lore').value.trim(),
    weight_lbs: parseFloat(document.getElementById('edit_weight_lbs').value) || null,
    value_gp: parseInt(document.getElementById('edit_value_gp').value) || null,
    requires_attunement: document.getElementById('edit_requires_attunement').checked,
    attunement_by: document.getElementById('edit_attunement_by').value.trim(),
    bonuses,
    abilities,
  };
}

export function _makeBonusRow(stat, value) {
  const row = el('div', 'flex items-center gap-2');
  row.innerHTML = `
    <input type="text" placeholder="Stat (e.g. Strength)" class="input-field text-xs edit-bonus-stat flex-1" value="${_escAttr(stat)}" />
    <input type="number" class="input-field text-xs edit-bonus-val w-20" value="${_escAttr(value)}" />
    <button class="text-red-500 hover:text-red-300 px-1 text-sm leading-none" onclick="this.parentElement.remove()">×</button>`;
  return row;
}

export function _makeAbilityRow(a) {
  const row = el('div', 'panel py-2 px-3 space-y-2');
  row.innerHTML = `
    <div class="grid grid-cols-3 gap-2">
      <input type="text" placeholder="Name" class="input-field text-xs edit-ability-name col-span-2" value="${_escAttr(a.name)}" />
      <input type="text" placeholder="Usage (e.g. 1/day)" class="input-field text-xs edit-ability-usage" value="${_escAttr(a.usage)}" />
    </div>
    <div class="flex items-center gap-2">
      <input type="text" placeholder="Activation" class="input-field text-xs edit-ability-activation flex-1" value="${_escAttr(a.activation || 'Passive')}" />
      <button class="text-red-500 hover:text-red-300 text-xs ml-auto" onclick="this.closest('.panel').remove()">Remove</button>
    </div>
    <textarea placeholder="Description" class="input-field text-xs w-full edit-ability-desc" rows="2">${_escHtml(a.description)}</textarea>`;
  return row;
}
