// faction.js — faction generation, rendering, member management, editing
// Note: openFactionMemberModal calls window.openGenModal() at runtime
// to avoid circular imports with main.js.

import { el, setBusy, toast, buildContextNote, getContextId, cacheHistoryEntry, _renderAssocLinks, _apiDetail, _escHtml, _escAttr, _showTokenUsage, _editField, _editTextarea, _editSelect, _sectionLabel } from './utils.js';
import { state } from './state.js';

export async function generateFaction() {
  setBusy('generateFactionBtn', 'generateFactionSpinner', 'generateFactionBtnText', true, 'Generating…');
  document.getElementById('factionSheet').classList.add('hidden');
  document.getElementById('factionPlaceholder').classList.remove('hidden');
  document.getElementById('factionTokenUsage').classList.add('hidden');
  document.getElementById('factionSaveSection').classList.add('hidden');

  try {
    const body = {
      concept:          document.getElementById('factionConcept').value.trim(),
      faction_type:     document.getElementById('factionType').value,
      size:             document.getElementById('factionSize').value,
      alignment:        document.getElementById('factionAlignment').value,
      wealth:           document.getElementById('factionWealth').value,
      reputation:       document.getElementById('factionReputation').value,
      region:           document.getElementById('factionRegion').value.trim(),
      additional_notes: document.getElementById('factionNotes').value.trim(),
      parent_context_id: getContextId('factionAssocSelect'),
    };

    const r = await fetch('/api/generate-faction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(_apiDetail(err.detail, 'Generation failed'));
    }

    const data = await r.json();
    state.currentFaction = data.faction;
    state.currentFactionHistoryId = data.history_id ?? null;
    cacheHistoryEntry({ id: data.history_id, type: 'Faction', name: data.faction.name, faction_type: data.faction.faction_type, size: data.faction.size, alignment: data.faction.alignment, faction: { overview: data.faction.overview }, timestamp: new Date().toISOString() });

    document.getElementById('factionPlaceholder').classList.add('hidden');
    document.getElementById('factionSheet').classList.remove('hidden');
    renderFactionSheet(state.currentFaction, document.getElementById('factionSheet'));
    document.getElementById('factionSaveSection').classList.remove('hidden');
    _renderAssocLinks('factionAssocLinks', data.history_id, 'factionAssocSelect');
    _showTokenUsage(data.usage, 'factionTokenUsage');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    setBusy('generateFactionBtn', 'generateFactionSpinner', 'generateFactionBtnText', false, 'Generate Faction');
  }
}

export async function saveFaction() {
  if (!state.currentFaction) return;
  setBusy('saveFactionBtn', 'saveFactionSpinner', 'saveFactionBtnText', true, 'Saving…');

  try {
    const r = await fetch('/api/save-faction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faction: state.currentFaction, history_id: state.currentFactionHistoryId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const entry = state.historyEntries.find(e => e.id === state.currentFactionHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }
    state.currentFactionSynced = true;
    state.currentFactionDocmostUrl = data.docmost_url || null;
    renderFactionSheet(state.currentFaction, document.getElementById('factionSheet'), true, []);
    toast(`Saved to Factions / ${state.currentFaction.faction_type}`);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setBusy('saveFactionBtn', 'saveFactionSpinner', 'saveFactionBtnText', false, 'Save to Docmost');
  }
}

export function renderFactionSheet(faction, container, isSynced = false, linkedNpcs = []) {
  container.innerHTML = '';

  const ALIGNMENT_COLOR = {
    'Lawful Good': '#4a9eff', 'Neutral Good': '#4a7c59', 'Chaotic Good': '#8fbc8f',
    'Lawful Neutral': '#7a8fa6', 'True Neutral': '#8a7560', 'Chaotic Neutral': '#e07b39',
    'Lawful Evil': '#a335ee', 'Neutral Evil': '#8b1a1a', 'Chaotic Evil': '#cc2222',
  };
  const alignColor = ALIGNMENT_COLOR[faction.alignment] || '#8a7560';

  // Header
  const header = el('div', 'panel space-y-2');
  header.innerHTML = `
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold text-parchment">${_escHtml(faction.name)}</h2>
        <div class="flex flex-wrap gap-2 mt-1.5 text-xs">
          <span class="source-tag">${_escHtml(faction.faction_type)}</span>
          <span class="source-tag">${_escHtml(faction.size)}</span>
          <span class="source-tag" style="color:${alignColor};border-color:${alignColor}">${_escHtml(faction.alignment)}</span>
          <span class="source-tag text-gold">${_escHtml(faction.wealth)}</span>
        </div>
      </div>
    </div>
    <p class="text-sm text-gray-400 italic">"${_escHtml(faction.motto)}"</p>
    <p class="text-xs text-gray-500">${_escHtml(faction.public_reputation)}</p>
  `;
  container.appendChild(header);

  // Overview + Leadership side by side
  const row1 = el('div', 'grid grid-cols-1 lg:grid-cols-2 gap-4');

  const overviewPanel = el('div', 'panel space-y-2');
  overviewPanel.innerHTML = `<div class="section-header"><i class="fa-solid fa-scroll mr-1"></i>Overview</div>
    <div class="text-sm text-gray-300 leading-relaxed">${_escHtml(faction.overview).replace(/\n\n/g,'</p><p class="mt-2">').replace(/^/,'<p>').replace(/$/,'</p>')}</div>`;
  row1.appendChild(overviewPanel);

  const leaderPanel = el('div', 'panel space-y-3');
  leaderPanel.innerHTML = `<div class="section-header"><i class="fa-solid fa-crown mr-1"></i>Leadership</div>`;

  // Leader card
  const leaderCard = el('div', 'panel bg-[#1a1209] space-y-2');
  const leaderLinkedNpc = linkedNpcs.find(n => n.member_name === faction.leader.name);
  leaderCard.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="flex items-baseline gap-2">
          <span class="font-bold text-parchment">${_escHtml(faction.leader.name)}</span>
          <span class="text-xs text-gold">${_escHtml(faction.leader.title)}</span>
        </div>
        <div class="text-xs text-gray-500">${_escHtml(faction.leader.race)}</div>
        <div class="text-sm text-gray-300 mt-0.5">${_escHtml(faction.leader.description)}</div>
        ${leaderLinkedNpc ? `<a href="${_escAttr(leaderLinkedNpc.npc_docmost_url)}" target="_blank" rel="noopener" class="text-xs text-green-400 hover:underline mt-1 inline-block"><i class="fa-solid fa-arrow-up-right-from-square mr-1"></i>View in Docmost</a>` : ''}
      </div>
      <div class="flex flex-col gap-1 flex-shrink-0">
        ${isSynced && !leaderLinkedNpc ? `<button onclick="openFactionMemberModal(${_escAttr(JSON.stringify(faction.leader.name))},${_escAttr(JSON.stringify(faction.leader.title))},${_escAttr(JSON.stringify(faction.leader.race))},true)" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-user-plus mr-1"></i>Generate NPC</button>` : ''}
        <button onclick="regenerateFactionMemberUI(true, null)" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-rotate-right mr-1"></i>Regenerate</button>
      </div>
    </div>
  `;
  leaderPanel.appendChild(leaderCard);

  if (faction.notable_members && faction.notable_members.length) {
    const membersHeader = el('div', 'text-xs text-gray-500 uppercase font-bold tracking-wide mt-2 mb-1');
    membersHeader.textContent = 'Notable Members';
    leaderPanel.appendChild(membersHeader);
    faction.notable_members.forEach((m, idx) => {
      const memberLinkedNpc = linkedNpcs.find(n => n.member_name === m.name);
      const memberRow = el('div', 'panel bg-[#1a1209] space-y-1 mb-2');
      memberRow.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <span class="font-semibold text-parchment text-sm">${_escHtml(m.name)}</span>
            <span class="text-xs text-gold ml-1">${_escHtml(m.role)}</span>
            <p class="text-xs text-gray-300 mt-0.5">${_escHtml(m.description)}</p>
            ${memberLinkedNpc ? `<a href="${_escAttr(memberLinkedNpc.npc_docmost_url)}" target="_blank" rel="noopener" class="text-xs text-green-400 hover:underline mt-1 inline-block"><i class="fa-solid fa-arrow-up-right-from-square mr-1"></i>View in Docmost</a>` : ''}
          </div>
          <div class="flex flex-col gap-1 flex-shrink-0">
            ${isSynced && !memberLinkedNpc ? `<button onclick="openFactionMemberModal(${_escAttr(JSON.stringify(m.name))},${_escAttr(JSON.stringify(m.role))},'',false)" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-user-plus mr-1"></i>Generate NPC</button>` : ''}
            <button onclick="regenerateFactionMemberUI(false, ${idx})" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-rotate-right mr-1"></i>Regenerate</button>
            <button onclick="removeFactionMemberUI(${idx})" class="text-xs text-red-500 hover:text-red-300 py-1 px-2 text-right"><i class="fa-solid fa-trash mr-1"></i>Remove</button>
          </div>
        </div>
      `;
      leaderPanel.appendChild(memberRow);
    });
  }

  // Add Member button
  const addMemberBtn = el('button', 'btn-secondary text-xs py-1.5 px-3 w-full mt-2');
  addMemberBtn.innerHTML = '<i class="fa-solid fa-plus mr-1"></i>Add Member (Generate via Claude)';
  addMemberBtn.id = 'addFactionMemberBtn';
  addMemberBtn.onclick = addFactionMemberUI;
  leaderPanel.appendChild(addMemberBtn);

  row1.appendChild(leaderPanel);
  container.appendChild(row1);

  // History
  const historyPanel = el('div', 'panel space-y-2');
  historyPanel.innerHTML = `<div class="section-header"><i class="fa-solid fa-book-open mr-1"></i>History</div>
    <div class="text-sm text-gray-300 leading-relaxed">${_escHtml(faction.history).replace(/\n\n/g,'</p><p class="mt-2">').replace(/^/,'<p>').replace(/$/,'</p>')}</div>`;
  container.appendChild(historyPanel);

  // Goals + Methods
  const row2 = el('div', 'grid grid-cols-1 lg:grid-cols-2 gap-4');

  const goalsPanel = el('div', 'panel space-y-2');
  goalsPanel.innerHTML = `<div class="section-header"><i class="fa-solid fa-bullseye mr-1"></i>Goals</div>`;
  const goalsList = el('ul', 'space-y-1');
  for (const g of faction.goals) {
    const li = el('li', 'text-sm text-gray-300 flex gap-2');
    li.innerHTML = `<span class="text-gold mt-0.5 flex-shrink-0">›</span><span>${_escHtml(g)}</span>`;
    goalsList.appendChild(li);
  }
  goalsPanel.appendChild(goalsList);
  row2.appendChild(goalsPanel);

  const methodsPanel = el('div', 'panel space-y-2');
  methodsPanel.innerHTML = `<div class="section-header"><i class="fa-solid fa-chess mr-1"></i>Methods</div>`;
  const methodsList = el('ul', 'space-y-1');
  for (const m of faction.methods) {
    const li = el('li', 'text-sm text-gray-300 flex gap-2');
    li.innerHTML = `<span class="text-gold mt-0.5 flex-shrink-0">›</span><span>${_escHtml(m)}</span>`;
    methodsList.appendChild(li);
  }
  methodsPanel.appendChild(methodsList);
  row2.appendChild(methodsPanel);
  container.appendChild(row2);

  // Intelligence panel
  const intel = el('div', 'panel space-y-3');
  intel.innerHTML = `<div class="section-header"><i class="fa-solid fa-magnifying-glass mr-1"></i>Intelligence</div>`;
  const intelGrid = el('div', 'grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm');
  const fields = [
    ['Headquarters', faction.headquarters],
    ['Symbols', faction.symbols],
    faction.allies && faction.allies.length ? ['Allies', faction.allies.join(', ')] : null,
    faction.enemies && faction.enemies.length ? ['Enemies', faction.enemies.join(', ')] : null,
  ].filter(Boolean);
  for (const [label, value] of fields) {
    const d = el('div');
    d.innerHTML = `<span class="text-xs text-gray-500 uppercase font-bold">${label}</span><p class="text-gray-300 mt-0.5">${_escHtml(value)}</p>`;
    intelGrid.appendChild(d);
  }
  intel.appendChild(intelGrid);
  container.appendChild(intel);

  // Secrets (DM only)
  if (faction.secrets && faction.secrets.length) {
    const secrets = el('div', 'panel space-y-2 border-amber-900');
    secrets.style.borderColor = '#92400e';
    secrets.innerHTML = `<div class="section-header" style="color:#f59e0b;border-color:#92400e"><i class="fa-solid fa-eye-slash mr-1"></i>Secrets — DM Only</div>`;
    for (const s of faction.secrets) {
      const item = el('div', 'flex gap-2 text-sm text-amber-200');
      item.innerHTML = `<i class="fa-solid fa-lock text-amber-500 mt-0.5 flex-shrink-0 text-xs"></i><span>${_escHtml(s)}</span>`;
      secrets.appendChild(item);
    }
    container.appendChild(secrets);
  }

  // Connected NPCs
  if (linkedNpcs && linkedNpcs.length) {
    const npcPanel = el('div', 'panel space-y-2');
    npcPanel.innerHTML = `<div class="section-header"><i class="fa-solid fa-link mr-1"></i>Connected NPCs</div>`;
    for (const n of linkedNpcs) {
      const row = el('div', 'flex items-center justify-between text-sm py-1 border-b border-border last:border-0');
      row.innerHTML = `
        <div>
          <span class="font-semibold text-parchment">${_escHtml(n.npc_name)}</span>
          <span class="text-xs text-gold ml-2">${_escHtml(n.member_role)}</span>
        </div>
        <a href="${_escAttr(n.npc_docmost_url)}" target="_blank" rel="noopener" class="text-xs text-green-400 hover:underline flex-shrink-0"><i class="fa-solid fa-arrow-up-right-from-square mr-1"></i>View in Docmost</a>
      `;
      npcPanel.appendChild(row);
    }
    container.appendChild(npcPanel);
  }
}

export function openFactionMemberModal(memberName, memberRole, memberRace, isLeader) {
  if (!state.currentHistoryId && !state.currentFactionHistoryId) return;
  const histId = state.currentHistoryId || state.currentFactionHistoryId;
  const faction = state.currentFaction;
  if (!faction) return;

  const overviewExcerpt = (faction.overview || '').substring(0, 300);
  const additionalNotes =
    `This character is the ${memberRole} of ${faction.name}, a ${faction.size} ${faction.faction_type} (${faction.alignment}). ` +
    `Faction overview: ${overviewExcerpt}. ` +
    `Weave their faction membership naturally into the backstory and personality.`;

  state._modalFactionContext = {
    factionHistoryId: histId,
    memberName,
    memberRole,
    isLeader,
    additionalNotes,
  };

  window.openGenModal('npc', {
    name: memberName,
    concept: `${memberName}, ${memberRole} of ${faction.name}. ${isLeader ? (faction.leader?.description || '') : ''}`,
    race: memberRace || '',
  });
}

export async function regenerateFactionMemberUI(isLeader, memberIndex) {
  const histId = state.currentHistoryId || state.currentFactionHistoryId;
  if (!histId || !state.currentFaction) return;

  const btn = isLeader
    ? document.querySelector('[onclick^="regenerateFactionMemberUI(true"]')
    : document.querySelectorAll('[onclick^="regenerateFactionMemberUI(false"]')[memberIndex];
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Regenerating…'; }

  try {
    const r = await fetch(`/api/faction/${histId}/regenerate-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_leader: isLeader, member_index: memberIndex }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Failed');

    if (isLeader) {
      state.currentFaction = { ...state.currentFaction, leader: data.member };
    } else {
      const members = [...(state.currentFaction.notable_members || [])];
      members[memberIndex] = data.member;
      state.currentFaction = { ...state.currentFaction, notable_members: members };
    }

    await _saveFactionMemberChanges();
  } catch (e) {
    toast(`Regenerate failed: ${e.message}`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate-right mr-1"></i>Regenerate'; }
  }
}

export async function addFactionMemberUI() {
  const histId = state.currentHistoryId || state.currentFactionHistoryId;
  if (!histId || !state.currentFaction) return;

  const btn = document.getElementById('addFactionMemberBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Generating…'; }

  try {
    const r = await fetch(`/api/faction/${histId}/regenerate-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_leader: false, member_index: null }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Failed');

    const members = [...(state.currentFaction.notable_members || []), data.member];
    state.currentFaction = { ...state.currentFaction, notable_members: members };
    await _saveFactionMemberChanges();
  } catch (e) {
    toast(`Add member failed: ${e.message}`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus mr-1"></i>Add Member (Generate via Claude)'; }
  }
}

export async function removeFactionMemberUI(memberIndex) {
  if (!state.currentFaction) return;
  const members = [...(state.currentFaction.notable_members || [])];
  members.splice(memberIndex, 1);
  state.currentFaction = { ...state.currentFaction, notable_members: members };
  await _saveFactionMemberChanges();
}

export async function _saveFactionMemberChanges() {
  const histId = state.currentHistoryId || state.currentFactionHistoryId;
  if (!histId) return;

  try {
    await fetch(`/api/history/${histId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { leader: state.currentFaction.leader, notable_members: state.currentFaction.notable_members } }),
    });
  } catch (e) {
    console.warn('Could not save faction member changes:', e);
  }

  const entry = state.historyEntries.find(e => e.id === histId);
  if (entry && entry.faction) {
    entry.faction.leader = state.currentFaction.leader;
    entry.faction.notable_members = state.currentFaction.notable_members;
  }

  const container = document.getElementById('historySheet') || document.getElementById('factionSheet');
  if (container) {
    const linkedNpcs = entry?.linked_npcs || [];
    renderFactionSheet(state.currentFaction, container, state.currentFactionSynced, linkedNpcs);
  }
}

export function _buildFactionEditForm(faction) {
  const form = el('div', 'space-y-4');
  const FACTION_TYPES = ['Government','Guild','Rebel Group','Traveling Group','Military Order','Criminal Syndicate','Religious Order','Secret Society','Merchant Company'];
  const SIZES = ['Tiny','Small','Medium','Large','Massive'];
  const ALIGNMENTS = ['Lawful Good','Neutral Good','Chaotic Good','Lawful Neutral','True Neutral','Chaotic Neutral','Lawful Evil','Neutral Evil','Chaotic Evil'];

  const basics = el('div', 'panel space-y-3');
  basics.appendChild(_sectionLabel('Basics'));
  const r1 = el('div', 'grid grid-cols-3 gap-3');
  r1.appendChild(_editField('edit_faction_name', 'Name', faction.name));
  r1.appendChild(_editSelect('edit_faction_type', 'Type', FACTION_TYPES, faction.faction_type));
  r1.appendChild(_editSelect('edit_faction_size', 'Size', SIZES, faction.size));
  basics.appendChild(r1);
  const r2 = el('div', 'grid grid-cols-2 gap-3');
  r2.appendChild(_editSelect('edit_faction_alignment', 'Alignment', ALIGNMENTS, faction.alignment));
  r2.appendChild(_editField('edit_faction_motto', 'Motto', faction.motto));
  basics.appendChild(r2);
  form.appendChild(basics);

  const desc = el('div', 'panel space-y-3');
  desc.appendChild(_sectionLabel('Description'));
  desc.appendChild(_editTextarea('edit_faction_overview', 'Overview', faction.overview, 5));
  desc.appendChild(_editTextarea('edit_faction_history', 'History', faction.history, 4));
  desc.appendChild(_editField('edit_faction_hq', 'Headquarters', faction.headquarters));
  desc.appendChild(_editField('edit_faction_symbols', 'Symbols', faction.symbols));
  form.appendChild(desc);

  const lists = el('div', 'panel space-y-3');
  lists.appendChild(_sectionLabel('Goals, Methods & Secrets'));
  lists.appendChild(_editTextarea('edit_faction_goals', 'Goals (one per line)', (faction.goals || []).join('\n'), 4));
  lists.appendChild(_editTextarea('edit_faction_methods', 'Methods (one per line)', (faction.methods || []).join('\n'), 4));
  lists.appendChild(_editTextarea('edit_faction_secrets', 'Secrets — DM Only (one per line)', (faction.secrets || []).join('\n'), 3));
  lists.appendChild(_editTextarea('edit_faction_allies', 'Allies (one per line)', (faction.allies || []).join('\n'), 2));
  lists.appendChild(_editTextarea('edit_faction_enemies', 'Enemies (one per line)', (faction.enemies || []).join('\n'), 2));
  form.appendChild(lists);

  const leader = el('div', 'panel space-y-3');
  leader.appendChild(_sectionLabel('Leader'));
  const lr = el('div', 'grid grid-cols-2 gap-3');
  lr.appendChild(_editField('edit_leader_name', 'Name', faction.leader.name));
  lr.appendChild(_editField('edit_leader_title', 'Title', faction.leader.title));
  leader.appendChild(lr);
  const lr2 = el('div', 'grid grid-cols-2 gap-3');
  lr2.appendChild(_editField('edit_leader_race', 'Race', faction.leader.race));
  leader.appendChild(lr2);
  leader.appendChild(_editTextarea('edit_leader_description', 'Description', faction.leader.description, 2));
  form.appendChild(leader);

  return form;
}

export function _collectFactionEdits() {
  const splitLines = id => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  return {
    name:             document.getElementById('edit_faction_name').value.trim(),
    faction_type:     document.getElementById('edit_faction_type').value,
    size:             document.getElementById('edit_faction_size').value,
    alignment:        document.getElementById('edit_faction_alignment').value,
    motto:            document.getElementById('edit_faction_motto').value.trim(),
    overview:         document.getElementById('edit_faction_overview').value.trim(),
    history:          document.getElementById('edit_faction_history').value.trim(),
    headquarters:     document.getElementById('edit_faction_hq').value.trim(),
    symbols:          document.getElementById('edit_faction_symbols').value.trim(),
    goals:            splitLines('edit_faction_goals'),
    methods:          splitLines('edit_faction_methods'),
    secrets:          splitLines('edit_faction_secrets'),
    allies:           splitLines('edit_faction_allies'),
    enemies:          splitLines('edit_faction_enemies'),
    leader: {
      name:        document.getElementById('edit_leader_name').value.trim(),
      title:       document.getElementById('edit_leader_title').value.trim(),
      race:        document.getElementById('edit_leader_race').value.trim(),
      description: document.getElementById('edit_leader_description').value.trim(),
    },
    notable_members: state.currentFaction?.notable_members || [],
  };
}
