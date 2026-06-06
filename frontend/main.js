// main.js — routing, modal, config, initialization

import { RARITY_COLORS, setBusy, toast, _showTokenUsage } from './utils.js';
import { state } from './state.js';

import { rollForgeStats, rollPcStats } from './stats.js';
import { _initShopRarityToggles } from './shop.js';
import { loadPartyRoster } from './players.js';
import { loadHistoryList, renderHistoryList } from './history.js';
import { renderItemSheet } from './items.js';
import { renderSheet } from './forge.js';
import { loadSettings } from './settings.js';

// -----------------------------------------------------------------------
// View constants
// -----------------------------------------------------------------------

export const VIEW_HASHES = {
  forge: '#npcs', items: '#items', shops: '#shops', factions: '#factions',
  bestiary: '#bestiary', locations: '#locations',
  players: '#players', history: '#history', settings: '#settings',
};
export const HASH_VIEWS = {
  '#npcs': 'forge', '#items': 'items', '#shops': 'shops', '#factions': 'factions',
  '#bestiary': 'bestiary', '#locations': 'locations',
  '#players': 'players', '#history': 'history', '#settings': 'settings',
};

// -----------------------------------------------------------------------
// Config / startup
// -----------------------------------------------------------------------

export async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    for (const selId of ['saveFolder', 'historySaveFolder', 'pcSaveFolder']) {
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

// -----------------------------------------------------------------------
// Detail level
// -----------------------------------------------------------------------

export function setDetail(level) {
  state.selectedDetail = level;
  ['short', 'medium', 'long'].forEach(d => {
    const btn = document.getElementById(`detail-${d}`);
    btn.className = d === level
      ? 'flex-1 btn-primary text-xs py-2'
      : 'flex-1 btn-secondary text-xs py-2';
  });
}

// -----------------------------------------------------------------------
// Rarity badge (Items view)
// -----------------------------------------------------------------------

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
// View switching
// -----------------------------------------------------------------------

export function switchView(view, updateHash = true) {
  document.getElementById('viewForge').classList.toggle('hidden', view !== 'forge');
  document.getElementById('viewItems').classList.toggle('hidden', view !== 'items');
  document.getElementById('viewShops').classList.toggle('hidden', view !== 'shops');
  document.getElementById('viewFactions').classList.toggle('hidden', view !== 'factions');
  document.getElementById('viewBestiary').classList.toggle('hidden', view !== 'bestiary');
  document.getElementById('viewLocations').classList.toggle('hidden', view !== 'locations');
  document.getElementById('viewPlayers').classList.toggle('hidden', view !== 'players');
  document.getElementById('viewHistory').classList.toggle('hidden', view !== 'history');
  document.getElementById('viewSettings').classList.toggle('hidden', view !== 'settings');
  document.getElementById('navForge').classList.toggle('nav-active', view === 'forge');
  document.getElementById('navItems').classList.toggle('nav-active', view === 'items');
  document.getElementById('navShops').classList.toggle('nav-active', view === 'shops');
  document.getElementById('navFactions').classList.toggle('nav-active', view === 'factions');
  document.getElementById('navBestiary').classList.toggle('nav-active', view === 'bestiary');
  document.getElementById('navLocations').classList.toggle('nav-active', view === 'locations');
  document.getElementById('navPlayers').classList.toggle('nav-active', view === 'players');
  document.getElementById('navHistory').classList.toggle('nav-active', view === 'history');
  document.getElementById('navSettings').classList.toggle('nav-active', view === 'settings');
  if (updateHash && location.hash !== (VIEW_HASHES[view] || '')) {
    history.pushState(null, '', VIEW_HASHES[view] || '#npcs');
  }
  if (view === 'players') loadPartyRoster();
  if (view === 'history') {
    if (state.historyEntries.length === 0) loadHistoryList();
    else renderHistoryList();
  }
  if (view === 'items') updateRarityBadge();
  if (view === 'settings') loadSettings();
}

// -----------------------------------------------------------------------
// Generation modal
// -----------------------------------------------------------------------

export function openGenModal(mode, data) {
  state._modalMode = mode;
  state._modalGeneratedItem = null;
  state._modalGeneratedChar = null;
  state._modalGeneratedItemHistoryId = null;
  state._modalGeneratedCharHistoryId = null;
  // _modalFactionContext and _modalShopContext are set BEFORE calling openGenModal; don't clear them here

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

export function closeGenModal() {
  document.getElementById('genModal').classList.add('hidden');
  state._modalFactionContext = null;
  state._modalShopContext = null;
}

export async function runModalGeneration() {
  const genBtn = document.getElementById('genModalGenerateBtn');
  const spinner = document.getElementById('genModalSpinner');
  const btnText = document.getElementById('genModalGenerateBtnText');
  genBtn.disabled = true;
  spinner.classList.remove('hidden');
  const _modalLabel = 'Generating…';
  btnText.textContent = _modalLabel;
  document.getElementById('genModalSaveBtn').classList.add('hidden');
  document.getElementById('genModalSaveResult').textContent = '';
  document.getElementById('genModalTokenUsage').classList.add('hidden');

  const _modalStart = Date.now();
  const _modalTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - _modalStart) / 1000);
    btnText.textContent = `${_modalLabel} ${elapsed}s`;
  }, 1000);

  const resultEl = document.getElementById('genModalResult');
  resultEl.innerHTML = '';

  try {
    if (state._modalMode === 'item') {
      const concept = document.getElementById('genModalItemConcept').value.trim();
      const itemType = document.getElementById('genModalItemType').value.trim();
      if (!concept || !itemType) { toast('Concept and Item Type are required.', 'error'); return; }

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
      if (!r.ok) { const e = await r.json(); throw new Error(_apiDetail(e.detail, 'Generation failed')); }
      const data = await r.json();
      state._modalGeneratedItem = data.item;
      state._modalGeneratedItemHistoryId = data.history_id ?? null;

      resultEl.classList.remove('hidden');
      renderItemSheet(data.item, resultEl);
      _showTokenUsage(data.usage, 'genModalTokenUsage');
      document.getElementById('genModalSaveBtn').classList.remove('hidden');

    } else {
      const concept = document.getElementById('genModalNpcConcept').value.trim();
      const race = document.getElementById('genModalNpcRace').value.trim();
      if (!concept || !race) { toast('Concept and Race are required.', 'error'); return; }

      const body = {
        concept,
        race,
        character_class: document.getElementById('genModalNpcClass').value,
        level: parseInt(document.getElementById('genModalNpcLevel').value),
        alignment: document.getElementById('genModalNpcAlignment').value,
        appearance: '',
        background_detail: 'short',
        additional_notes: state._modalFactionContext?.additionalNotes || state._modalShopContext?.additionalNotes || '',
        generic_npc: document.getElementById('genModalNpcGeneric').checked,
      };

      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(_apiDetail(e.detail, 'Generation failed')); }
      const data = await r.json();
      state._modalGeneratedChar = data.character;
      state._modalGeneratedCharHistoryId = data.history_id ?? null;

      resultEl.classList.remove('hidden');
      renderSheet(data.character, resultEl);
      _showTokenUsage(data.usage, 'genModalTokenUsage');
      document.getElementById('genModalSaveBtn').classList.remove('hidden');
    }
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    clearInterval(_modalTimer);
    genBtn.disabled = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Regenerate';
  }
}

export async function saveModalResult() {
  const saveBtn = document.getElementById('genModalSaveBtn');
  const spinner = document.getElementById('genModalSaveSpinner');
  const btnText = document.getElementById('genModalSaveBtnText');
  saveBtn.disabled = true;
  spinner.classList.remove('hidden');
  btnText.textContent = 'Saving…';

  try {
    if (state._modalMode === 'item' && state._modalGeneratedItem) {
      const r = await fetch('/api/save-item', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: state._modalGeneratedItem, history_id: state._modalGeneratedItemHistoryId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Save failed');
      toast(`Saved to Items / ${state._modalGeneratedItem.item_type}`);
    } else if (state._modalMode === 'npc' && state._modalGeneratedChar) {
      const r = await fetch('/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character: state._modalGeneratedChar, folder: 'npcs', history_id: state._modalGeneratedCharHistoryId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Save failed');

      if (state._modalFactionContext && data.docmost_url) {
        try {
          await fetch(`/api/faction/${state._modalFactionContext.factionHistoryId}/link-npc`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              member_name: state._modalFactionContext.memberName,
              member_role: state._modalFactionContext.memberRole,
              npc_name: state._modalGeneratedChar.name,
              npc_docmost_url: data.docmost_url,
              npc_history_id: state._modalGeneratedCharHistoryId,
            }),
          });
          const fEntry = state.historyEntries.find(e => e.id === state._modalFactionContext.factionHistoryId);
          if (fEntry) {
            if (!fEntry.linked_npcs) fEntry.linked_npcs = [];
            fEntry.linked_npcs = fEntry.linked_npcs.filter(n => n.member_name !== state._modalFactionContext.memberName);
            fEntry.linked_npcs.push({
              member_name: state._modalFactionContext.memberName,
              member_role: state._modalFactionContext.memberRole,
              npc_name: state._modalGeneratedChar.name,
              npc_docmost_url: data.docmost_url,
              npc_history_id: state._modalGeneratedCharHistoryId,
            });
          }
          toast('Saved & linked to faction');
        } catch {
          toast('Saved (faction link failed — retry from faction sheet)', 'info');
        }
        state._modalFactionContext = null;
      } else if (state._modalShopContext && data.docmost_url) {
        try {
          await fetch(`/api/shop/${state._modalShopContext.shopHistoryId}/link-npc`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              member_name: state._modalShopContext.memberName,
              member_role: state._modalShopContext.memberRole,
              npc_name: state._modalGeneratedChar.name,
              npc_docmost_url: data.docmost_url,
              npc_history_id: state._modalGeneratedCharHistoryId,
              is_shopkeeper: state._modalShopContext.isShopkeeper,
            }),
          });
          const sEntry = state.historyEntries.find(e => e.id === state._modalShopContext.shopHistoryId);
          if (sEntry) {
            if (!sEntry.linked_npcs) sEntry.linked_npcs = [];
            sEntry.linked_npcs = sEntry.linked_npcs.filter(n => n.member_name !== state._modalShopContext.memberName);
            sEntry.linked_npcs.push({
              member_name: state._modalShopContext.memberName,
              member_role: state._modalShopContext.memberRole,
              npc_name: state._modalGeneratedChar.name,
              npc_docmost_url: data.docmost_url,
              npc_history_id: state._modalGeneratedCharHistoryId,
              is_shopkeeper: state._modalShopContext.isShopkeeper,
            });
          }
          toast('Saved & linked to shop');
        } catch {
          toast('Saved (shop link failed — retry from shop sheet)', 'info');
        }
        state._modalShopContext = null;
      } else {
        toast('Saved to Docmost');
      }
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    spinner.classList.add('hidden');
    btnText.textContent = 'Save to Docmost';
  }
}

// -----------------------------------------------------------------------
// Field character counters
// -----------------------------------------------------------------------

const _COUNTER_FIELDS = [
  { id: 'concept',        limitKey: 'max_concept_length' },
  { id: 'appearance',     limitKey: 'max_concept_length' },
  { id: 'notes',          limitKey: 'max_notes_length' },
  { id: 'itemConcept',    limitKey: 'max_concept_length' },
  { id: 'itemNotes',      limitKey: 'max_notes_length' },
  { id: 'shopNotes',      limitKey: 'max_notes_length' },
  { id: 'factionConcept',  limitKey: 'max_concept_length' },
  { id: 'factionNotes',   limitKey: 'max_notes_length' },
  { id: 'bestiaryConcept', limitKey: 'max_concept_length' },
  { id: 'bestiaryNotes',   limitKey: 'max_notes_length' },
  { id: 'locationConcept', limitKey: 'max_concept_length' },
  { id: 'locationNotes',   limitKey: 'max_notes_length' },
  { id: 'pcConcept',      limitKey: 'max_concept_length' },
  { id: 'pcAppearance',   limitKey: 'max_concept_length' },
  { id: 'pcNotes',        limitKey: 'max_notes_length' },
];

function _updateCounter(id, limitKey) {
  const input = document.getElementById(id);
  const counter = document.getElementById(`cnt-${id}`);
  if (!input || !counter) return;
  const len = input.value.length;
  const max = state.limits[limitKey];
  counter.textContent = `${len.toLocaleString()} / ${max.toLocaleString()}`;
  counter.className = len > max
    ? 'text-[10px] text-red-400 font-medium tabular-nums'
    : 'text-[10px] text-gray-600 tabular-nums';
}

function _setupFieldCounters() {
  for (const { id, limitKey } of _COUNTER_FIELDS) {
    const input = document.getElementById(id);
    if (!input) continue;
    input.addEventListener('input', () => _updateCounter(id, limitKey));
    _updateCounter(id, limitKey);
  }
}

export function refreshCounterLimits() {
  for (const { id, limitKey } of _COUNTER_FIELDS) {
    _updateCounter(id, limitKey);
  }
}

// -----------------------------------------------------------------------
// Event listeners
// -----------------------------------------------------------------------

function _handleEntryHash(hash) {
  const m = hash.match(/^#entry\/(.+)$/);
  if (!m) return false;
  const entryId = m[1];
  switchView('history', false);
  // Load history if empty, then open the entry
  if (state.historyEntries.length === 0) {
    _prefetchHistory().then(() => openHistoryEntry(entryId));
  } else {
    openHistoryEntry(entryId);
  }
  return true;
}

window.addEventListener('hashchange', () => {
  if (_handleEntryHash(location.hash)) return;
  const view = HASH_VIEWS[location.hash] || 'forge';
  switchView(view, false);
});

window.addEventListener('DOMContentLoaded', () => {
  const entryHandled = _handleEntryHash(location.hash);
  if (!entryHandled) {
    const view = HASH_VIEWS[location.hash] || 'forge';
    switchView(view, false);
  }
  // Restore saved roll threshold preferences
  const savedCount = localStorage.getItem('rollMinCount');
  const savedValue = localStorage.getItem('rollMinValue');
  if (savedCount) { const el = document.getElementById('rollMinCount'); if (el) el.value = savedCount; }
  if (savedValue) { const el = document.getElementById('rollMinValue'); if (el) el.value = savedValue; }
  rollForgeStats();
  rollPcStats();
  loadConfig();
  _initShopRarityToggles();
  _setupFieldCounters();
  // _handleEntryHash fetches history itself; only prefetch separately when not navigating to an entry
  if (!entryHandled) _prefetchHistory();
});

// -----------------------------------------------------------------------
// Expose all public functions on window for inline onclick handlers
// -----------------------------------------------------------------------

import {
  el, sectionHeader, sign, toast as _toast, populateContextPicker, buildContextNote, getContextId, cacheHistoryEntry as _cacheHistoryEntry, copyEntryLink, _renderAssocLinks, _apiDetail,
  _escHtml, _escAttr, _showTokenUsage as _showTokenUsageUtil,
  _formatTimestamp, _typeColor, _entrySubtitle, _editField, _editTextarea, _editSelect,
  _sectionLabel, RARITY_COLORS as _RARITY_COLORS,
} from './utils.js';

import {
  _CLASS_STAT_PRIORITY, _SKILL_ABILITY_MAP, _ABILITY_KEYS,
  _getRollThreshold, _rollAbilityScores, _displayRolledStats, _updateRollHint,
  _recalcAbilityScores, _collectNewScoreTotals,
} from './stats.js';

import {
  generateCharacter, saveCharacter, renderSheet as _renderSheet,
  renderCoreBox, renderACBreakdown, renderSpellList,
  exportToPDF, exportToFoundryJSON, _levelToCR, _crToXP,
  _buildCharacterEditForm, _collectCharacterEdits,
} from './forge.js';

import {
  generateItem, saveItem, exportItemToPDF, exportItemToFoundryJSON, renderItemSheet as _renderItemSheet,
  _buildItemEditForm, _collectItemEdits, _makeBonusRow, _makeAbilityRow,
} from './items.js';

import {
  generateShop, saveShop, renderShopSheet, _renderShopContent, _shopItemCard,
  toggleShopRarity, _shopRarityStyle, setShopDetail, _initShopRarityToggles as _initShopRarityTogglesImport,
  useShopItemAsPrompt, openShopkeeperModal, openShopStaffModal,
  regenerateShopkeeperUI, regenerateShopStaffUI, addShopStaffUI, removeShopStaffUI,
  _saveShopStaffChanges, _buildShopEditForm, _collectShopEdits, _makeShopItemRow,
} from './shop.js';

import {
  generateFaction, saveFaction, renderFactionSheet, openFactionMemberModal,
  regenerateFactionMemberUI, addFactionMemberUI, removeFactionMemberUI,
  _saveFactionMemberChanges, _buildFactionEditForm, _collectFactionEdits,
} from './faction.js';

import {
  generateBestiary, saveBestiary, renderBestiarySheet,
  exportMonsterToFoundryJSON, exportCurrentMonsterToFoundryJSON,
  _buildBestiaryEditForm, _collectBestiaryEdits,
} from './bestiary.js';

import {
  generateLocation, saveLocation, renderLocationSheet, _renderLocationContent,
  onLocationTypeChange, onLocationContextChange, setLocationDetail, linkLocationParent,
  _buildLocationEditForm, _collectLocationEdits, _renderLocationLinkPanel,
} from './location.js';

import {
  loadPartyRoster as _loadPartyRoster, renderPartyRoster, openPartyEntry,
  setPcMode, _submitPcGeneration, generatePlayerCharacter, createManualCharacter,
  addCurrentToParty, savePlayerCharacter, _populatePcStatInputs,
  applyPcStatEdits, exportPcToPDF, exportPcToFoundryJSON,
} from './players.js';

import {
  loadHistoryList as _loadHistoryList, _prefetchHistory, filterHistory, setHistoryTag, _buildTagFilters,
  renderHistoryList as _renderHistoryList, openHistoryEntry, saveFromHistory,
  _updateHistorySyncStatus, showResyncWarning, cancelResync, confirmResync,
  enterEditMode, exitEditMode, saveEdit, exportHistoryToFoundry,
} from './history.js';

import {
  loadTokenStats, loadSettings as _loadSettings, saveSettings, testPageUrl, toggleVisible,
} from './settings.js';

Object.assign(window, {
  // utils (direct use from HTML possible but generally called via other fns)
  el, sectionHeader, sign, setBusy, toast: _toast, populateContextPicker, buildContextNote, getContextId, cacheHistoryEntry: _cacheHistoryEntry, copyEntryLink, _renderAssocLinks, _apiDetail, _escHtml, _escAttr,
  _showTokenUsage: _showTokenUsageUtil, _formatTimestamp, _typeColor, _entrySubtitle,
  _editField, _editTextarea, _editSelect, _sectionLabel, RARITY_COLORS: _RARITY_COLORS,

  // stats
  _CLASS_STAT_PRIORITY, _SKILL_ABILITY_MAP, _ABILITY_KEYS,
  _getRollThreshold, _rollAbilityScores, _displayRolledStats, _updateRollHint,
  rollForgeStats, rollPcStats, _recalcAbilityScores, _collectNewScoreTotals,

  // forge
  generateCharacter, saveCharacter, renderSheet: _renderSheet,
  renderCoreBox, renderACBreakdown, renderSpellList,
  exportToPDF, exportToFoundryJSON, _levelToCR, _crToXP,
  _buildCharacterEditForm, _collectCharacterEdits,

  // items
  generateItem, saveItem, exportItemToPDF, exportItemToFoundryJSON, renderItemSheet: _renderItemSheet,
  _buildItemEditForm, _collectItemEdits, _makeBonusRow, _makeAbilityRow,
  updateRarityBadge,

  // shop
  generateShop, saveShop, renderShopSheet, _renderShopContent, _shopItemCard,
  toggleShopRarity, _shopRarityStyle, setShopDetail,
  _initShopRarityToggles: _initShopRarityTogglesImport,
  useShopItemAsPrompt, openShopkeeperModal, openShopStaffModal,
  regenerateShopkeeperUI, regenerateShopStaffUI, addShopStaffUI, removeShopStaffUI,
  _saveShopStaffChanges, _buildShopEditForm, _collectShopEdits, _makeShopItemRow,

  // faction
  generateFaction, saveFaction, renderFactionSheet, openFactionMemberModal,
  regenerateFactionMemberUI, addFactionMemberUI, removeFactionMemberUI,
  _saveFactionMemberChanges, _buildFactionEditForm, _collectFactionEdits,

  // bestiary
  generateBestiary, saveBestiary, renderBestiarySheet,
  exportMonsterToFoundryJSON, exportCurrentMonsterToFoundryJSON,
  _buildBestiaryEditForm, _collectBestiaryEdits,

  // locations
  generateLocation, saveLocation, renderLocationSheet, _renderLocationContent,
  onLocationTypeChange, onLocationContextChange, setLocationDetail, linkLocationParent,
  _buildLocationEditForm, _collectLocationEdits, _renderLocationLinkPanel,

  // players
  loadPartyRoster: _loadPartyRoster, renderPartyRoster, openPartyEntry,
  setPcMode, _submitPcGeneration, generatePlayerCharacter, createManualCharacter,
  addCurrentToParty, savePlayerCharacter, _populatePcStatInputs,
  applyPcStatEdits, exportPcToPDF, exportPcToFoundryJSON,

  // history
  loadHistoryList: _loadHistoryList, _prefetchHistory, filterHistory, setHistoryTag, _buildTagFilters,
  renderHistoryList: _renderHistoryList, openHistoryEntry, saveFromHistory,
  _updateHistorySyncStatus, showResyncWarning, cancelResync, confirmResync,
  enterEditMode, exitEditMode, saveEdit, exportHistoryToFoundry,

  // settings
  loadTokenStats, loadSettings: _loadSettings, saveSettings, testPageUrl, toggleVisible,

  // main
  loadConfig, setDetail, switchView, openGenModal, closeGenModal,
  runModalGeneration, saveModalResult, VIEW_HASHES, HASH_VIEWS,
  refreshCounterLimits,
});
