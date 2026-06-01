'use strict';

let currentCharacter = null;
let currentHistoryId = null;
let selectedDetail = 'medium';
let historyEntries = [];
let selectedHistoryEntryId = null;

let currentItem = null;
let currentItemHistoryId = null;
let selectedHistoryEntryType = null;  // 'Character', 'Generic NPC', 'Item', etc.

let historyActiveTag = null;

const RARITY_COLORS = {
  Common:    '#9d9d9d',
  Uncommon:  '#1eff00',
  Rare:      '#0070dd',
  Epic:      '#a335ee',
  Legendary: '#ff8000',
};

// -----------------------------------------------------------------------
// Config / startup
// -----------------------------------------------------------------------

async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    for (const selId of ['saveFolder', 'historySaveFolder']) {
      const sel = document.getElementById(selId);
      if (!sel) continue;
      sel.innerHTML = '';
      for (const [key, label] of Object.entries(cfg.folders)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = label;
        if (key === 'npcs') opt.selected = true;
        sel.appendChild(opt);
      }
    }
  } catch {}
}

function setDetail(level) {
  selectedDetail = level;
  ['short', 'medium', 'long'].forEach(d => {
    const btn = document.getElementById(`detail-${d}`);
    btn.className = d === level
      ? 'flex-1 btn-primary text-xs py-2'
      : 'flex-1 btn-secondary text-xs py-2';
  });
}

// -----------------------------------------------------------------------
// View switching
// -----------------------------------------------------------------------

const VIEW_HASHES = { forge: '#npcs', items: '#items', shops: '#shops', history: '#history', settings: '#settings' };
const HASH_VIEWS = { '#npcs': 'forge', '#items': 'items', '#shops': 'shops', '#history': 'history', '#settings': 'settings' };

function switchView(view, updateHash = true) {
  document.getElementById('viewForge').classList.toggle('hidden', view !== 'forge');
  document.getElementById('viewItems').classList.toggle('hidden', view !== 'items');
  document.getElementById('viewShops').classList.toggle('hidden', view !== 'shops');
  document.getElementById('viewHistory').classList.toggle('hidden', view !== 'history');
  document.getElementById('viewSettings').classList.toggle('hidden', view !== 'settings');
  document.getElementById('navForge').classList.toggle('nav-active', view === 'forge');
  document.getElementById('navItems').classList.toggle('nav-active', view === 'items');
  document.getElementById('navShops').classList.toggle('nav-active', view === 'shops');
  document.getElementById('navHistory').classList.toggle('nav-active', view === 'history');
  document.getElementById('navSettings').classList.toggle('nav-active', view === 'settings');
  if (updateHash && location.hash !== (VIEW_HASHES[view] || '')) {
    history.pushState(null, '', VIEW_HASHES[view] || '#npcs');
  }
  if (view === 'history') {
    if (historyEntries.length === 0) loadHistoryList();
    else renderHistoryList();
  }
  if (view === 'items') updateRarityBadge();
  if (view === 'settings') loadSettings();
}

window.addEventListener('hashchange', () => {
  const view = HASH_VIEWS[location.hash] || 'forge';
  switchView(view, false);
});

window.addEventListener('DOMContentLoaded', () => {
  const view = HASH_VIEWS[location.hash] || 'forge';
  switchView(view, false);
});

function updateRarityBadge() {
  const rarity = document.getElementById('itemRarity').value;
  const badge = document.getElementById('itemRarityBadge');
  const color = RARITY_COLORS[rarity] || '#9d9d9d';
  badge.textContent = rarity.toUpperCase();
  badge.style.color = color;
  badge.style.borderColor = color;
  badge.style.border = `1px solid ${color}`;
  badge.style.background = `${color}18`;
}

// -----------------------------------------------------------------------
// History
// -----------------------------------------------------------------------

async function loadHistoryList() {
  document.getElementById('historyEntriesList').innerHTML =
    '<p class="text-xs text-gray-600 text-center pt-8">Loading…</p>';
  try {
    const r = await fetch('/api/history');
    historyEntries = await r.json();
    renderHistoryList();
  } catch (e) {
    document.getElementById('historyEntriesList').innerHTML =
      `<p class="text-xs text-red-400 text-center pt-8">Failed to load history</p>`;
  }
}

function filterHistory() {
  renderHistoryList();
}

function setHistoryTag(tag) {
  historyActiveTag = historyActiveTag === tag ? null : tag;
  renderHistoryList();
}

function _buildTagFilters() {
  const container = document.getElementById('historyTagFilters');
  if (!container) return;
  const tags = [...new Set(historyEntries.map(e => e.type))].sort();
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  const allActive = !historyActiveTag;
  allBtn.className = 'text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer';
  allBtn.style.color = allActive ? '#c9a227' : '#8a7560';
  allBtn.style.borderColor = allActive ? '#c9a227' : '#5a3e28';
  allBtn.style.background = allActive ? 'rgba(201,162,39,0.08)' : 'transparent';
  allBtn.textContent = `All (${historyEntries.length})`;
  allBtn.onclick = () => { historyActiveTag = null; renderHistoryList(); };
  container.appendChild(allBtn);

  for (const tag of tags) {
    const count = historyEntries.filter(e => e.type === tag).length;
    const color = _typeColor(tag);
    const isActive = historyActiveTag === tag;
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

function renderHistoryList() {
  _buildTagFilters();

  const container = document.getElementById('historyEntriesList');
  if (historyEntries.length === 0) {
    container.innerHTML =
      '<p class="text-xs text-gray-600 text-center pt-8">No generations yet.<br>Head to NPCs or Items to get started.</p>';
    return;
  }

  const searchQuery = (document.getElementById('historySearch')?.value || '').toLowerCase().trim();
  const sortMode = document.getElementById('historySort')?.value || 'date-desc';
  const docmostFilter = document.getElementById('historyDocmostFilter')?.value || 'all';

  let filtered = historyEntries;
  if (historyActiveTag) {
    filtered = filtered.filter(e => e.type === historyActiveTag);
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
  // date-desc is the default order from the API (already sorted newest-first)

  if (filtered.length === 0) {
    container.innerHTML =
      '<p class="text-xs text-gray-600 text-center pt-4">No matching entries.</p>';
    return;
  }

  container.innerHTML = '';
  for (const entry of filtered) {
    const card = document.createElement('div');
    card.className = 'history-card' + (entry.id === selectedHistoryEntryId ? ' selected' : '');
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

async function openHistoryEntry(entryId) {
  selectedHistoryEntryId = entryId;
  renderHistoryList();

  document.getElementById('historyDetail').classList.add('hidden');
  document.getElementById('historyPlaceholder').classList.remove('hidden');
  document.getElementById('historyPlaceholder').querySelector('p').textContent = 'Loading…';

  try {
    const r = await fetch(`/api/history/${entryId}`);
    if (!r.ok) throw new Error('Entry not found');
    const entry = await r.json();

    selectedHistoryEntryType = entry.type;
    currentHistoryId = entry.id;

    const isItem = entry.type === 'Item';
    const isShop = entry.type === 'Shop';

    if (isItem) {
      currentItem = entry.item;
      currentCharacter = null;
      currentShop = null;
    } else if (isShop) {
      currentShop = entry.shop;
      currentItem = null;
      currentCharacter = null;
    } else {
      currentCharacter = entry.character;
      currentItem = null;
      currentShop = null;
    }

    // Meta line
    let metaHtml = `<span class="font-bold text-parchment">${entry.name}</span>`;
    if (isItem) {
      const rarityColor = RARITY_COLORS[entry.rarity] || '#9d9d9d';
      metaHtml += `<span class="ml-2">${entry.item_type} · <span style="color:${rarityColor}">${entry.rarity}</span> · Levels ${entry.target_level_min}–${entry.target_level_max}</span>`;
    } else if (isShop) {
      metaHtml += `<span class="ml-2">${entry.category} ${entry.shop_type} · ${entry.item_count} items</span>`;
    } else {
      metaHtml += `<span class="ml-2">${entry.character_class} · ${entry.race} · Level ${entry.level} · ${entry.alignment}</span>`;
    }
    metaHtml += `<span class="ml-2 text-gray-600">Generated ${_formatTimestamp(entry.timestamp)}</span>`;
    document.getElementById('historyEntryMeta').innerHTML = metaHtml;

    // Show/hide action bar elements based on entry type
    document.getElementById('historyFoundryBtn').classList.toggle('hidden', isItem || isShop);
    document.getElementById('historySaveFolder').classList.toggle('hidden', isItem || isShop);

    // Docmost link
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
    if (isItem) {
      renderItemSheet(entry.item, historySheet);
    } else if (isShop) {
      _renderShopContent(entry.shop, historySheet);
    } else {
      renderSheet(entry.character, historySheet);
    }
  } catch (e) {
    document.getElementById('historyPlaceholder').querySelector('p').textContent = `Error: ${e.message}`;
  }
}

function _typeColor(type) {
  const map = {
    'Character':   '#c9a227',
    'Generic NPC': '#8a7560',
    'Beast':       '#4a7c59',
    'Location':    '#4a6e9e',
    'Encounter':   '#8b1a1a',
    'Item':        '#a335ee',
    'Shop':        '#2e86ab',
  };
  return map[type] || '#8a7560';
}

function _entrySubtitle(entry) {
  if (entry.type === 'Item') {
    const rarityColor = RARITY_COLORS[entry.rarity] || '#9d9d9d';
    return `${entry.item_type} · <span style="color:${rarityColor}">${entry.rarity}</span> · Lvl ${entry.target_level_min}–${entry.target_level_max}`;
  }
  if (entry.type === 'Shop') {
    return `${entry.category} ${entry.shop_type} · ${entry.item_count ?? '?'} items`;
  }
  return `${entry.character_class} · ${entry.race} · Lvl ${entry.level}`;
}

function _formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

// -----------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------

async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) throw new Error('Failed to load settings');
    const s = await r.json();
    document.getElementById('settingApiKey').value = s.anthropic_api_key || '';
    document.getElementById('settingClaudeModel').value = s.claude_model || '';
    document.getElementById('settingDocmostUrl').value = s.docmost_url || '';
    document.getElementById('settingDocmostUser').value = s.docmost_username || '';
    document.getElementById('settingDocmostPass').value = s.docmost_password || '';
    document.getElementById('settingFolderUrlNpcs').value = s.folder_url_npcs || '';
    document.getElementById('settingFolderUrlBestiary').value = s.folder_url_bestiary || '';
    document.getElementById('settingFolderUrlLocations').value = s.folder_url_locations || '';
    document.getElementById('settingFolderUrlEncounters').value = s.folder_url_encounters || '';
    document.getElementById('settingFolderUrlItems').value = s.folder_url_items || '';
    // Clear any stale test results
    for (const key of ['Npcs', 'Bestiary', 'Locations', 'Encounters', 'Items']) {
      document.getElementById(`testResult${key}`).classList.add('hidden');
    }
  } catch (e) {
    console.error('Could not load settings:', e);
  }
}

async function saveSettings() {
  setBusy('settingsSaveBtn', 'settingsSaveSpinner', 'settingsSaveBtnText', true, 'Saving…');
  const resultEl = document.getElementById('settingsSaveResult');
  resultEl.classList.add('hidden');

  const body = {
    anthropic_api_key: document.getElementById('settingApiKey').value,
    claude_model: document.getElementById('settingClaudeModel').value.trim(),
    docmost_url: document.getElementById('settingDocmostUrl').value.trim(),
    docmost_username: document.getElementById('settingDocmostUser').value.trim(),
    docmost_password: document.getElementById('settingDocmostPass').value,
    folder_url_npcs: document.getElementById('settingFolderUrlNpcs').value.trim(),
    folder_url_bestiary: document.getElementById('settingFolderUrlBestiary').value.trim(),
    folder_url_locations: document.getElementById('settingFolderUrlLocations').value.trim(),
    folder_url_encounters: document.getElementById('settingFolderUrlEncounters').value.trim(),
    folder_url_items: document.getElementById('settingFolderUrlItems').value.trim(),
  };

  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    resultEl.textContent = '✓ Settings saved';
    resultEl.className = 'text-xs text-green-400';
    resultEl.classList.remove('hidden');

    // Refresh the folder dropdowns on the Forge and History tabs
    await loadConfig();
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('settingsSaveBtn', 'settingsSaveSpinner', 'settingsSaveBtnText', false, 'Save Settings');
  }
}

async function testPageUrl(key, inputId) {
  const url = document.getElementById(inputId).value.trim();
  const resultEl = document.getElementById(`testResult${key}`);
  if (!url) {
    resultEl.textContent = 'Enter a URL first.';
    resultEl.className = 'text-xs mt-1 text-gray-500';
    resultEl.classList.remove('hidden');
    return;
  }
  resultEl.textContent = 'Testing…';
  resultEl.className = 'text-xs mt-1 text-gray-500';
  resultEl.classList.remove('hidden');
  try {
    const r = await fetch('/api/settings/test-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (r.ok) {
      resultEl.textContent = `✓ Found: "${data.title}"`;
      resultEl.className = 'text-xs mt-1 text-green-400';
    } else {
      resultEl.textContent = `✗ ${data.detail || 'Not found'}`;
      resultEl.className = 'text-xs mt-1 text-red-400';
    }
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs mt-1 text-red-400';
  }
}

function toggleVisible(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

// -----------------------------------------------------------------------
// Forge: generate
// -----------------------------------------------------------------------

function sign(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function setBusy(btnId, spinnerId, textId, busy, label) {
  const btn = document.getElementById(btnId);
  const spin = document.getElementById(spinnerId);
  const txt = document.getElementById(textId);
  btn.disabled = busy;
  spin.classList.toggle('hidden', !busy);
  txt.textContent = label;
}

async function generateCharacter() {
  const concept = document.getElementById('concept').value.trim();
  const race = document.getElementById('race').value.trim();
  const charClass = document.getElementById('charClass').value;

  if (!concept || !race) {
    alert('Please fill in Concept and Race before generating.');
    return;
  }

  setBusy('generateBtn', 'generateSpinner', 'generateBtnText', true, 'Generating…');
  document.getElementById('characterSheet').classList.add('hidden');
  document.getElementById('placeholder').classList.remove('hidden');
  document.getElementById('saveSection').classList.add('hidden');
  document.getElementById('tokenUsage').classList.add('hidden');

  try {
    const body = {
      concept,
      race,
      character_class: charClass,
      level: parseInt(document.getElementById('level').value),
      alignment: document.getElementById('alignment').value,
      appearance: document.getElementById('appearance').value.trim(),
      background_detail: selectedDetail,
      additional_notes: document.getElementById('notes').value.trim(),
      generic_npc: document.getElementById('genericNpcMode').checked,
    };

    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.detail || 'Generation failed');
    }

    const data = await r.json();
    currentCharacter = data.character;
    currentHistoryId = data.history_id ?? null;
    renderSheet(currentCharacter);
    document.getElementById('saveSection').classList.remove('hidden');
    _showTokenUsage(data.usage);
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    setBusy('generateBtn', 'generateSpinner', 'generateBtnText', false, 'Generate Character');
  }
}

// -----------------------------------------------------------------------
// Save to Docmost
// -----------------------------------------------------------------------

async function saveCharacter() {
  if (!currentCharacter) return;
  const folder = document.getElementById('saveFolder').value;
  setBusy('saveBtn', 'saveSpinner', 'saveBtnText', true, 'Saving…');
  const resultEl = document.getElementById('saveResult');
  resultEl.classList.add('hidden');

  try {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: currentCharacter, folder, history_id: currentHistoryId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    // Update the in-memory history entry so the badge appears if user switches to history
    const entry = historyEntries.find(e => e.id === currentHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }

    resultEl.textContent = `✓ Saved to Docmost (page ${data.page_id})`;
    resultEl.className = 'text-xs text-center py-1 text-green-400';
    resultEl.classList.remove('hidden');
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-center py-1 text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('saveBtn', 'saveSpinner', 'saveBtnText', false, 'Save to Docmost');
  }
}

async function saveFromHistory() {
  const isItem = selectedHistoryEntryType === 'Item';
  const isShop = selectedHistoryEntryType === 'Shop';
  if (isItem ? !currentItem : isShop ? !currentShop : !currentCharacter) return;

  setBusy('historySaveBtn', 'historySaveSpinner', 'historySaveBtnText', true, 'Saving…');
  const resultEl = document.getElementById('historySaveResult');
  resultEl.classList.add('hidden');

  try {
    let endpoint, body;
    if (isItem) {
      endpoint = '/api/save-item';
      body = { item: currentItem, history_id: currentHistoryId };
    } else if (isShop) {
      endpoint = '/api/save-shop';
      body = { shop: currentShop, history_id: currentHistoryId };
    } else {
      endpoint = '/api/save';
      body = { character: currentCharacter, folder: document.getElementById('historySaveFolder').value, history_id: currentHistoryId };
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const now = new Date().toISOString();
    const entry = historyEntries.find(e => e.id === currentHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
      entry.docmost_synced_at = now;
      entry.docmost_out_of_sync = false;
      renderHistoryList();
      _updateHistorySyncStatus(entry);
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

// -----------------------------------------------------------------------
// Docmost sync status
// -----------------------------------------------------------------------

function _updateHistorySyncStatus(entry) {
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

function showResyncWarning() {
  document.getElementById('historyResyncWarning').classList.remove('hidden');
}

function cancelResync() {
  document.getElementById('historyResyncWarning').classList.add('hidden');
}

async function confirmResync() {
  document.getElementById('historyResyncWarning').classList.add('hidden');
  // Temporarily show the save row so setBusy can target historySaveBtn/Spinner/BtnText
  document.getElementById('historySaveRow').classList.remove('hidden');
  await saveFromHistory();
}

// -----------------------------------------------------------------------
// Edit mode
// -----------------------------------------------------------------------

function _escAttr(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }
function _escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _editField(id, label, value, type = 'text') {
  const w = el('div');
  w.innerHTML = `<label class="text-xs text-gray-400 block mb-1">${label}</label>
    <input id="${id}" type="${type}" class="input-field text-sm w-full" value="${_escAttr(value)}" />`;
  return w;
}

function _editTextarea(id, label, value, rows = 3) {
  const w = el('div');
  w.innerHTML = `<label class="text-xs text-gray-400 block mb-1">${label}</label>
    <textarea id="${id}" class="input-field text-sm w-full" rows="${rows}">${_escHtml(value)}</textarea>`;
  return w;
}

function _editSelect(id, label, options, selected) {
  const w = el('div');
  const opts = options.map(o => `<option value="${o}" ${o === selected ? 'selected' : ''}>${o}</option>`).join('');
  w.innerHTML = `<label class="text-xs text-gray-400 block mb-1">${label}</label>
    <select id="${id}" class="input-field text-sm w-full">${opts}</select>`;
  return w;
}

function _sectionLabel(text) {
  const d = el('div', 'text-xs text-gold uppercase font-bold mb-3');
  d.textContent = text;
  return d;
}

// ---- Character edit ----
function _buildCharacterEditForm(c) {
  const form = el('div', 'space-y-4');

  const identity = el('div', 'panel space-y-3');
  identity.appendChild(_sectionLabel('Identity'));
  const idGrid = el('div', 'grid grid-cols-2 gap-3');
  idGrid.appendChild(_editField('edit_name', 'Name', c.name));
  idGrid.appendChild(_editField('edit_background', 'Background', c.background));
  identity.appendChild(idGrid);
  identity.appendChild(_editTextarea('edit_appearance', 'Appearance', c.appearance, 2));
  form.appendChild(identity);

  const pers = el('div', 'panel space-y-3');
  pers.appendChild(_sectionLabel('Personality'));
  pers.appendChild(_editTextarea('edit_personality_traits', 'Traits', c.personality_traits, 2));
  pers.appendChild(_editTextarea('edit_ideals', 'Ideals', c.ideals, 2));
  pers.appendChild(_editTextarea('edit_bonds', 'Bonds', c.bonds, 2));
  pers.appendChild(_editTextarea('edit_flaws', 'Flaws', c.flaws, 2));
  form.appendChild(pers);

  const story = el('div', 'panel space-y-3');
  story.appendChild(_sectionLabel('Backstory'));
  story.appendChild(_editTextarea('edit_backstory', '', c.backstory, 6));
  form.appendChild(story);

  const eq = el('div', 'panel space-y-3');
  eq.appendChild(_sectionLabel('Equipment'));
  const hint = el('div', 'text-xs text-gray-600 -mt-1 mb-1', 'One item per line');
  eq.appendChild(hint);
  eq.appendChild(_editTextarea('edit_equipment', '', (c.equipment || []).join('\n'), 4));
  form.appendChild(eq);

  return form;
}

function _collectCharacterEdits() {
  return {
    name: document.getElementById('edit_name').value.trim(),
    background: document.getElementById('edit_background').value.trim(),
    appearance: document.getElementById('edit_appearance').value.trim(),
    personality_traits: document.getElementById('edit_personality_traits').value.trim(),
    ideals: document.getElementById('edit_ideals').value.trim(),
    bonds: document.getElementById('edit_bonds').value.trim(),
    flaws: document.getElementById('edit_flaws').value.trim(),
    backstory: document.getElementById('edit_backstory').value.trim(),
    equipment: document.getElementById('edit_equipment').value.split('\n').map(s => s.trim()).filter(Boolean),
  };
}

// ---- Item edit ----
function _makeBonusRow(stat, value) {
  const row = el('div', 'flex items-center gap-2');
  row.innerHTML = `
    <input type="text" placeholder="Stat (e.g. Strength)" class="input-field text-xs edit-bonus-stat flex-1" value="${_escAttr(stat)}" />
    <input type="number" class="input-field text-xs edit-bonus-val w-20" value="${_escAttr(value)}" />
    <button class="text-red-500 hover:text-red-300 px-1 text-sm leading-none" onclick="this.parentElement.remove()">×</button>`;
  return row;
}

function _makeAbilityRow(a) {
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

function _buildItemEditForm(item) {
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

function _collectItemEdits() {
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

// ---- Shop edit ----
function _makeShopItemRow(item) {
  const row = el('div', 'panel py-2 px-3 space-y-2 edit-shop-item-row');
  const rarities = ['Common','Uncommon','Rare','Epic','Legendary'];
  row.innerHTML = `
    <div class="grid grid-cols-4 gap-2">
      <input type="text" placeholder="Name" class="input-field text-xs edit-si-name col-span-2" value="${_escAttr(item.name)}" />
      <input type="text" placeholder="Type" class="input-field text-xs edit-si-type" value="${_escAttr(item.item_type)}" />
      <select class="input-field text-xs edit-si-rarity">
        ${rarities.map(r => `<option ${item.rarity===r?'selected':''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="grid grid-cols-4 gap-2 items-center">
      <div class="flex items-center gap-1"><input type="number" placeholder="gp" class="input-field text-xs edit-si-price flex-1" value="${item.price_gp??''}" /><span class="text-xs text-gray-500">gp</span></div>
      <div class="flex items-center gap-1.5"><input type="checkbox" class="edit-si-under" ${item.is_under_table?'checked':''} /><span class="text-xs text-gray-400">Under table</span></div>
      <input type="text" placeholder="Concept" class="input-field text-xs edit-si-concept" value="${_escAttr(item.concept||'')}" />
      <button class="text-red-500 hover:text-red-300 text-xs text-right" onclick="this.closest('.edit-shop-item-row').remove()">Remove</button>
    </div>
    <textarea placeholder="Description" class="input-field text-xs w-full edit-si-desc" rows="2">${_escHtml(item.description)}</textarea>`;
  return row;
}

function _buildShopEditForm(shop) {
  const form = el('div', 'space-y-4');

  const shopPanel = el('div', 'panel space-y-3');
  shopPanel.appendChild(_sectionLabel('Shop Details'));
  const r1 = el('div', 'grid grid-cols-3 gap-3');
  r1.appendChild(_editField('edit_shop_name', 'Name', shop.name));
  r1.appendChild(_editField('edit_shop_category', 'Category', shop.category));
  r1.appendChild(_editSelect('edit_shop_type', 'Type', ['building','stall','cart','ship','cave'], shop.shop_type));
  shopPanel.appendChild(r1);
  shopPanel.appendChild(_editTextarea('edit_shop_description', 'Description', shop.description, 3));
  shopPanel.appendChild(_editTextarea('edit_shop_atmosphere', 'Atmosphere', shop.atmosphere || '', 2));
  form.appendChild(shopPanel);

  const sk = shop.shopkeeper;
  const skPanel = el('div', 'panel space-y-3');
  skPanel.appendChild(_sectionLabel('Shopkeeper'));
  const skr1 = el('div', 'grid grid-cols-4 gap-3');
  skr1.appendChild(_editField('edit_sk_name', 'Name', sk.name));
  skr1.appendChild(_editField('edit_sk_race', 'Race', sk.race));
  skr1.appendChild(_editField('edit_sk_class', 'Class', sk.character_class));
  skr1.appendChild(_editField('edit_sk_gender', 'Gender', sk.gender || ''));
  skPanel.appendChild(skr1);
  skPanel.appendChild(_editTextarea('edit_sk_appearance', 'Appearance', sk.appearance, 2));
  skPanel.appendChild(_editTextarea('edit_sk_personality', 'Personality', sk.personality, 2));
  skPanel.appendChild(_editTextarea('edit_sk_motivation', 'Motivation', sk.motivation || '', 2));
  form.appendChild(skPanel);

  const itemsPanel = el('div', 'panel space-y-3');
  itemsPanel.appendChild(_sectionLabel('Stock'));
  const itemsCont = el('div', 'space-y-2');
  itemsCont.id = 'edit_shop_items';
  for (const item of (shop.items || [])) itemsCont.appendChild(_makeShopItemRow(item));
  itemsPanel.appendChild(itemsCont);
  const addItem = el('button', 'btn-secondary text-xs py-1 px-3 mt-1', '+ Add Item');
  addItem.onclick = () => document.getElementById('edit_shop_items').appendChild(
    _makeShopItemRow({name:'',item_type:'',rarity:'Common',price_gp:null,description:'',is_under_table:false,concept:''})
  );
  itemsPanel.appendChild(addItem);
  form.appendChild(itemsPanel);

  return form;
}

function _collectShopEdits() {
  const items = [...document.querySelectorAll('.edit-shop-item-row')].map(r => ({
    name: r.querySelector('.edit-si-name').value.trim(),
    item_type: r.querySelector('.edit-si-type').value.trim(),
    rarity: r.querySelector('.edit-si-rarity').value,
    price_gp: parseInt(r.querySelector('.edit-si-price').value) || null,
    description: r.querySelector('.edit-si-desc').value.trim(),
    is_under_table: r.querySelector('.edit-si-under').checked,
    concept: r.querySelector('.edit-si-concept').value.trim(),
  }));
  return {
    name: document.getElementById('edit_shop_name').value.trim(),
    shop_type: document.getElementById('edit_shop_type').value,
    category: document.getElementById('edit_shop_category').value.trim(),
    description: document.getElementById('edit_shop_description').value.trim(),
    atmosphere: document.getElementById('edit_shop_atmosphere').value.trim(),
    shopkeeper: {
      name: document.getElementById('edit_sk_name').value.trim(),
      race: document.getElementById('edit_sk_race').value.trim(),
      character_class: document.getElementById('edit_sk_class').value.trim(),
      gender: document.getElementById('edit_sk_gender').value.trim(),
      appearance: document.getElementById('edit_sk_appearance').value.trim(),
      personality: document.getElementById('edit_sk_personality').value.trim(),
      motivation: document.getElementById('edit_sk_motivation').value.trim(),
      concept: currentShop?.shopkeeper?.concept || '',
    },
    items,
  };
}

// ---- Edit mode orchestration ----
function enterEditMode() {
  document.getElementById('historyViewButtons').classList.add('hidden');
  document.getElementById('historyEditButtons').classList.remove('hidden');
  document.getElementById('historySaveRow').classList.add('hidden');
  document.getElementById('historySyncStatus').classList.add('hidden');
  document.getElementById('historyResyncWarning').classList.add('hidden');
  document.getElementById('historySaveResult').classList.add('hidden');

  const sheet = document.getElementById('historySheet');
  sheet.innerHTML = '';
  if (selectedHistoryEntryType === 'Item') {
    sheet.appendChild(_buildItemEditForm(currentItem));
  } else if (selectedHistoryEntryType === 'Shop') {
    sheet.appendChild(_buildShopEditForm(currentShop));
  } else {
    sheet.appendChild(_buildCharacterEditForm(currentCharacter));
  }
}

function exitEditMode(reRender = true) {
  document.getElementById('historyViewButtons').classList.remove('hidden');
  document.getElementById('historyEditButtons').classList.add('hidden');

  if (reRender) {
    const sheet = document.getElementById('historySheet');
    sheet.innerHTML = '';
    if (selectedHistoryEntryType === 'Item') renderItemSheet(currentItem, sheet);
    else if (selectedHistoryEntryType === 'Shop') _renderShopContent(currentShop, sheet);
    else renderSheet(currentCharacter, sheet);
  }

  const entry = historyEntries.find(e => e.id === currentHistoryId);
  if (entry) _updateHistorySyncStatus(entry);
}

async function saveEdit() {
  let updates;
  if (selectedHistoryEntryType === 'Item') updates = _collectItemEdits();
  else if (selectedHistoryEntryType === 'Shop') updates = _collectShopEdits();
  else updates = _collectCharacterEdits();

  const btn = document.getElementById('historyEditSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Saving…';

  try {
    const r = await fetch(`/api/history/${currentHistoryId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    // Merge updates into in-memory current object
    if (selectedHistoryEntryType === 'Item') currentItem = { ...currentItem, ...updates };
    else if (selectedHistoryEntryType === 'Shop') currentShop = { ...currentShop, ...updates };
    else currentCharacter = { ...currentCharacter, ...updates };

    // Update in-memory history list entry metadata
    const entry = historyEntries.find(e => e.id === currentHistoryId);
    if (entry) {
      if (updates.name) entry.name = updates.name;
      if (updates.item_type) entry.item_type = updates.item_type;
      if (updates.rarity) entry.rarity = updates.rarity;
      if (updates.shop_type) entry.shop_type = updates.shop_type;
      if (updates.category) entry.category = updates.category;
      if (updates.items) entry.item_count = updates.items.length;
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

// -----------------------------------------------------------------------
// Export: PDF
// -----------------------------------------------------------------------

function exportToPDF() {
  if (!currentCharacter) return;
  window.print();
}

// -----------------------------------------------------------------------
// Export: Foundry VTT (dnd5e system 3.x actor format)
// -----------------------------------------------------------------------

function exportToFoundryJSON() {
  if (!currentCharacter) return;
  const c = currentCharacter;

  const abilityMap = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
  const skillMap = {
    acrobatics: { abbr: 'acr', ability: 'dex' }, animal_handling: { abbr: 'ani', ability: 'wis' },
    arcana: { abbr: 'arc', ability: 'int' }, athletics: { abbr: 'ath', ability: 'str' },
    deception: { abbr: 'dec', ability: 'cha' }, history: { abbr: 'his', ability: 'int' },
    insight: { abbr: 'ins', ability: 'wis' }, intimidation: { abbr: 'itm', ability: 'cha' },
    investigation: { abbr: 'inv', ability: 'int' }, medicine: { abbr: 'med', ability: 'wis' },
    nature: { abbr: 'nat', ability: 'int' }, perception: { abbr: 'prc', ability: 'wis' },
    performance: { abbr: 'prf', ability: 'cha' }, persuasion: { abbr: 'per', ability: 'cha' },
    religion: { abbr: 'rel', ability: 'int' }, sleight_of_hand: { abbr: 'slt', ability: 'dex' },
    stealth: { abbr: 'ste', ability: 'dex' }, survival: { abbr: 'sur', ability: 'wis' },
  };

  const abilities = {};
  for (const [full, abbr] of Object.entries(abilityMap)) {
    const a = c.ability_scores[full];
    const st = c.saving_throws[full];
    abilities[abbr] = {
      value: a.total,
      proficient: st.proficient ? 1 : 0,
      bonuses: { check: '', save: '' },
    };
  }

  const skills = {};
  for (const [full, { abbr, ability }] of Object.entries(skillMap)) {
    const sk = c.skills[full];
    skills[abbr] = {
      value: sk.expertise ? 2 : sk.proficient ? 1 : 0,
      ability,
      bonuses: { check: '', passive: '' },
    };
  }

  const spells = {};
  for (let i = 1; i <= 9; i++) {
    const count = c.spellcasting ? (c.spellcasting.spell_slots[`level_${i}`] || 0) : 0;
    spells[`spell${i}`] = { value: count, override: null, max: count };
  }
  spells.spell0 = { value: 0, override: null };

  const items = [];
  for (const atk of (c.attacks || [])) {
    const dmgMatch = atk.damage_dice.match(/(\d+)d(\d+)/);
    const dmgNum = dmgMatch ? parseInt(dmgMatch[1]) : 1;
    const dmgDen = dmgMatch ? parseInt(dmgMatch[2]) : 6;
    const isMelee = !atk.range || atk.range === '5 ft.' || atk.range.startsWith('5');
    const actionType = isMelee ? 'mwak' : 'rwak';
    const abilityUsed = (atk.attack_bonus.ability_used || 'STR').toLowerCase().substring(0, 3);

    items.push({
      name: atk.name,
      type: 'weapon',
      img: 'icons/svg/sword.svg',
      system: {
        description: { value: atk.notes || '' },
        quantity: 1,
        equipped: true,
        identified: true,
        rarity: 'common',
        activation: { type: 'action', cost: 1, condition: '' },
        range: { value: isMelee ? 5 : parseInt(atk.range) || 30, units: 'ft' },
        ability: abilityUsed,
        actionType,
        attack: { bonus: '', flat: false },
        critical: { threshold: null, damage: '' },
        damage: {
          base: {
            number: dmgNum, denomination: dmgDen,
            bonus: atk.damage_bonus ? String(atk.damage_bonus) : '',
            types: [atk.damage_type?.toLowerCase() || 'slashing'],
            custom: { enabled: false, formula: '' },
          },
        },
        properties: atk.properties ? atk.properties.map(p => p.toLowerCase().replace(/[^a-z]/g, '')) : [],
      },
    });
  }

  if (c.spellcasting) {
    const schoolAbbr = { abjuration:'abj', conjuration:'con', divination:'div', enchantment:'enc', evocation:'evo', illusion:'ill', necromancy:'nec', transmutation:'trs' };
    const allSpells = [...(c.spellcasting.cantrips || []), ...(c.spellcasting.spells_known || [])];
    for (const spell of allSpells) {
      const school = schoolAbbr[spell.school?.toLowerCase()] || 'evo';
      items.push({
        name: spell.name,
        type: 'spell',
        img: 'icons/svg/daze.svg',
        system: {
          description: { value: spell.description || '' },
          level: spell.level,
          school,
          activation: { type: 'action', cost: 1, condition: '' },
          duration: { value: spell.duration || '', units: '' },
          range: { value: null, units: spell.range || '' },
          components: {
            vocal: spell.components?.includes('V') || false,
            somatic: spell.components?.includes('S') || false,
            material: spell.components?.includes('M') || false,
          },
          preparation: { mode: 'prepared', prepared: true },
          save: { ability: '', dc: null, scaling: 'spell' },
        },
      });
    }
  }

  for (const feat of (c.features_and_traits || [])) {
    items.push({
      name: feat.name,
      type: 'feat',
      img: 'icons/svg/upgrade.svg',
      system: {
        description: { value: feat.description || '' },
        activation: { type: '', cost: null, condition: '' },
        type: { value: 'class', subtype: '' },
        requirements: feat.source || '',
      },
    });
  }

  for (const item of (c.equipment || [])) {
    const isWeapon = (c.attacks || []).some(a => item.toLowerCase().includes(a.name.toLowerCase()));
    if (!isWeapon) {
      items.push({
        name: item,
        type: 'loot',
        img: 'icons/svg/item-bag.svg',
        system: { description: { value: '' }, quantity: 1, equipped: false, identified: true, rarity: 'common' },
      });
    }
  }

  const biographyHtml = `<p>${(c.backstory || '').replace(/\n/g, '</p><p>')}</p>` +
    `<h2>Appearance</h2><p>${c.appearance || ''}</p>`;

  const actor = {
    name: c.name,
    type: 'npc',
    img: 'icons/svg/mystery-man.svg',
    system: {
      abilities,
      attributes: {
        ac: { flat: c.armor_class.total, calc: 'flat', formula: '' },
        hp: { value: c.hit_points.maximum, min: 0, max: c.hit_points.maximum, temp: 0, tempmax: 0 },
        init: { ability: 'dex', bonus: '' },
        movement: { burrow: 0, climb: 0, fly: 0, swim: 0, walk: c.speed || 30, units: 'ft', hover: false },
        senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, units: 'ft', special: '' },
        spellcasting: c.spellcasting ? abilityMap[Object.keys(abilityMap).find(k => abilityMap[k] === (c.spellcasting.ability || '').toLowerCase().substring(0,3)) || 'intelligence'] : '',
        death: { success: 0, failure: 0 },
        exhaustion: 0,
        inspiration: false,
      },
      details: {
        biography: { value: biographyHtml, public: '' },
        alignment: c.alignment || '',
        race: { value: c.race || '' },
        background: { value: c.background || '' },
        appearance: c.appearance || '',
        trait: c.personality_traits || '',
        ideal: c.ideals || '',
        bond: c.bonds || '',
        flaw: c.flaws || '',
        cr: _levelToCR(c.level),
        xp: { value: _crToXP(_levelToCR(c.level)) },
      },
      traits: {
        size: 'med',
        languages: {
          value: (c.proficiencies?.languages || []).map(l => l.toLowerCase()),
          custom: '',
        },
        di: { value: [], bypasses: [], custom: '' },
        dr: { value: [], bypasses: [], custom: '' },
        dv: { value: [], bypasses: [], custom: '' },
        ci: { value: [], custom: '' },
      },
      skills,
      spells,
      bonuses: {
        mwak: { attack: '', damage: '' },
        rwak: { attack: '', damage: '' },
        msak: { attack: '', damage: '' },
        rsak: { attack: '', damage: '' },
        abilities: { check: '', save: '', skill: '' },
        spell: { dc: '' },
      },
      currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    },
    items,
    effects: [],
    flags: { 'niswins-tavern': { generated: true, level: c.level, characterClass: c.character_class } },
    prototypeToken: {
      name: c.name,
      displayName: 20,
      actorLink: false,
      disposition: 0,
      displayBars: 20,
      bar1: { attribute: 'attributes.hp' },
    },
  };

  const blob = new Blob([JSON.stringify(actor, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${c.name.replace(/[^a-z0-9]/gi, '_')}_foundry.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function _levelToCR(level) {
  const map = {1:0.25,2:0.5,3:1,4:1,5:2,6:2,7:3,8:3,9:4,10:4,11:5,12:5,13:6,14:6,15:7,16:7,17:8,18:8,19:9,20:10};
  return map[level] || 1;
}

function _crToXP(cr) {
  const map = {0:10,0.125:25,0.25:50,0.5:100,1:200,2:450,3:700,4:1100,5:1800,6:2300,7:2900,8:3900,9:5000,10:5900};
  return map[cr] || 200;
}

// -----------------------------------------------------------------------
// Token usage display
// -----------------------------------------------------------------------

function _showTokenUsage(usage, elementId = 'tokenUsage') {
  const el = document.getElementById(elementId);
  if (!el || !usage) return;
  const costStr = usage.cost_usd < 0.001
    ? `< $0.001`
    : `$${usage.cost_usd.toFixed(4)}`;
  el.innerHTML = `
    <span title="Input tokens">${usage.input_tokens.toLocaleString()} in</span>
    <span class="text-gray-600">/</span>
    <span title="Output tokens">${usage.output_tokens.toLocaleString()} out</span>
    <span class="text-gray-600">·</span>
    <span title="Estimated cost (${usage.model})" class="text-gold">${costStr}</span>
  `;
  el.classList.remove('hidden');
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function sectionHeader(title) {
  return el('div', 'section-header mt-4', title);
}

function renderSheet(c, containerEl) {
  const sheet = containerEl || document.getElementById('characterSheet');
  sheet.innerHTML = '';

  if (!containerEl) {
    document.getElementById('placeholder').classList.add('hidden');
    document.getElementById('characterSheet').classList.remove('hidden');
  }

  // -- Name & identity bar --
  const header = el('div', 'panel');
  header.innerHTML = `
    <h2 class="text-3xl font-bold text-gold mb-1">${c.name}</h2>
    <div class="flex flex-wrap gap-2 text-sm">
      <span class="source-tag">${c.race}${c.subrace ? ' · '+c.subrace : ''}</span>
      <span class="source-tag">${c.character_class}${c.subclass ? ' · '+c.subclass : ''}</span>
      <span class="source-tag">Level ${c.level}</span>
      <span class="source-tag">${c.background}</span>
      <span class="source-tag">${c.alignment}</span>
    </div>
    <p class="text-sm text-gray-300 mt-2 italic">${c.appearance}</p>
  `;
  sheet.appendChild(header);

  // -- Core combat row --
  sheet.appendChild(sectionHeader('Core Stats'));
  const coreGrid = el('div', 'grid grid-cols-2 md:grid-cols-4 gap-3');

  coreGrid.appendChild(renderCoreBox('Armour Class', c.armor_class.total, renderACBreakdown(c.armor_class)));
  coreGrid.appendChild(renderCoreBox('Hit Points', c.hit_points.maximum, `<span class="breakdown-text">${c.hit_points.formula}</span>`));
  coreGrid.appendChild(renderCoreBox('Speed', `${c.speed} ft.`, ''));
  coreGrid.appendChild(renderCoreBox('Initiative', sign(c.initiative), `<span class="breakdown-text">${c.initiative_breakdown}</span>`));
  coreGrid.appendChild(renderCoreBox('Proficiency', sign(c.proficiency_bonus), `<span class="breakdown-text">Level ${c.level}</span>`));
  coreGrid.appendChild(renderCoreBox('Passive Perception', c.passive_perception, `<span class="breakdown-text">${c.passive_perception_breakdown}</span>`));
  coreGrid.appendChild(renderCoreBox('Hit Die', c.hit_points.hit_die, ''));
  sheet.appendChild(coreGrid);

  // -- Ability scores --
  sheet.appendChild(sectionHeader('<i class="fa-solid fa-brain mr-1.5"></i>Ability Scores'));
  const abilityGrid = el('div', 'grid grid-cols-3 md:grid-cols-6 gap-2');
  const abilities = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  const abbrMap = {strength:'STR',dexterity:'DEX',constitution:'CON',intelligence:'INT',wisdom:'WIS',charisma:'CHA'};
  const abilityIconMap = {
    strength:     'fa-hand-fist',
    dexterity:    'fa-feather',
    constitution: 'fa-heart-pulse',
    intelligence: 'fa-book-open',
    wisdom:       'fa-eye',
    charisma:     'fa-masks-theater',
  };

  for (const name of abilities) {
    const a = c.ability_scores[name];
    const box = el('div', 'stat-box');
    box.innerHTML = `
      <div class="text-xs text-gold font-bold"><i class="fa-solid ${abilityIconMap[name]} mr-1"></i>${abbrMap[name]}</div>
      <div class="text-2xl font-bold text-parchment">${sign(a.modifier)}</div>
      <div class="text-lg font-bold text-gray-200">${a.total}</div>
      <div class="text-xs text-gray-500 mt-1 space-y-0.5">
        <div>Base <span class="text-parchment">${a.base}</span></div>
        ${a.racial_bonus ? `<div>Race <span class="text-gold">${sign(a.racial_bonus)}</span></div>` : ''}
        ${a.other_bonus ? `<div title="${a.other_bonus_source}">${a.other_bonus_source.substring(0,10)} <span class="text-blue-400">${sign(a.other_bonus)}</span></div>` : ''}
      </div>
    `;
    abilityGrid.appendChild(box);
  }
  sheet.appendChild(abilityGrid);

  // -- Saving throws + Skills side by side --
  sheet.appendChild(sectionHeader('<i class="fa-solid fa-chart-bar mr-1.5"></i>Saving Throws & Skills'));
  const twoCol = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-4');

  // Saving throws
  const savesPanel = el('div', 'panel');
  savesPanel.innerHTML = '<div class="text-xs text-gold uppercase font-bold mb-2"><i class="fa-solid fa-shield-halved mr-1"></i>Saving Throws</div>';
  const saveNames = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  for (const name of saveNames) {
    const st = c.saving_throws[name];
    const row = el('div', 'flex items-center justify-between py-0.5 border-b border-panelbg');
    row.innerHTML = `
      <div class="flex items-center gap-1.5">
        <span class="${st.proficient ? 'text-gold' : 'text-gray-600'} text-xs">●</span>
        <span class="text-xs text-parchment">${abbrMap[name]}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="breakdown-text">${st.breakdown}</span>
        <span class="text-parchment font-bold w-8 text-right">${sign(st.total)}</span>
      </div>
    `;
    savesPanel.appendChild(row);
  }
  twoCol.appendChild(savesPanel);

  // Skills
  const skillsPanel = el('div', 'panel');
  skillsPanel.innerHTML = '<div class="text-xs text-gold uppercase font-bold mb-2"><i class="fa-solid fa-star mr-1"></i>Skills <span class="text-gray-600 font-normal normal-case">(● prof, ●● expertise)</span></div>';
  const skillList = [
    ['acrobatics','Acrobatics'],['animal_handling','Animal Handling'],['arcana','Arcana'],
    ['athletics','Athletics'],['deception','Deception'],['history','History'],
    ['insight','Insight'],['intimidation','Intimidation'],['investigation','Investigation'],
    ['medicine','Medicine'],['nature','Nature'],['perception','Perception'],
    ['performance','Performance'],['persuasion','Persuasion'],['religion','Religion'],
    ['sleight_of_hand','Sleight of Hand'],['stealth','Stealth'],['survival','Survival'],
  ];
  for (const [key, label] of skillList) {
    const sk = c.skills[key];
    const row = el('div', 'flex items-center justify-between py-0.5 border-b border-panelbg');
    const dotColor = sk.expertise ? 'text-blue-400' : sk.proficient ? 'text-gold' : 'text-gray-600';
    const dot = sk.expertise ? '●●' : '●';
    row.innerHTML = `
      <div class="flex items-center gap-1.5">
        <span class="${dotColor} text-xs leading-none">${dot}</span>
        <span class="text-xs text-parchment">${label}</span>
        <span class="text-xs text-gray-600">${sk.ability}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="breakdown-text hidden md:block">${sk.breakdown}</span>
        <span class="text-parchment font-bold w-8 text-right">${sign(sk.total)}</span>
      </div>
    `;
    skillsPanel.appendChild(row);
  }
  twoCol.appendChild(skillsPanel);
  sheet.appendChild(twoCol);

  // -- Attacks --
  if (c.attacks && c.attacks.length) {
    sheet.appendChild(sectionHeader('<i class="fa-solid fa-khanda mr-1.5"></i>Attacks'));
    const attacksPanel = el('div', 'panel overflow-x-auto');
    const table = el('table', 'w-full text-xs border-collapse');
    table.innerHTML = `
      <thead>
        <tr class="text-gold text-left">
          <th class="pb-1 pr-3"><i class="fa-solid fa-khanda mr-1"></i>Weapon</th>
          <th class="pb-1 pr-3">To Hit</th>
          <th class="pb-1 pr-3">Breakdown</th>
          <th class="pb-1 pr-3"><i class="fa-solid fa-droplet mr-1 text-red-500"></i>Damage</th>
          <th class="pb-1 pr-3">Type</th>
          <th class="pb-1 pr-3">Range</th>
          <th class="pb-1">Notes</th>
        </tr>
      </thead>
      <tbody id="attacksBody"></tbody>
    `;
    const tbody = table.querySelector('#attacksBody');
    for (const atk of c.attacks) {
      const dmg = atk.damage_bonus
        ? `${atk.damage_dice} ${sign(atk.damage_bonus)} <span class="breakdown-text">(${atk.damage_bonus_source})</span>`
        : atk.damage_dice;
      const tr = el('tr', 'border-t border-panelbg');
      tr.innerHTML = `
        <td class="py-1 pr-3 font-bold text-parchment">${atk.name}</td>
        <td class="py-1 pr-3 font-bold text-gold">${sign(atk.attack_bonus.total)}</td>
        <td class="py-1 pr-3 breakdown-text">${atk.attack_bonus.breakdown}</td>
        <td class="py-1 pr-3">${dmg}</td>
        <td class="py-1 pr-3 text-gray-400">${atk.damage_type}</td>
        <td class="py-1 pr-3 text-gray-400">${atk.range}</td>
        <td class="py-1 text-gray-500">${atk.notes || '—'}</td>
      `;
      tbody.appendChild(tr);
    }
    attacksPanel.appendChild(table);
    sheet.appendChild(attacksPanel);
  }

  // -- Spellcasting --
  if (c.spellcasting) {
    const sp = c.spellcasting;
    sheet.appendChild(sectionHeader('Spellcasting'));
    const spPanel = el('div', 'panel space-y-3');

    spPanel.innerHTML = `
      <div class="grid grid-cols-3 gap-3 text-center text-xs">
        <div class="stat-box">
          <div class="text-gold font-bold">Ability</div>
          <div class="text-lg font-bold">${sp.ability}</div>
          <div class="breakdown-text">${sign(sp.ability_modifier)}</div>
        </div>
        <div class="stat-box">
          <div class="text-gold font-bold"><i class="fa-solid fa-khanda mr-1"></i>Spell Attack</div>
          <div class="text-lg font-bold">${sign(sp.spell_attack_bonus)}</div>
          <div class="breakdown-text">${sp.spell_attack_breakdown}</div>
        </div>
        <div class="stat-box">
          <div class="text-gold font-bold">Save DC</div>
          <div class="text-lg font-bold">${sp.spell_save_dc}</div>
          <div class="breakdown-text">${sp.spell_save_breakdown}</div>
        </div>
      </div>
    `;

    const slots = sp.spell_slots;
    const slotEntries = [1,2,3,4,5,6,7,8,9]
      .map(i => [i, slots[`level_${i}`]])
      .filter(([,v]) => v > 0);
    if (slotEntries.length) {
      const slotDiv = el('div');
      slotDiv.innerHTML = '<div class="text-xs text-gold mb-1">Spell Slots</div>';
      const slotGrid = el('div', 'flex flex-wrap gap-2');
      for (const [lvl, count] of slotEntries) {
        slotGrid.innerHTML += `<div class="stat-box px-3"><div class="text-xs text-gray-400">Lvl ${lvl}</div><div class="font-bold">${count}</div></div>`;
      }
      slotDiv.appendChild(slotGrid);
      spPanel.appendChild(slotDiv);
    }

    if (sp.cantrips && sp.cantrips.length) {
      spPanel.appendChild(renderSpellList('Cantrips', sp.cantrips));
    }
    if (sp.spells_known && sp.spells_known.length) {
      spPanel.appendChild(renderSpellList('Spells Known', sp.spells_known));
    }

    sheet.appendChild(spPanel);
  }

  // -- Features & Traits --
  if (c.features_and_traits && c.features_and_traits.length) {
    sheet.appendChild(sectionHeader('Features & Traits'));
    const featPanel = el('div', 'panel space-y-3');
    for (const feat of c.features_and_traits) {
      const f = el('div', 'border-l-2 border-gold pl-3');
      f.innerHTML = `
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-sm font-bold text-parchment">${feat.name}</span>
          <span class="source-tag">${feat.source}</span>
        </div>
        <p class="text-xs text-gray-300 leading-relaxed">${feat.description}</p>
      `;
      featPanel.appendChild(f);
    }
    sheet.appendChild(featPanel);
  }

  // -- Proficiencies --
  sheet.appendChild(sectionHeader('Proficiencies & Languages'));
  const profPanel = el('div', 'panel grid grid-cols-2 md:grid-cols-4 gap-3 text-xs');
  const profGroups = [
    ['Armour', c.proficiencies.armor],
    ['Weapons', c.proficiencies.weapons],
    ['Tools', c.proficiencies.tools],
    ['Languages', c.proficiencies.languages],
  ];
  for (const [label, items] of profGroups) {
    const g = el('div');
    g.innerHTML = `<div class="text-gold font-bold mb-1">${label}</div>`;
    if (items && items.length) {
      g.innerHTML += items.map(i => `<div class="text-gray-300">• ${i}</div>`).join('');
    } else {
      g.innerHTML += '<div class="text-gray-600">—</div>';
    }
    profPanel.appendChild(g);
  }
  sheet.appendChild(profPanel);

  // -- Equipment --
  sheet.appendChild(sectionHeader('Equipment'));
  const eqPanel = el('div', 'panel');
  eqPanel.innerHTML = `<ul class="text-sm text-gray-300 columns-2 gap-4">${
    c.equipment.map(i => `<li>• ${i}</li>`).join('')
  }</ul>`;
  sheet.appendChild(eqPanel);

  // -- Personality --
  sheet.appendChild(sectionHeader('Personality'));
  const persPanel = el('div', 'panel grid grid-cols-2 gap-3 text-xs');
  const persFields = [
    ['Traits', c.personality_traits],
    ['Ideals', c.ideals],
    ['Bonds', c.bonds],
    ['Flaws', c.flaws],
  ];
  for (const [label, text] of persFields) {
    const p = el('div');
    p.innerHTML = `<div class="text-gold font-bold mb-1">${label}</div><p class="text-gray-300 leading-relaxed">${text}</p>`;
    persPanel.appendChild(p);
  }
  sheet.appendChild(persPanel);

  // -- Backstory --
  sheet.appendChild(sectionHeader('Backstory'));
  const storyPanel = el('div', 'panel');
  storyPanel.innerHTML = `<p class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">${c.backstory}</p>`;
  sheet.appendChild(storyPanel);
}

// -----------------------------------------------------------------------
// Sub-renderers
// -----------------------------------------------------------------------

function renderCoreBox(label, value, sub) {
  const box = el('div', 'stat-box');
  box.innerHTML = `
    <div class="text-xs text-gold font-bold">${label}</div>
    <div class="text-2xl font-bold text-parchment">${value}</div>
    ${sub ? `<div class="text-xs mt-0.5">${sub}</div>` : ''}
  `;
  return box;
}

function renderACBreakdown(ac) {
  const parts = ac.components.map(c => {
    const colorMap = {
      armor: 'text-blue-400', shield: 'text-green-400',
      dex: 'text-yellow-400', magic: 'text-purple-400',
      base: 'text-gray-400', ability: 'text-orange-400', other: 'text-gray-400',
    };
    const col = colorMap[c.type] || 'text-gray-400';
    return `<span class="${col}" title="${c.type}">${c.source}: ${c.value}</span>`;
  });
  return `<span class="breakdown-text text-xs">${parts.join(' + ')}</span>`;
}

function renderSpellList(title, spells) {
  const wrap = el('div');
  wrap.innerHTML = `<div class="text-xs text-gold mb-1">${title}</div>`;
  const grouped = {};
  for (const s of spells) {
    const lvl = s.level === 0 ? 'Cantrip' : `Level ${s.level}`;
    if (!grouped[lvl]) grouped[lvl] = [];
    grouped[lvl].push(s);
  }
  for (const [lvl, list] of Object.entries(grouped)) {
    const g = el('div', 'mb-2');
    g.innerHTML = `<div class="text-xs text-gray-500 mb-1">${lvl}</div>`;
    for (const s of list) {
      const sp = el('div', 'border-l border-panelbg pl-2 mb-1');
      sp.innerHTML = `
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-bold text-parchment">${s.name}</span>
          <span class="source-tag">${s.school}</span>
          <span class="breakdown-text">${s.casting_time} · ${s.range} · ${s.duration}</span>
        </div>
        <div class="text-xs text-gray-400">${s.components}</div>
        <p class="text-xs text-gray-500 mt-0.5">${s.description}</p>
      `;
      g.appendChild(sp);
    }
    wrap.appendChild(g);
  }
  return wrap;
}

// -----------------------------------------------------------------------
// Item Forge: generate
// -----------------------------------------------------------------------

async function generateItem() {
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
    currentItem = data.item;
    currentItemHistoryId = data.history_id ?? null;

    document.getElementById('itemPlaceholder').classList.add('hidden');
    document.getElementById('itemSheet').classList.remove('hidden');
    renderItemSheet(currentItem);
    document.getElementById('itemSaveSection').classList.remove('hidden');
    _showTokenUsage(data.usage, 'itemTokenUsage');
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    setBusy('generateItemBtn', 'generateItemSpinner', 'generateItemBtnText', false, 'Generate Item');
  }
}

// -----------------------------------------------------------------------
// Item: save to Docmost
// -----------------------------------------------------------------------

async function saveItem() {
  if (!currentItem) return;
  setBusy('saveItemBtn', 'saveItemSpinner', 'saveItemBtnText', true, 'Saving…');
  const resultEl = document.getElementById('saveItemResult');
  resultEl.classList.add('hidden');

  try {
    const r = await fetch('/api/save-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: currentItem, history_id: currentItemHistoryId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const entry = historyEntries.find(e => e.id === currentItemHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }

    resultEl.textContent = `✓ Saved to Items / ${currentItem.item_type}`;
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

function exportItemToPDF() {
  if (!currentItem) return;
  window.print();
}

// -----------------------------------------------------------------------
// Item sheet renderer
// -----------------------------------------------------------------------

function renderItemSheet(item, containerEl) {
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

// -----------------------------------------------------------------------
// Shop content renderer (used by both Shop view and History view)
// -----------------------------------------------------------------------

function _renderShopContent(shop, container) {
  // Append mode — caller is responsible for clearing old content first
  // (history view passes an empty div; shop view clears before calling)

  // Header
  const header = el('div', 'panel');
  header.innerHTML = `
    <h2 class="text-3xl font-bold text-parchment mb-1">${shop.name}</h2>
    <div class="flex flex-wrap gap-2 mb-3">
      <span class="source-tag">${shop.shop_type.charAt(0).toUpperCase() + shop.shop_type.slice(1)}</span>
      <span class="source-tag text-gold">${shop.category}</span>
    </div>
    ${shop.atmosphere ? `<p class="text-sm text-gray-400 italic">${shop.atmosphere}</p>` : ''}
  `;
  container.appendChild(header);

  // Description
  const descPanel = el('div', 'panel');
  descPanel.innerHTML = `<div class="section-header">About the Shop</div>`;
  const descBody = el('div', 'text-sm text-gray-300 space-y-3');
  for (const para of shop.description.split(/\n\n+/)) {
    if (para.trim()) {
      const p = document.createElement('p');
      p.textContent = para.trim();
      descBody.appendChild(p);
    }
  }
  descPanel.appendChild(descBody);
  container.appendChild(descPanel);

  // Shopkeeper
  const sk = shop.shopkeeper;
  const skPanel = el('div', 'panel');
  const genderNote = sk.gender ? ` (${sk.gender})` : '';
  const skHeader = el('div', 'flex items-start justify-between gap-3 mb-3');
  skHeader.innerHTML = `
    <div class="section-header" style="margin-bottom:0;border:none">The Shopkeeper</div>
    <button onclick="useShopkeeperAsPrompt()" class="btn-secondary text-xs py-1 px-2 flex-shrink-0 flex items-center gap-1">
      <i class="fa-solid fa-users"></i> Generate NPC
    </button>
  `;
  skPanel.appendChild(skHeader);
  skPanel.innerHTML += `
    <p class="text-sm font-bold text-parchment mb-1">${sk.name}
      <span class="text-gray-500 font-normal text-xs ml-1">— ${sk.race}${genderNote}, ${sk.character_class}</span>
    </p>
    <p class="text-sm text-gray-300 mb-1">${sk.appearance}</p>
    <p class="text-sm text-gray-300 mb-1">${sk.personality}</p>
    ${sk.motivation ? `<p class="text-xs text-gray-500 italic mt-1">${sk.motivation}</p>` : ''}
  `;
  container.appendChild(skPanel);

  // Stock
  const regular = shop.items.filter(i => !i.is_under_table);
  const under = shop.items.filter(i => i.is_under_table);

  if (regular.length) {
    const stockPanel = el('div', 'panel');
    stockPanel.innerHTML = `<div class="section-header">Stock</div>`;
    const list = el('div', 'space-y-2');
    regular.forEach(item => list.appendChild(_shopItemCard(item, shop.items.indexOf(item))));
    stockPanel.appendChild(list);
    container.appendChild(stockPanel);
  }

  if (under.length) {
    const utPanel = el('div', 'panel');
    utPanel.innerHTML = `
      <div class="section-header" style="color:#f87171">Under the Table</div>
      <p class="text-xs text-gray-500 mb-3 italic">Not openly displayed. The shopkeeper may deny having these.</p>
    `;
    const list = el('div', 'space-y-2');
    under.forEach(item => list.appendChild(_shopItemCard(item, shop.items.indexOf(item))));
    utPanel.appendChild(list);
    container.appendChild(utPanel);
  }
}

function _shopItemCard(item, globalIdx) {
  const color = RARITY_COLORS[item.rarity] || '#9d9d9d';
  const price = item.price_gp != null ? `${item.price_gp.toLocaleString()} gp` : '—';
  const card = el('div', 'panel py-2 px-3 flex items-start gap-3');
  card.innerHTML = `
    <div class="flex-1 min-w-0">
      <div class="flex flex-wrap items-center gap-1.5 mb-0.5">
        <span class="text-sm font-bold text-parchment">${item.name}</span>
        <span class="source-tag text-xs" style="color:${color};border-color:${color}">${item.rarity}</span>
        <span class="source-tag text-xs">${item.item_type}</span>
        <span class="text-xs text-gold">${price}</span>
      </div>
      <p class="text-xs text-gray-400">${item.description}</p>
    </div>
    <button onclick="useShopItemAsPrompt(${globalIdx})" class="flex-shrink-0 btn-secondary text-xs py-1 px-2 flex items-center gap-1" title="Generate full item">
      <i class="fa-solid fa-flask-vial"></i> Generate
    </button>
  `;
  return card;
}

// -----------------------------------------------------------------------
// Shop Generator
// -----------------------------------------------------------------------

let currentShop = null;
let currentShopHistoryId = null;
let shopSelectedRarities = new Set(['Common', 'Uncommon']);
let shopDetailLevel = 'medium';

function _shopRarityStyle(rarity, active) {
  const color = RARITY_COLORS[rarity] || '#9d9d9d';
  const btn = document.getElementById(`shopRarity${rarity}`);
  if (!btn) return;
  btn.style.color = active ? color : '#8a7560';
  btn.style.borderColor = active ? color : '#5a3e28';
  btn.style.background = active ? `${color}18` : 'transparent';
}

function toggleShopRarity(rarity) {
  if (shopSelectedRarities.has(rarity)) {
    if (shopSelectedRarities.size === 1) return; // always keep at least one
    shopSelectedRarities.delete(rarity);
  } else {
    shopSelectedRarities.add(rarity);
  }
  _shopRarityStyle(rarity, shopSelectedRarities.has(rarity));
}

function setShopDetail(level) {
  shopDetailLevel = level;
  ['low', 'medium', 'high'].forEach(d => {
    const btn = document.getElementById(`shopDetail-${d}`);
    btn.className = d === level
      ? 'flex-1 btn-primary text-xs py-2'
      : 'flex-1 btn-secondary text-xs py-2';
  });
}

function _initShopRarityToggles() {
  for (const r of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']) {
    _shopRarityStyle(r, shopSelectedRarities.has(r));
  }
}

async function generateShop() {
  setBusy('generateShopBtn', 'generateShopSpinner', 'generateShopBtnText', true, 'Generating…');
  document.getElementById('shopSheet').classList.add('hidden');
  document.getElementById('shopPlaceholder').classList.remove('hidden');
  document.getElementById('shopTokenUsage').classList.add('hidden');

  try {
    const body = {
      shop_type: document.getElementById('shopType').value,
      category: document.getElementById('shopCategory').value,
      item_count: parseInt(document.getElementById('shopItemCount').value) || 8,
      under_table: document.getElementById('shopUnderTable').checked,
      rarities: [...shopSelectedRarities],
      detail_level: shopDetailLevel,
      additional_notes: document.getElementById('shopNotes').value.trim(),
    };

    const r = await fetch('/api/generate-shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.detail || 'Generation failed');
    }

    const data = await r.json();
    currentShop = data.shop;
    currentShopHistoryId = data.history_id ?? null;

    document.getElementById('shopPlaceholder').classList.add('hidden');
    document.getElementById('shopSheet').classList.remove('hidden');
    renderShopSheet(currentShop);
    _showTokenUsage(data.usage, 'shopTokenUsage');
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    setBusy('generateShopBtn', 'generateShopSpinner', 'generateShopBtnText', false, 'Generate Shop');
  }
}

function renderShopSheet(shop) {
  // Reset save state
  document.getElementById('shopSaveResult').classList.add('hidden');
  document.getElementById('shopDocmostLink').classList.add('hidden');
  document.getElementById('saveShopBtnText').textContent = 'Save to Docmost';
  document.getElementById('shopMeta').textContent =
    `${shop.category} · ${shop.shop_type} · ${shop.items.length} items · Run by ${shop.shopkeeper.name}`;

  // Remove any previously rendered content (keep the save bar and save result divs)
  const container = document.getElementById('shopSheet');
  while (container.children.length > 2) container.removeChild(container.lastChild);

  // Render shop content directly into shopSheet — _renderShopContent appends to it
  _renderShopContent(shop, container);
}

async function saveShop() {
  if (!currentShop) return;
  setBusy('saveShopBtn', 'saveShopSpinner', 'saveShopBtnText', true, 'Saving…');
  const resultEl = document.getElementById('shopSaveResult');
  resultEl.classList.add('hidden');

  try {
    const r = await fetch('/api/save-shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop: currentShop, history_id: currentShopHistoryId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const entry = historyEntries.find(e => e.id === currentShopHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }

    resultEl.textContent = `✓ Saved to Locations / Shops`;
    resultEl.className = 'text-xs text-center py-1 text-green-400';
    resultEl.classList.remove('hidden');

    const link = document.getElementById('shopDocmostLink');
    if (data.docmost_url) {
      link.href = data.docmost_url;
      link.classList.remove('hidden');
    }
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-center py-1 text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('saveShopBtn', 'saveShopSpinner', 'saveShopBtnText', false, 'Save to Docmost');
  }
}

function useShopItemAsPrompt(itemIndex) {
  const item = currentShop?.items[itemIndex];
  if (!item) return;
  openGenModal('item', item);
}

function useShopkeeperAsPrompt() {
  const sk = currentShop?.shopkeeper;
  if (!sk) return;
  openGenModal('npc', sk);
}

// -----------------------------------------------------------------------
// Generation modal (launched from Shop view)
// -----------------------------------------------------------------------

let _modalMode = null;
let _modalGeneratedItem = null;
let _modalGeneratedItemHistoryId = null;
let _modalGeneratedChar = null;
let _modalGeneratedCharHistoryId = null;

function openGenModal(mode, data) {
  _modalMode = mode;
  _modalGeneratedItem = null;
  _modalGeneratedChar = null;
  _modalGeneratedItemHistoryId = null;
  _modalGeneratedCharHistoryId = null;

  document.getElementById('genModalResult').classList.add('hidden');
  document.getElementById('genModalResult').innerHTML = '';
  document.getElementById('genModalTokenUsage').classList.add('hidden');
  document.getElementById('genModalSaveBtn').classList.add('hidden');
  document.getElementById('genModalSaveResult').textContent = '';
  document.getElementById('genModalGenerateBtnText').textContent = 'Generate';

  if (mode === 'item') {
    document.getElementById('genModalTitle').textContent = `Generate Item — ${data.name}`;
    document.getElementById('genModalItemForm').classList.remove('hidden');
    document.getElementById('genModalNpcForm').classList.add('hidden');
    document.getElementById('genModalItemConcept').value = data.concept || data.name;
    document.getElementById('genModalItemType').value = data.item_type;
    document.getElementById('genModalItemRarity').value = data.rarity;
  } else {
    document.getElementById('genModalTitle').textContent = `Generate NPC — ${data.name}`;
    document.getElementById('genModalNpcForm').classList.remove('hidden');
    document.getElementById('genModalItemForm').classList.add('hidden');
    document.getElementById('genModalNpcConcept').value = data.concept || data.name;
    document.getElementById('genModalNpcRace').value = data.race || '';
    const cls = document.getElementById('genModalNpcClass');
    const match = [...cls.options].find(o => o.value.toLowerCase() === (data.character_class || '').toLowerCase());
    cls.value = match ? match.value : 'Commoner';
  }

  document.getElementById('genModal').classList.remove('hidden');
}

function closeGenModal() {
  document.getElementById('genModal').classList.add('hidden');
}

async function runModalGeneration() {
  const genBtn = document.getElementById('genModalGenerateBtn');
  const spinner = document.getElementById('genModalSpinner');
  const btnText = document.getElementById('genModalGenerateBtnText');
  genBtn.disabled = true;
  spinner.classList.remove('hidden');
  btnText.textContent = 'Generating…';
  document.getElementById('genModalSaveBtn').classList.add('hidden');
  document.getElementById('genModalSaveResult').textContent = '';
  document.getElementById('genModalTokenUsage').classList.add('hidden');

  const resultEl = document.getElementById('genModalResult');
  resultEl.innerHTML = '';

  try {
    if (_modalMode === 'item') {
      const concept = document.getElementById('genModalItemConcept').value.trim();
      const itemType = document.getElementById('genModalItemType').value.trim();
      if (!concept || !itemType) { alert('Concept and Item Type are required.'); return; }

      const body = {
        concept,
        item_type: itemType,
        rarity: document.getElementById('genModalItemRarity').value,
        target_level_min: parseInt(document.getElementById('genModalItemLevelMin').value),
        target_level_max: parseInt(document.getElementById('genModalItemLevelMax').value),
        additional_notes: '',
        magic_theme: '', material: '', stat_bonus_target: '', damage_type: '',
        attunement: 'auto',
      };

      const r = await fetch('/api/generate-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Generation failed'); }
      const data = await r.json();
      _modalGeneratedItem = data.item;
      _modalGeneratedItemHistoryId = data.history_id ?? null;

      resultEl.classList.remove('hidden');
      renderItemSheet(data.item, resultEl);
      _showTokenUsage(data.usage, 'genModalTokenUsage');
      document.getElementById('genModalSaveBtn').classList.remove('hidden');

    } else {
      const concept = document.getElementById('genModalNpcConcept').value.trim();
      const race = document.getElementById('genModalNpcRace').value.trim();
      if (!concept || !race) { alert('Concept and Race are required.'); return; }

      const body = {
        concept,
        race,
        character_class: document.getElementById('genModalNpcClass').value,
        level: parseInt(document.getElementById('genModalNpcLevel').value),
        alignment: document.getElementById('genModalNpcAlignment').value,
        appearance: '',
        background_detail: 'short',
        additional_notes: '',
        generic_npc: document.getElementById('genModalNpcGeneric').checked,
      };

      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Generation failed'); }
      const data = await r.json();
      _modalGeneratedChar = data.character;
      _modalGeneratedCharHistoryId = data.history_id ?? null;

      resultEl.classList.remove('hidden');
      renderSheet(data.character, resultEl);
      _showTokenUsage(data.usage, 'genModalTokenUsage');
      document.getElementById('genModalSaveBtn').classList.remove('hidden');
    }
  } catch (e) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<p class="text-red-400 text-sm">${e.message}</p>`;
  } finally {
    genBtn.disabled = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Regenerate';
  }
}

async function saveModalResult() {
  const saveBtn = document.getElementById('genModalSaveBtn');
  const spinner = document.getElementById('genModalSaveSpinner');
  const btnText = document.getElementById('genModalSaveBtnText');
  const resultEl = document.getElementById('genModalSaveResult');
  saveBtn.disabled = true;
  spinner.classList.remove('hidden');
  btnText.textContent = 'Saving…';
  resultEl.textContent = '';

  try {
    if (_modalMode === 'item' && _modalGeneratedItem) {
      const r = await fetch('/api/save-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: _modalGeneratedItem, history_id: _modalGeneratedItemHistoryId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Save failed');
      resultEl.textContent = `✓ Saved to Items / ${_modalGeneratedItem.item_type}`;
      resultEl.className = 'text-xs text-green-400';
    } else if (_modalMode === 'npc' && _modalGeneratedChar) {
      const r = await fetch('/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character: _modalGeneratedChar, folder: 'npcs', history_id: _modalGeneratedCharHistoryId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Save failed');
      resultEl.textContent = `✓ Saved to Docmost`;
      resultEl.className = 'text-xs text-green-400';
    }
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-red-400';
  } finally {
    saveBtn.disabled = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Save to Docmost';
  }
}

// Init
loadConfig();
_initShopRarityToggles();
