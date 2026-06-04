// history.js — history list, filtering, edit orchestration

import { setBusy, _escHtml, _formatTimestamp, _typeColor, _entrySubtitle, RARITY_COLORS } from './utils.js';
import { state } from './state.js';
import { renderSheet, exportToFoundryJSON as _exportCharacterToFoundry, _buildCharacterEditForm, _collectCharacterEdits } from './forge.js';
import { renderItemSheet, exportItemToFoundryJSON, _buildItemEditForm, _collectItemEdits } from './items.js';
import { renderShopSheet, _renderShopContent, _buildShopEditForm, _collectShopEdits } from './shop.js';
import { renderFactionSheet, _buildFactionEditForm, _collectFactionEdits } from './faction.js';
import { renderBestiarySheet, exportMonsterToFoundryJSON, _buildBestiaryEditForm, _collectBestiaryEdits } from './bestiary.js';

export async function loadHistoryList() {
  document.getElementById('historyEntriesList').innerHTML =
    '<p class="text-xs text-gray-600 text-center pt-8">Loading…</p>';
  try {
    const r = await fetch('/api/history');
    state.historyEntries = await r.json();
    renderHistoryList();
  } catch (e) {
    document.getElementById('historyEntriesList').innerHTML =
      `<p class="text-xs text-red-400 text-center pt-8">Failed to load history</p>`;
  }
}

export function filterHistory() {
  renderHistoryList();
}

export function setHistoryTag(tag) {
  state.historyActiveTag = state.historyActiveTag === tag ? null : tag;
  renderHistoryList();
}

export function _buildTagFilters() {
  const container = document.getElementById('historyTagFilters');
  if (!container) return;
  const tags = [...new Set(state.historyEntries.map(e => e.type))].sort();
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  const allActive = !state.historyActiveTag;
  allBtn.className = 'text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer';
  allBtn.style.color = allActive ? '#c9a227' : '#8a7560';
  allBtn.style.borderColor = allActive ? '#c9a227' : '#5a3e28';
  allBtn.style.background = allActive ? 'rgba(201,162,39,0.08)' : 'transparent';
  allBtn.textContent = `All (${state.historyEntries.length})`;
  allBtn.onclick = () => { state.historyActiveTag = null; renderHistoryList(); };
  container.appendChild(allBtn);

  for (const tag of tags) {
    const count = state.historyEntries.filter(e => e.type === tag).length;
    const color = _typeColor(tag);
    const isActive = state.historyActiveTag === tag;
    const btn = document.createElement('button');
    btn.className = 'text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer';
    btn.style.color = isActive ? color : '#8a7560';
    btn.style.borderColor = isActive ? color : '#5a3e28';
    btn.style.background = isActive ? `${color}18` : 'transparent';
    btn.textContent = `${tag} (${count})`;
    btn.onclick = () => setHistoryTag(tag);
    container.appendChild(btn);
  }
}

export function renderHistoryList() {
  _buildTagFilters();

  const container = document.getElementById('historyEntriesList');
  if (state.historyEntries.length === 0) {
    container.innerHTML =
      '<p class="text-xs text-gray-600 text-center pt-8">No generations yet.<br>Head to NPCs or Items to get started.</p>';
    return;
  }

  const searchQuery = (document.getElementById('historySearch')?.value || '').toLowerCase().trim();
  const sortMode = document.getElementById('historySort')?.value || 'date-desc';
  const docmostFilter = document.getElementById('historyDocmostFilter')?.value || 'all';

  let filtered = state.historyEntries;
  if (state.historyActiveTag) {
    filtered = filtered.filter(e => e.type === state.historyActiveTag);
  }
  if (docmostFilter === 'saved') {
    filtered = filtered.filter(e => e.docmost_page_id);
  } else if (docmostFilter === 'unsaved') {
    filtered = filtered.filter(e => !e.docmost_page_id);
  }
  if (searchQuery) {
    filtered = filtered.filter(e => {
      const name = (e.name || '').toLowerCase();
      const extra = [
        e.type, e.race, e.character_class, e.alignment,
        e.item_type, e.rarity,
        e.faction_type, e.size,
        e.level != null ? String(e.level) : null,
        e.target_level_min != null ? String(e.target_level_min) : null,
        e.target_level_max != null ? String(e.target_level_max) : null,
      ].filter(Boolean).join(' ').toLowerCase();
      return name.includes(searchQuery) || extra.includes(searchQuery);
    });
  }

  if (sortMode === 'date-asc') {
    filtered = [...filtered].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } else if (sortMode === 'name-asc') {
    filtered = [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (sortMode === 'name-desc') {
    filtered = [...filtered].sort((a, b) => (b.name || '').localeCompare(a.name || ''));
  }

  if (filtered.length === 0) {
    container.innerHTML =
      '<p class="text-xs text-gray-600 text-center pt-4">No matching entries.</p>';
    return;
  }

  container.innerHTML = '';
  for (const entry of filtered) {
    const card = document.createElement('div');
    card.className = 'history-card' + (entry.id === state.selectedHistoryEntryId ? ' selected' : '');
    card.onclick = () => openHistoryEntry(entry.id);
    card.innerHTML = `
      <div class="flex items-start justify-between gap-1 mb-0.5">
        <span class="text-sm font-bold text-parchment leading-tight">${entry.name}</span>
        <span class="source-tag flex-shrink-0" style="color:${_typeColor(entry.type)}">${entry.type}</span>
      </div>
      <div class="text-xs text-gray-500">${_entrySubtitle(entry)}</div>
      <div class="text-xs text-gray-600 mt-0.5">${_formatTimestamp(entry.timestamp)}</div>
      ${entry.docmost_page_id ? '<div class="text-xs text-green-600 mt-0.5">✓ Saved to Docmost</div>' : ''}
    `;
    container.appendChild(card);
  }
}

export async function openHistoryEntry(entryId) {
  state.selectedHistoryEntryId = entryId;
  renderHistoryList();

  document.getElementById('historyDetail').classList.add('hidden');
  document.getElementById('historyPlaceholder').classList.remove('hidden');
  document.getElementById('historyPlaceholder').querySelector('p').textContent = 'Loading…';

  try {
    const r = await fetch(`/api/history/${entryId}`);
    if (!r.ok) throw new Error('Entry not found');
    const entry = await r.json();

    state.selectedHistoryEntryType = entry.type;
    state.currentHistoryId = entry.id;

    const isItem = entry.type === 'Item';
    const isShop = entry.type === 'Shop';
    const isFaction = entry.type === 'Faction';
    const isMonster = entry.type === 'Monster';

    if (isItem) {
      state.currentItem = entry.item;
      state.currentCharacter = null;
      state.currentShop = null;
      state.currentFaction = null;
      state.currentMonster = null;
    } else if (isShop) {
      state.currentShop = entry.shop;
      state.currentShopSynced = !!entry.docmost_page_id;
      state.currentShopDocmostUrl = entry.docmost_url || null;
      state.currentItem = null;
      state.currentCharacter = null;
      state.currentFaction = null;
      state.currentMonster = null;
    } else if (isFaction) {
      state.currentFaction = entry.faction;
      state.currentFactionSynced = !!entry.docmost_page_id;
      state.currentFactionDocmostUrl = entry.docmost_url || null;
      state.currentItem = null;
      state.currentCharacter = null;
      state.currentShop = null;
      state.currentMonster = null;
    } else if (isMonster) {
      state.currentMonster = entry.monster;
      state.currentMonsterHistoryId = entry.id;
      state.currentMonsterSynced = !!entry.docmost_page_id;
      state.currentMonsterDocmostUrl = entry.docmost_url || null;
      state.currentItem = null;
      state.currentCharacter = null;
      state.currentShop = null;
      state.currentFaction = null;
    } else {
      state.currentCharacter = entry.character;
      state.currentItem = null;
      state.currentShop = null;
      state.currentFaction = null;
      state.currentMonster = null;
    }

    // Meta line
    let metaHtml = `<span class="font-bold text-parchment">${entry.name}</span>`;
    if (isItem) {
      const rarityColor = RARITY_COLORS[entry.rarity] || '#9d9d9d';
      metaHtml += `<span class="ml-2">${entry.item_type} · <span style="color:${rarityColor}">${entry.rarity}</span> · Levels ${entry.target_level_min}–${entry.target_level_max}</span>`;
    } else if (isShop) {
      metaHtml += `<span class="ml-2">${entry.category} ${entry.shop_type} · ${entry.item_count} items</span>`;
    } else if (isFaction) {
      metaHtml += `<span class="ml-2">${entry.faction_type} · ${entry.size} · ${entry.alignment}</span>`;
    } else if (isMonster) {
      metaHtml += `<span class="ml-2">CR ${entry.cr} · ${entry.size} ${entry.monster_type} · ${entry.alignment}</span>`;
    } else {
      metaHtml += `<span class="ml-2">${entry.character_class} · ${entry.race} · Level ${entry.level} · ${entry.alignment}</span>`;
    }
    metaHtml += `<span class="ml-2 text-gray-600">Generated ${_formatTimestamp(entry.timestamp)}</span>`;
    document.getElementById('historyEntryMeta').innerHTML = metaHtml;

    document.getElementById('historyFoundryBtn').classList.toggle('hidden', isShop || isFaction);
    document.getElementById('historySaveFolder').classList.toggle('hidden', isItem || isShop || isFaction || isMonster);

    const link = document.getElementById('historyDocmostLink');
    if (entry.docmost_url) {
      link.href = entry.docmost_url;
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }

    _updateHistorySyncStatus(entry);
    document.getElementById('historySaveResult').classList.add('hidden');
    document.getElementById('historyPlaceholder').classList.add('hidden');
    document.getElementById('historyDetail').classList.remove('hidden');

    const historySheet = document.getElementById('historySheet');
    historySheet.innerHTML = '';
    if (isFaction) {
      renderFactionSheet(entry.faction, historySheet, state.currentFactionSynced, entry.linked_npcs || []);
    } else if (isItem) {
      renderItemSheet(entry.item, historySheet);
    } else if (isShop) {
      _renderShopContent(entry.shop, historySheet, state.currentShopSynced, entry.linked_npcs || []);
    } else if (isMonster) {
      renderBestiarySheet(entry.monster, historySheet, state.currentMonsterSynced);
    } else {
      renderSheet(entry.character, historySheet);
    }
  } catch (e) {
    document.getElementById('historyPlaceholder').querySelector('p').textContent = `Error: ${e.message}`;
  }
}

export async function saveFromHistory() {
  const isItem = state.selectedHistoryEntryType === 'Item';
  const isShop = state.selectedHistoryEntryType === 'Shop';
  const isFaction = state.selectedHistoryEntryType === 'Faction';
  const isMonster = state.selectedHistoryEntryType === 'Monster';
  const current = isItem ? state.currentItem : isShop ? state.currentShop : isFaction ? state.currentFaction : isMonster ? state.currentMonster : state.currentCharacter;
  if (!current) return;

  setBusy('historySaveBtn', 'historySaveSpinner', 'historySaveBtnText', true, 'Saving…');
  const resultEl = document.getElementById('historySaveResult');
  resultEl.classList.add('hidden');

  try {
    let endpoint, body;
    if (isItem) {
      endpoint = '/api/save-item';
      body = { item: state.currentItem, history_id: state.currentHistoryId };
    } else if (isShop) {
      endpoint = '/api/save-shop';
      body = { shop: state.currentShop, history_id: state.currentHistoryId };
    } else if (isFaction) {
      endpoint = '/api/save-faction';
      body = { faction: state.currentFaction, history_id: state.currentHistoryId };
    } else if (isMonster) {
      endpoint = '/api/save-bestiary';
      body = { monster: state.currentMonster, history_id: state.currentHistoryId };
    } else {
      endpoint = '/api/save';
      body = { character: state.currentCharacter, folder: document.getElementById('historySaveFolder').value, history_id: state.currentHistoryId };
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const now = new Date().toISOString();
    const entry = state.historyEntries.find(e => e.id === state.currentHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
      entry.docmost_synced_at = now;
      entry.docmost_out_of_sync = false;
      renderHistoryList();
      _updateHistorySyncStatus(entry);
    }

    if (isShop) {
      state.currentShopSynced = true;
      state.currentShopDocmostUrl = data.docmost_url || null;
      const historySheet = document.getElementById('historySheet');
      historySheet.innerHTML = '';
      _renderShopContent(state.currentShop, historySheet, true, entry?.linked_npcs || []);
    } else if (isFaction) {
      state.currentFactionSynced = true;
      state.currentFactionDocmostUrl = data.docmost_url || null;
      const historySheet = document.getElementById('historySheet');
      historySheet.innerHTML = '';
      renderFactionSheet(state.currentFaction, historySheet, true, entry?.linked_npcs || []);
    } else if (isMonster) {
      state.currentMonsterSynced = true;
      state.currentMonsterDocmostUrl = data.docmost_url || null;
      const historySheet = document.getElementById('historySheet');
      historySheet.innerHTML = '';
      renderBestiarySheet(state.currentMonster, historySheet, true);
    }

    if (data.docmost_url) {
      const link = document.getElementById('historyDocmostLink');
      link.href = data.docmost_url;
      link.classList.remove('hidden');
    }

    resultEl.textContent = `✓ Saved (page ${data.page_id})`;
    resultEl.className = 'text-xs text-green-400';
    resultEl.classList.remove('hidden');
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('historySaveBtn', 'historySaveSpinner', 'historySaveBtnText', false, 'Save to Docmost');
  }
}

export function _updateHistorySyncStatus(entry) {
  const hasSynced = !!entry.docmost_page_id;
  const outOfSync = !!entry.docmost_out_of_sync;
  document.getElementById('historySaveRow').classList.toggle('hidden', hasSynced);
  document.getElementById('historySyncStatus').classList.toggle('hidden', !hasSynced);
  document.getElementById('historyResyncWarning').classList.add('hidden');

  if (hasSynced) {
    const ts = entry.docmost_synced_at || entry.timestamp;
    const icon = document.querySelector('#historySyncStatus i');
    const text = document.getElementById('historySyncStatusText');
    if (outOfSync) {
      icon.className = 'fa-solid fa-circle-exclamation text-amber-400';
      text.className = 'text-xs text-amber-400';
      text.textContent = `Out of sync · edited since last save (synced ${_formatTimestamp(ts)})`;
    } else {
      icon.className = 'fa-solid fa-circle-check text-green-400';
      text.className = 'text-xs text-green-400';
      text.textContent = `Synced to Docmost · ${_formatTimestamp(ts)}`;
    }
  }
}

export function showResyncWarning() {
  document.getElementById('historyResyncWarning').classList.remove('hidden');
}

export function cancelResync() {
  document.getElementById('historyResyncWarning').classList.add('hidden');
}

export async function confirmResync() {
  document.getElementById('historyResyncWarning').classList.add('hidden');
  document.getElementById('historySaveRow').classList.remove('hidden');
  await saveFromHistory();
}

export function enterEditMode() {
  document.getElementById('historyViewButtons').classList.add('hidden');
  document.getElementById('historyEditButtons').classList.remove('hidden');
  document.getElementById('historySaveRow').classList.add('hidden');
  document.getElementById('historySyncStatus').classList.add('hidden');
  document.getElementById('historyResyncWarning').classList.add('hidden');
  document.getElementById('historySaveResult').classList.add('hidden');

  const sheet = document.getElementById('historySheet');
  sheet.innerHTML = '';
  if (state.selectedHistoryEntryType === 'Item') {
    sheet.appendChild(_buildItemEditForm(state.currentItem));
  } else if (state.selectedHistoryEntryType === 'Shop') {
    sheet.appendChild(_buildShopEditForm(state.currentShop));
  } else if (state.selectedHistoryEntryType === 'Faction') {
    sheet.appendChild(_buildFactionEditForm(state.currentFaction));
  } else if (state.selectedHistoryEntryType === 'Monster') {
    sheet.appendChild(_buildBestiaryEditForm(state.currentMonster));
  } else {
    sheet.appendChild(_buildCharacterEditForm(state.currentCharacter));
  }
}

export function exitEditMode(reRender = true) {
  document.getElementById('historyViewButtons').classList.remove('hidden');
  document.getElementById('historyEditButtons').classList.add('hidden');

  if (reRender) {
    const sheet = document.getElementById('historySheet');
    sheet.innerHTML = '';
    if (state.selectedHistoryEntryType === 'Item') renderItemSheet(state.currentItem, sheet);
    else if (state.selectedHistoryEntryType === 'Shop') _renderShopContent(state.currentShop, sheet);
    else if (state.selectedHistoryEntryType === 'Faction') {
      const fEntry = state.historyEntries.find(e => e.id === state.currentHistoryId);
      renderFactionSheet(state.currentFaction, sheet, state.currentFactionSynced, fEntry?.linked_npcs || []);
    }
    else if (state.selectedHistoryEntryType === 'Monster') {
      renderBestiarySheet(state.currentMonster, sheet, state.currentMonsterSynced);
    }
    else renderSheet(state.currentCharacter, sheet);
  }

  const entry = state.historyEntries.find(e => e.id === state.currentHistoryId);
  if (entry) _updateHistorySyncStatus(entry);
}

export async function saveEdit() {
  let updates;
  if (state.selectedHistoryEntryType === 'Item') updates = _collectItemEdits();
  else if (state.selectedHistoryEntryType === 'Shop') updates = _collectShopEdits();
  else if (state.selectedHistoryEntryType === 'Faction') updates = _collectFactionEdits();
  else if (state.selectedHistoryEntryType === 'Monster') updates = _collectBestiaryEdits();
  else updates = _collectCharacterEdits();

  const btn = document.getElementById('historyEditSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Saving…';

  try {
    const r = await fetch(`/api/history/${state.currentHistoryId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    if (state.selectedHistoryEntryType === 'Item') state.currentItem = { ...state.currentItem, ...updates };
    else if (state.selectedHistoryEntryType === 'Shop') state.currentShop = { ...state.currentShop, ...updates };
    else if (state.selectedHistoryEntryType === 'Faction') state.currentFaction = { ...state.currentFaction, ...updates };
    else if (state.selectedHistoryEntryType === 'Monster') state.currentMonster = { ...state.currentMonster, ...updates };
    else state.currentCharacter = { ...state.currentCharacter, ...updates };

    const entry = state.historyEntries.find(e => e.id === state.currentHistoryId);
    if (entry) {
      if (updates.name) entry.name = updates.name;
      if (updates.item_type) entry.item_type = updates.item_type;
      if (updates.rarity) entry.rarity = updates.rarity;
      if (updates.shop_type) entry.shop_type = updates.shop_type;
      if (updates.category) entry.category = updates.category;
      if (updates.items) entry.item_count = updates.items.length;
      if (updates.faction_type) entry.faction_type = updates.faction_type;
      if (updates.size) entry.size = updates.size;
      if (updates.alignment) entry.alignment = updates.alignment;
      if (updates.monster_type) entry.monster_type = updates.monster_type;
      entry.edited_at = data.edited_at;
      if (data.out_of_sync) entry.docmost_out_of_sync = true;
    }

    renderHistoryList();
    exitEditMode(true);
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i>Save Changes';
  }
}

export function exportHistoryToFoundry() {
  const type = state.selectedHistoryEntryType;
  if (type === 'Monster' && state.currentMonster) {
    exportMonsterToFoundryJSON(state.currentMonster);
  } else if (type === 'Item' && state.currentItem) {
    exportItemToFoundryJSON(state.currentItem);
  } else if (state.currentCharacter) {
    _exportCharacterToFoundry();
  }
}
