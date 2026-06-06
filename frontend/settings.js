// settings.js — settings + token stats

import { setBusy } from './utils.js';
import { state } from './state.js';

export async function loadTokenStats() {
  const loadingEl = document.getElementById('tokenStatsLoading');
  const panelEl = document.getElementById('tokenStatsPanel');
  loadingEl.textContent = 'Loading…';
  loadingEl.classList.remove('hidden');
  panelEl.classList.add('hidden');
  try {
    const r = await fetch('/api/token-stats');
    if (!r.ok) throw new Error();
    const stats = await r.json();

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });
    const month = stats.monthly?.[monthKey] || { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 };
    const all = stats.all_time || { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 };

    const fmt = n => n.toLocaleString();
    const fmtCost = c => c < 0.001 ? `< $0.001` : `$${c.toFixed(4)}`;

    document.getElementById('statsMonthLabel').textContent = monthLabel;
    document.getElementById('statsAllInput').textContent = fmt(all.input_tokens);
    document.getElementById('statsAllOutput').textContent = fmt(all.output_tokens);
    document.getElementById('statsAllTotal').textContent = fmt(all.total_tokens);
    document.getElementById('statsAllCost').textContent = fmtCost(all.cost_usd);
    document.getElementById('statsMonthInput').textContent = fmt(month.input_tokens);
    document.getElementById('statsMonthOutput').textContent = fmt(month.output_tokens);
    document.getElementById('statsMonthTotal').textContent = fmt(month.total_tokens);
    document.getElementById('statsMonthCost').textContent = fmtCost(month.cost_usd);

    loadingEl.classList.add('hidden');
    panelEl.classList.remove('hidden');
  } catch {
    loadingEl.textContent = 'Could not load token stats.';
  }
}

export async function loadSettings() {
  loadTokenStats();
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) throw new Error('Failed to load settings');
    const s = await r.json();
    const campaignName = s.campaign_name || '';
    document.getElementById('settingCampaignName').value = campaignName;
    document.getElementById('campaignName').textContent = campaignName;
    document.getElementById('settingApiKey').value = s.anthropic_api_key || '';
    document.getElementById('settingClaudeModel').value = s.claude_model || '';
    document.getElementById('settingLowTokenMode').checked = !!s.low_token_mode;
    document.getElementById('settingDocmostUrl').value = s.docmost_url || '';
    document.getElementById('settingDocmostUser').value = s.docmost_username || '';
    document.getElementById('settingDocmostPass').value = s.docmost_password || '';
    document.getElementById('settingFolderUrlNpcs').value = s.folder_url_npcs || '';
    document.getElementById('settingFolderUrlBestiary').value = s.folder_url_bestiary || '';
    document.getElementById('settingFolderUrlLocations').value = s.folder_url_locations || '';
    document.getElementById('settingFolderUrlEncounters').value = s.folder_url_encounters || '';
    document.getElementById('settingFolderUrlItems').value = s.folder_url_items || '';
    document.getElementById('settingFolderUrlFactions').value = s.folder_url_factions || '';
    document.getElementById('settingFolderUrlPlayers').value = s.folder_url_players || '';
    for (const key of ['Npcs', 'Bestiary', 'Locations', 'Encounters', 'Items', 'Factions', 'Players']) {
      document.getElementById(`testResult${key}`).classList.add('hidden');
    }
    // Validation limits
    const lim = state.limits;
    lim.max_concept_length   = s.max_concept_length   ?? 1000;
    lim.max_notes_length     = s.max_notes_length      ?? 500;
    lim.max_character_level  = s.max_character_level   ?? 20;
    lim.max_shop_items       = s.max_shop_items        ?? 20;
    document.getElementById('settingMaxConceptLength').value  = lim.max_concept_length;
    document.getElementById('settingMaxNotesLength').value    = lim.max_notes_length;
    document.getElementById('settingMaxCharacterLevel').value = lim.max_character_level;
    document.getElementById('settingMaxShopItems').value      = lim.max_shop_items;
    if (typeof window.refreshCounterLimits === 'function') window.refreshCounterLimits();
  } catch (e) {
    console.error('Could not load settings:', e);
  }
}

export async function saveSettings() {
  setBusy('settingsSaveBtn', 'settingsSaveSpinner', 'settingsSaveBtnText', true, 'Saving…');
  const resultEl = document.getElementById('settingsSaveResult');
  resultEl.classList.add('hidden');

  const body = {
    campaign_name: document.getElementById('settingCampaignName').value.trim(),
    anthropic_api_key: document.getElementById('settingApiKey').value,
    claude_model: document.getElementById('settingClaudeModel').value.trim(),
    low_token_mode: document.getElementById('settingLowTokenMode').checked,
    docmost_url: document.getElementById('settingDocmostUrl').value.trim(),
    docmost_username: document.getElementById('settingDocmostUser').value.trim(),
    docmost_password: document.getElementById('settingDocmostPass').value,
    folder_url_npcs: document.getElementById('settingFolderUrlNpcs').value.trim(),
    folder_url_bestiary: document.getElementById('settingFolderUrlBestiary').value.trim(),
    folder_url_locations: document.getElementById('settingFolderUrlLocations').value.trim(),
    folder_url_encounters: document.getElementById('settingFolderUrlEncounters').value.trim(),
    folder_url_items: document.getElementById('settingFolderUrlItems').value.trim(),
    folder_url_factions: document.getElementById('settingFolderUrlFactions').value.trim(),
    folder_url_players: document.getElementById('settingFolderUrlPlayers').value.trim(),
    max_concept_length:  parseInt(document.getElementById('settingMaxConceptLength').value)  || 1000,
    max_notes_length:    parseInt(document.getElementById('settingMaxNotesLength').value)    || 500,
    max_character_level: parseInt(document.getElementById('settingMaxCharacterLevel').value) || 20,
    max_shop_items:      parseInt(document.getElementById('settingMaxShopItems').value)      || 20,
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

    document.getElementById('campaignName').textContent = body.campaign_name;

    // Update live limits and counters
    state.limits.max_concept_length  = body.max_concept_length;
    state.limits.max_notes_length    = body.max_notes_length;
    state.limits.max_character_level = body.max_character_level;
    state.limits.max_shop_items      = body.max_shop_items;
    if (typeof window.refreshCounterLimits === 'function') window.refreshCounterLimits();

    // Refresh the folder dropdowns
    await window.loadConfig();
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('settingsSaveBtn', 'settingsSaveSpinner', 'settingsSaveBtnText', false, 'Save Settings');
  }
}

export async function testPageUrl(key, inputId) {
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

export function toggleVisible(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}
