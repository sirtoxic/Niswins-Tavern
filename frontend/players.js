// players.js — player character creation, party roster, stat editing

import { setBusy, _escHtml, _showTokenUsage } from './utils.js';
import { state } from './state.js';
import { rollPcStats, _recalcAbilityScores } from './stats.js';
import { renderSheet } from './forge.js';

export async function loadPartyRoster() {
  try {
    const r = await fetch('/api/players');
    state.partyEntries = await r.json();
    renderPartyRoster();
  } catch {}
}

export function renderPartyRoster() {
  const container = document.getElementById('partyRoster');
  if (!container) return;
  if (state.partyEntries.length === 0) {
    container.innerHTML = '<p class="text-xs text-gray-600 text-center py-3">No characters yet.</p>';
    return;
  }
  container.innerHTML = '';
  for (const entry of state.partyEntries) {
    const card = document.createElement('div');
    card.className = 'history-card' + (entry.id === state.currentPlayerCharacterId ? ' selected' : '');
    card.onclick = () => openPartyEntry(entry.id);
    const playerLine = entry.player_name
      ? `<div class="text-xs text-gray-500">${_escHtml(entry.player_name)}'s character</div>` : '';
    const syncBadge = entry.docmost_page_id ? '<span class="text-xs text-green-600 ml-1">✓</span>' : '';
    card.innerHTML = `
      <div class="flex items-center gap-1 mb-0.5">
        <span class="text-sm font-bold text-parchment leading-tight">${_escHtml(entry.name)}</span>${syncBadge}
      </div>
      ${playerLine}
      <div class="text-xs text-gray-500">${_escHtml(entry.character_class)} · ${_escHtml(entry.race)} · Lvl ${entry.level}</div>
    `;
    container.appendChild(card);
  }
}

export async function openPartyEntry(entryId) {
  state.currentPlayerCharacterId = entryId;
  renderPartyRoster();
  try {
    const r = await fetch(`/api/history/${entryId}`);
    if (!r.ok) throw new Error('Entry not found');
    const entry = await r.json();
    state.currentPlayerCharacter = entry.character;

    document.getElementById('pcPlaceholder').classList.add('hidden');
    document.getElementById('pcSheet').classList.remove('hidden');
    document.getElementById('pcSheet').innerHTML = '';
    renderSheet(state.currentPlayerCharacter, document.getElementById('pcSheet'));
    document.getElementById('pcSaveSection').classList.remove('hidden');
    document.getElementById('addToPartyBtn').classList.add('hidden');
    document.getElementById('addToPartyResult').classList.add('hidden');
    _populatePcStatInputs(state.currentPlayerCharacter);
  } catch (e) {
    alert(`Error loading character: ${e.message}`);
  }
}

export function setPcMode(mode) {
  state.selectedPcMode = mode;
  document.getElementById('pcGenerateForm').classList.toggle('hidden', mode !== 'generate');
  document.getElementById('pcManualForm').classList.toggle('hidden', mode !== 'manual');
  document.getElementById('pcModeGenerateBtn').className =
    mode === 'generate' ? 'flex-1 btn-primary text-xs py-1.5' : 'flex-1 btn-secondary text-xs py-1.5';
  document.getElementById('pcModeManualBtn').className =
    mode === 'manual' ? 'flex-1 btn-primary text-xs py-1.5' : 'flex-1 btn-secondary text-xs py-1.5';
}

export async function _submitPcGeneration(body, btnId, spinnerId, textId, defaultLabel, tokenUsageId) {
  body.is_player_character = true;
  setBusy(btnId, spinnerId, textId, true, 'Generating…');
  document.getElementById('pcSheet').classList.add('hidden');
  document.getElementById('pcPlaceholder').classList.remove('hidden');
  document.getElementById('pcSaveSection').classList.add('hidden');
  document.getElementById(tokenUsageId).classList.add('hidden');

  try {
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
    state.currentPlayerCharacter = data.character;
    state.currentPlayerCharacterId = data.history_id ?? null;

    document.getElementById('pcPlaceholder').classList.add('hidden');
    document.getElementById('pcSheet').classList.remove('hidden');
    document.getElementById('pcSheet').innerHTML = '';
    renderSheet(state.currentPlayerCharacter, document.getElementById('pcSheet'));
    document.getElementById('pcSaveSection').classList.remove('hidden');
    document.getElementById('addToPartyBtn').classList.add('hidden');
    document.getElementById('addToPartyResult').classList.add('hidden');
    _populatePcStatInputs(state.currentPlayerCharacter);
    _showTokenUsage(data.usage, tokenUsageId);

    await loadPartyRoster();
  } catch (e) {
    alert(`Error: ${e.message}`);
    document.getElementById('pcPlaceholder').classList.remove('hidden');
    document.getElementById('pcSheet').classList.add('hidden');
  } finally {
    setBusy(btnId, spinnerId, textId, false, defaultLabel);
  }
}

export async function generatePlayerCharacter() {
  const concept = document.getElementById('pcConcept').value.trim();
  const race = document.getElementById('pcRace').value.trim();
  if (!concept || !race) {
    alert('Please fill in Concept and Race before generating.');
    return;
  }
  if (!state.pcRolledStats) rollPcStats();
  await _submitPcGeneration({
    concept,
    race,
    character_class: document.getElementById('pcClass').value,
    level: parseInt(document.getElementById('pcLevel').value),
    alignment: document.getElementById('pcAlignment').value,
    appearance: document.getElementById('pcAppearance').value.trim(),
    background_detail: 'medium',
    additional_notes: document.getElementById('pcNotes').value.trim(),
    generic_npc: false,
    player_name: document.getElementById('pcPlayerName').value.trim() || null,
    manual_ability_scores: state.pcRolledStats,
  }, 'generatePcBtn', 'generatePcSpinner', 'generatePcBtnText', 'Generate Character', 'pcGenTokenUsage');
}

export async function createManualCharacter() {
  const charName = document.getElementById('pcManualCharName').value.trim();
  const race = document.getElementById('pcManualRace').value.trim();
  if (!charName || !race) {
    alert('Please fill in Character Name and Race.');
    return;
  }
  const background = document.getElementById('pcManualBackground').value.trim();
  const notes = document.getElementById('pcManualNotes').value.trim();
  const concept = [charName, background ? `Background: ${background}` : '', notes].filter(Boolean).join('. ');

  await _submitPcGeneration({
    concept,
    race,
    character_class: document.getElementById('pcManualClass').value,
    level: parseInt(document.getElementById('pcManualLevel').value),
    alignment: document.getElementById('pcManualAlignment').value,
    appearance: document.getElementById('pcManualAppearance').value.trim(),
    background_detail: 'medium',
    additional_notes: '',
    generic_npc: false,
    player_name: document.getElementById('pcManualPlayerName').value.trim() || null,
    manual_ability_scores: {
      str: parseInt(document.getElementById('pcManualStr').value) || 10,
      dex: parseInt(document.getElementById('pcManualDex').value) || 10,
      con: parseInt(document.getElementById('pcManualCon').value) || 10,
      int: parseInt(document.getElementById('pcManualInt').value) || 10,
      wis: parseInt(document.getElementById('pcManualWis').value) || 10,
      cha: parseInt(document.getElementById('pcManualCha').value) || 10,
    },
  }, 'createPcBtn', 'createPcSpinner', 'createPcBtnText', 'Create Character', 'pcManualTokenUsage');
}

export async function addCurrentToParty() {
  if (!state.currentPlayerCharacterId) return;
  const resultEl = document.getElementById('addToPartyResult');
  const btn = document.getElementById('addToPartyBtn');
  btn.disabled = true;
  resultEl.classList.add('hidden');

  try {
    const r = await fetch(`/api/history/${state.currentPlayerCharacterId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { type: 'Player Character' } }),
    });
    if (!r.ok) throw new Error('Update failed');

    resultEl.textContent = '✓ Added to party';
    resultEl.className = 'text-xs text-center py-1 text-green-400';
    resultEl.classList.remove('hidden');
    btn.classList.add('hidden');

    await loadPartyRoster();
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-center py-1 text-red-400';
    resultEl.classList.remove('hidden');
    btn.disabled = false;
  }
}

export async function savePlayerCharacter() {
  if (!state.currentPlayerCharacter) return;
  const folder = document.getElementById('pcSaveFolder').value;
  setBusy('savePcBtn', 'savePcSpinner', 'savePcBtnText', true, 'Saving…');
  const resultEl = document.getElementById('savePcResult');
  resultEl.classList.add('hidden');

  try {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: state.currentPlayerCharacter, folder, history_id: state.currentPlayerCharacterId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const entry = state.partyEntries.find(e => e.id === state.currentPlayerCharacterId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
      renderPartyRoster();
    }

    resultEl.textContent = `✓ Saved to Docmost (page ${data.page_id})`;
    resultEl.className = 'text-xs text-center py-1 text-green-400';
    resultEl.classList.remove('hidden');
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-center py-1 text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('savePcBtn', 'savePcSpinner', 'savePcBtnText', false, 'Save to Docmost');
  }
}

export function _populatePcStatInputs(char) {
  if (!char || !char.ability_scores) return;
  const as = char.ability_scores;
  document.getElementById('pcEditStr').value = as.strength.total;
  document.getElementById('pcEditDex').value = as.dexterity.total;
  document.getElementById('pcEditCon').value = as.constitution.total;
  document.getElementById('pcEditInt').value = as.intelligence.total;
  document.getElementById('pcEditWis').value = as.wisdom.total;
  document.getElementById('pcEditCha').value = as.charisma.total;
}

export async function applyPcStatEdits() {
  if (!state.currentPlayerCharacter) return;
  const resultEl = document.getElementById('pcStatEditResult');
  resultEl.classList.add('hidden');

  const newTotals = {
    strength:     parseInt(document.getElementById('pcEditStr').value) || 10,
    dexterity:    parseInt(document.getElementById('pcEditDex').value) || 10,
    constitution: parseInt(document.getElementById('pcEditCon').value) || 10,
    intelligence: parseInt(document.getElementById('pcEditInt').value) || 10,
    wisdom:       parseInt(document.getElementById('pcEditWis').value) || 10,
    charisma:     parseInt(document.getElementById('pcEditCha').value) || 10,
  };

  const recalc = _recalcAbilityScores(state.currentPlayerCharacter, newTotals);
  state.currentPlayerCharacter = recalc;

  const sheet = document.getElementById('pcSheet');
  sheet.innerHTML = '';
  renderSheet(state.currentPlayerCharacter, sheet);

  if (state.currentPlayerCharacterId) {
    try {
      await fetch(`/api/history/${state.currentPlayerCharacterId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: {
          ability_scores: recalc.ability_scores,
          saving_throws: recalc.saving_throws,
          skills: recalc.skills,
          initiative: recalc.initiative,
          initiative_breakdown: recalc.initiative_breakdown,
          passive_perception: recalc.passive_perception,
          passive_perception_breakdown: recalc.passive_perception_breakdown,
          armor_class: recalc.armor_class,
          ...(recalc.spellcasting ? { spellcasting: recalc.spellcasting } : {}),
        }}),
      });
      resultEl.textContent = '✓ Stats updated';
      resultEl.className = 'text-xs text-center py-1 text-green-400';
    } catch {
      resultEl.textContent = '✓ Stats updated (not persisted)';
      resultEl.className = 'text-xs text-center py-1 text-amber-400';
    }
    resultEl.classList.remove('hidden');
  }
}

export function exportPcToPDF() {
  if (!state.currentPlayerCharacter) return;
  window.print();
}

export function exportPcToFoundryJSON() {
  if (!state.currentPlayerCharacter) return;
  const prev = state.currentCharacter;
  state.currentCharacter = state.currentPlayerCharacter;
  // Import exportToFoundryJSON lazily via window to avoid circular dep risk
  window.exportToFoundryJSON();
  state.currentCharacter = prev;
}
