// bestiary.js — bestiary/monster generation, rendering, and editing

import { el, sectionHeader, setBusy, _escHtml, _showTokenUsage, _editField, _editTextarea, _sectionLabel } from './utils.js';
import { state } from './state.js';

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export async function generateBestiary() {
  setBusy('generateBestiaryBtn', 'generateBestiarySpinner', 'generateBestiaryBtnText', true, 'Generating…');
  document.getElementById('bestiaryResultContainer').innerHTML = '';
  document.getElementById('bestiaryResultContainer').classList.add('hidden');
  document.getElementById('bestiaryPlaceholder').classList.remove('hidden');
  document.getElementById('bestiaryTokenUsage').classList.add('hidden');
  document.getElementById('bestiarySaveSection').classList.add('hidden');

  try {
    const body = {
      concept:          document.getElementById('bestiaryConcept').value.trim(),
      monster_type:     document.getElementById('bestiaryType').value,
      size:             document.getElementById('bestiarySize').value,
      cr:               document.getElementById('bestiaryCR').value,
      alignment:        document.getElementById('bestiaryAlignment').value,
      environment:      document.getElementById('bestiaryEnvironment').value.trim(),
      additional_notes: document.getElementById('bestiaryNotes').value.trim(),
    };

    const r = await fetch('/api/generate-bestiary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.detail || 'Generation failed');
    }

    const data = await r.json();
    state.currentMonster = data.monster;
    state.currentMonsterHistoryId = data.history_id ?? null;
    state.currentMonsterSynced = false;
    state.currentMonsterDocmostUrl = null;

    document.getElementById('bestiaryPlaceholder').classList.add('hidden');
    const container = document.getElementById('bestiaryResultContainer');
    container.classList.remove('hidden');
    renderBestiarySheet(state.currentMonster, container, false);
    document.getElementById('bestiarySaveSection').classList.remove('hidden');
    _showTokenUsage(data.usage, 'bestiaryTokenUsage');
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    setBusy('generateBestiaryBtn', 'generateBestiarySpinner', 'generateBestiaryBtnText', false, 'Generate Monster');
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function saveBestiary() {
  if (!state.currentMonster) return;
  setBusy('saveBestiaryBtn', 'saveBestiarySpinner', 'saveBestiaryBtnText', true, 'Saving…');
  const resultEl = document.getElementById('bestiarySaveResult');
  resultEl.classList.add('hidden');

  try {
    const r = await fetch('/api/save-bestiary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monster: state.currentMonster, history_id: state.currentMonsterHistoryId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const entry = state.historyEntries.find(e => e.id === state.currentMonsterHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }
    state.currentMonsterSynced = true;
    state.currentMonsterDocmostUrl = data.docmost_url || null;
    renderBestiarySheet(state.currentMonster, document.getElementById('bestiaryResultContainer'), true);

    resultEl.textContent = `✓ Saved to Bestiary / ${state.currentMonster.monster_type}`;
    resultEl.className = 'text-xs text-center py-1 text-green-400';
    resultEl.classList.remove('hidden');
  } catch (e) {
    resultEl.textContent = `✗ ${e.message}`;
    resultEl.className = 'text-xs text-center py-1 text-red-400';
    resultEl.classList.remove('hidden');
  } finally {
    setBusy('saveBestiaryBtn', 'saveBestiarySpinner', 'saveBestiaryBtnText', false, 'Save to Docmost');
  }
}

// ---------------------------------------------------------------------------
// Render stat block
// ---------------------------------------------------------------------------

export function renderBestiarySheet(monster, container, isSynced = false) {
  container.innerHTML = '';

  function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

  function _sep() {
    const d = el('div', 'border-t border-red-900 my-2');
    return d;
  }

  // Outer card styled like classic D&D stat block
  const card = el('div', 'panel space-y-0');
  card.style.borderColor = '#7a1a1a';
  card.style.background = '#1e0e0e';

  // Monster name
  const nameEl = el('h2', 'text-xl font-bold text-red-200 mb-0.5');
  nameEl.textContent = monster.name;
  card.appendChild(nameEl);

  // Size type alignment line
  const subtypeStr = monster.subtype ? ` (${monster.subtype})` : '';
  const typeLineEl = el('p', 'text-sm italic text-red-300 mb-2');
  typeLineEl.textContent = `${monster.size} ${monster.monster_type}${subtypeStr}, ${monster.alignment}`;
  card.appendChild(typeLineEl);

  card.appendChild(_sep());

  // AC / HP / Speed
  const speed = monster.speed;
  const speedParts = [];
  if (speed.walk) speedParts.push(`${speed.walk} ft.`);
  if (speed.fly) speedParts.push(`fly ${speed.fly} ft.${speed.hover ? ' (hover)' : ''}`);
  if (speed.swim) speedParts.push(`swim ${speed.swim} ft.`);
  if (speed.burrow) speedParts.push(`burrow ${speed.burrow} ft.`);
  if (speed.climb) speedParts.push(`climb ${speed.climb} ft.`);
  const speedStr = speedParts.join(', ') || '0 ft.';
  const acStr = monster.armor_type ? `${monster.armor_class} (${monster.armor_type})` : String(monster.armor_class);

  const coreDiv = el('div', 'space-y-0.5 text-sm mb-2');
  coreDiv.innerHTML = `
    <div><span class="font-bold text-red-300">Armor Class</span> <span class="text-parchment">${_escHtml(acStr)}</span></div>
    <div><span class="font-bold text-red-300">Hit Points</span> <span class="text-parchment">${monster.hit_points} (${_escHtml(monster.hit_dice)})</span></div>
    <div><span class="font-bold text-red-300">Speed</span> <span class="text-parchment">${_escHtml(speedStr)}</span></div>
  `;
  card.appendChild(coreDiv);

  card.appendChild(_sep());

  // Ability scores grid
  const ABILITIES = [
    ['STR', 'strength'], ['DEX', 'dexterity'], ['CON', 'constitution'],
    ['INT', 'intelligence'], ['WIS', 'wisdom'], ['CHA', 'charisma'],
  ];
  const abilityGrid = el('div', 'grid grid-cols-6 gap-1 text-center mb-2');
  for (const [abbr, key] of ABILITIES) {
    const ab = monster.ability_scores[key];
    const cell = el('div', 'stat-box');
    cell.innerHTML = `<div class="text-[10px] text-red-400 font-bold uppercase">${abbr}</div><div class="text-sm font-bold text-parchment">${ab.score}</div><div class="text-xs text-gray-400">(${sign(ab.modifier)})</div>`;
    abilityGrid.appendChild(cell);
  }
  card.appendChild(abilityGrid);

  card.appendChild(_sep());

  // Properties block
  const propsDiv = el('div', 'space-y-0.5 text-sm mb-2');

  function propLine(label, value) {
    const d = el('div');
    d.innerHTML = `<span class="font-bold text-red-300">${label}</span> <span class="text-parchment">${value}</span>`;
    return d;
  }

  if (monster.saving_throws && Object.keys(monster.saving_throws).length) {
    const saves = Object.entries(monster.saving_throws)
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1, 3)} ${sign(v)}`).join(', ');
    propsDiv.appendChild(propLine('Saving Throws', saves));
  }
  if (monster.skills && Object.keys(monster.skills).length) {
    const skills = Object.entries(monster.skills)
      .map(([k, v]) => `${k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} ${sign(v)}`).join(', ');
    propsDiv.appendChild(propLine('Skills', skills));
  }
  if (monster.damage_vulnerabilities && monster.damage_vulnerabilities.length) {
    propsDiv.appendChild(propLine('Damage Vulnerabilities', monster.damage_vulnerabilities.join(', ')));
  }
  if (monster.damage_resistances && monster.damage_resistances.length) {
    propsDiv.appendChild(propLine('Damage Resistances', monster.damage_resistances.join(', ')));
  }
  if (monster.damage_immunities && monster.damage_immunities.length) {
    propsDiv.appendChild(propLine('Damage Immunities', monster.damage_immunities.join(', ')));
  }
  if (monster.condition_immunities && monster.condition_immunities.length) {
    propsDiv.appendChild(propLine('Condition Immunities', monster.condition_immunities.join(', ')));
  }

  const sensesStr = monster.senses && monster.senses.length
    ? `${monster.senses.join(', ')}, passive Perception ${monster.passive_perception}`
    : `passive Perception ${monster.passive_perception}`;
  propsDiv.appendChild(propLine('Senses', sensesStr));

  const langStr = monster.languages && monster.languages.length ? monster.languages.join(', ') : '—';
  propsDiv.appendChild(propLine('Languages', langStr));

  propsDiv.innerHTML += `<div><span class="font-bold text-red-300">Challenge</span> <span class="text-parchment">${_escHtml(monster.challenge_rating)} (${(monster.xp || 0).toLocaleString()} XP)</span> <span class="text-gray-500">·</span> <span class="font-bold text-red-300">Proficiency Bonus</span> <span class="text-parchment">${sign(monster.proficiency_bonus)}</span></div>`;

  card.appendChild(propsDiv);

  card.appendChild(_sep());

  // Special traits
  if (monster.special_traits && monster.special_traits.length) {
    const traitsDiv = el('div', 'space-y-1.5 mb-2 text-sm');
    for (const trait of monster.special_traits) {
      const t = el('p', 'text-gray-300 leading-relaxed');
      t.innerHTML = `<span class="font-bold italic text-parchment">${_escHtml(trait.name)}.</span> ${_escHtml(trait.description)}`;
      traitsDiv.appendChild(t);
    }
    card.appendChild(traitsDiv);
  }

  // Actions
  if (monster.actions && monster.actions.length) {
    const actHeader = el('div', 'section-header mt-2 mb-1');
    actHeader.style.color = '#c0392b';
    actHeader.style.borderColor = '#7a1a1a';
    actHeader.textContent = 'Actions';
    card.appendChild(actHeader);
    const actDiv = el('div', 'space-y-1.5 text-sm');
    for (const action of monster.actions) {
      const a = el('p', 'text-gray-300 leading-relaxed');
      a.innerHTML = `<span class="font-bold italic text-parchment">${_escHtml(action.name)}.</span> ${_escHtml(action.description)}`;
      actDiv.appendChild(a);
    }
    card.appendChild(actDiv);
  }

  // Bonus Actions
  if (monster.bonus_actions && monster.bonus_actions.length) {
    const baHeader = el('div', 'section-header mt-2 mb-1');
    baHeader.style.color = '#c0392b';
    baHeader.style.borderColor = '#7a1a1a';
    baHeader.textContent = 'Bonus Actions';
    card.appendChild(baHeader);
    const baDiv = el('div', 'space-y-1.5 text-sm');
    for (const ba of monster.bonus_actions) {
      const b = el('p', 'text-gray-300 leading-relaxed');
      b.innerHTML = `<span class="font-bold italic text-parchment">${_escHtml(ba.name)}.</span> ${_escHtml(ba.description)}`;
      baDiv.appendChild(b);
    }
    card.appendChild(baDiv);
  }

  // Reactions
  if (monster.reactions && monster.reactions.length) {
    const rHeader = el('div', 'section-header mt-2 mb-1');
    rHeader.style.color = '#c0392b';
    rHeader.style.borderColor = '#7a1a1a';
    rHeader.textContent = 'Reactions';
    card.appendChild(rHeader);
    const rDiv = el('div', 'space-y-1.5 text-sm');
    for (const reaction of monster.reactions) {
      const r = el('p', 'text-gray-300 leading-relaxed');
      r.innerHTML = `<span class="font-bold italic text-parchment">${_escHtml(reaction.name)}.</span> ${_escHtml(reaction.description)}`;
      rDiv.appendChild(r);
    }
    card.appendChild(rDiv);
  }

  // Legendary Actions
  if (monster.legendary_actions && monster.legendary_actions.length) {
    const laHeader = el('div', 'section-header mt-2 mb-1');
    laHeader.style.color = '#c0392b';
    laHeader.style.borderColor = '#7a1a1a';
    laHeader.textContent = 'Legendary Actions';
    card.appendChild(laHeader);
    if (monster.legendary_resistance_count) {
      const note = el('p', 'text-xs text-gray-500 italic mb-1');
      note.textContent = `The ${monster.name} can take 3 legendary actions per round. Only one at the end of another creature's turn. Regains at start of its turn.`;
      card.appendChild(note);
    }
    const laDiv = el('div', 'space-y-1.5 text-sm');
    for (const la of monster.legendary_actions) {
      const costStr = la.cost > 1 ? ` (Costs ${la.cost} Actions)` : '';
      const l = el('p', 'text-gray-300 leading-relaxed');
      l.innerHTML = `<span class="font-bold italic text-parchment">${_escHtml(la.name)}${_escHtml(costStr)}.</span> ${_escHtml(la.description)}`;
      laDiv.appendChild(l);
    }
    card.appendChild(laDiv);
  }

  // Lair Actions
  if (monster.lair_actions && monster.lair_actions.length) {
    const lairHeader = el('div', 'section-header mt-2 mb-1');
    lairHeader.style.color = '#c0392b';
    lairHeader.style.borderColor = '#7a1a1a';
    lairHeader.textContent = 'Lair Actions';
    card.appendChild(lairHeader);
    const lairDiv = el('div', 'space-y-1.5 text-sm');
    for (const la of monster.lair_actions) {
      const l = el('p', 'text-gray-300 leading-relaxed');
      l.innerHTML = `<span class="font-bold italic text-parchment">${_escHtml(la.name)}.</span> ${_escHtml(la.description)}`;
      lairDiv.appendChild(l);
    }
    card.appendChild(lairDiv);
  }

  container.appendChild(card);

  // Flavor sections below the stat block
  const flavorSections = [
    ['description', 'Description', 'fa-solid fa-eye'],
    ['ecology',     'Ecology',     'fa-solid fa-leaf'],
    ['tactics',     'Tactics',     'fa-solid fa-chess-knight'],
    ['lore',        'Lore',        'fa-solid fa-book'],
  ];

  for (const [field, label, icon] of flavorSections) {
    const text = monster[field];
    if (!text) continue;
    const panel = el('div', 'panel space-y-2');
    panel.innerHTML = `<div class="section-header"><i class="${icon} mr-1"></i>${label}</div>`;
    const paras = text.split(/\n\n+/);
    const content = el('div', 'text-sm text-gray-300 leading-relaxed space-y-2');
    for (const para of paras) {
      const p = el('p');
      p.textContent = para.trim();
      content.appendChild(p);
    }
    panel.appendChild(content);
    container.appendChild(panel);
  }
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

export function _buildBestiaryEditForm(monster) {
  const form = el('div', 'space-y-4');

  const MONSTER_TYPES = [
    'Aberration', 'Beast', 'Celestial', 'Construct', 'Dragon', 'Elemental',
    'Fey', 'Fiend', 'Giant', 'Humanoid', 'Monstrosity', 'Ooze', 'Plant', 'Undead',
  ];
  const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
  const ALIGNMENTS = [
    'Lawful Good', 'Neutral Good', 'Chaotic Good',
    'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
    'Lawful Evil', 'Neutral Evil', 'Chaotic Evil',
    'Unaligned', 'Any',
  ];

  // Basics panel
  const basics = el('div', 'panel space-y-3');
  basics.appendChild(_sectionLabel('Basics'));

  const r1 = el('div', 'grid grid-cols-3 gap-3');
  r1.appendChild(_editField('edit_monster_name', 'Name', monster.name));

  const typeWrap = el('div');
  typeWrap.innerHTML = `<label class="text-xs text-gray-400 block mb-1">Type</label>
    <select id="edit_monster_type" class="input-field text-sm w-full">${MONSTER_TYPES.map(t => `<option value="${t}"${t === monster.monster_type ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  r1.appendChild(typeWrap);

  const sizeWrap = el('div');
  sizeWrap.innerHTML = `<label class="text-xs text-gray-400 block mb-1">Size</label>
    <select id="edit_monster_size" class="input-field text-sm w-full">${SIZES.map(s => `<option value="${s}"${s === monster.size ? ' selected' : ''}>${s}</option>`).join('')}</select>`;
  r1.appendChild(sizeWrap);

  basics.appendChild(r1);

  const r2 = el('div', 'grid grid-cols-2 gap-3');
  const alignWrap = el('div');
  alignWrap.innerHTML = `<label class="text-xs text-gray-400 block mb-1">Alignment</label>
    <select id="edit_monster_alignment" class="input-field text-sm w-full">${ALIGNMENTS.map(a => `<option value="${a}"${a === monster.alignment ? ' selected' : ''}>${a}</option>`).join('')}</select>`;
  r2.appendChild(alignWrap);
  r2.appendChild(_editField('edit_monster_subtype', 'Subtype', monster.subtype || ''));
  basics.appendChild(r2);

  form.appendChild(basics);

  // Flavor panel
  const flavor = el('div', 'panel space-y-3');
  flavor.appendChild(_sectionLabel('Flavor Text'));
  flavor.appendChild(_editTextarea('edit_monster_description', 'Description', monster.description || '', 4));
  flavor.appendChild(_editTextarea('edit_monster_ecology', 'Ecology', monster.ecology || '', 3));
  flavor.appendChild(_editTextarea('edit_monster_tactics', 'Tactics', monster.tactics || '', 3));
  flavor.appendChild(_editTextarea('edit_monster_lore', 'Lore', monster.lore || '', 3));
  form.appendChild(flavor);

  return form;
}

export function _collectBestiaryEdits() {
  return {
    name:        document.getElementById('edit_monster_name').value.trim(),
    monster_type: document.getElementById('edit_monster_type').value,
    size:        document.getElementById('edit_monster_size').value,
    alignment:   document.getElementById('edit_monster_alignment').value,
    subtype:     document.getElementById('edit_monster_subtype').value.trim(),
    description: document.getElementById('edit_monster_description').value.trim(),
    ecology:     document.getElementById('edit_monster_ecology').value.trim(),
    tactics:     document.getElementById('edit_monster_tactics').value.trim(),
    lore:        document.getElementById('edit_monster_lore').value.trim(),
  };
}

// ---------------------------------------------------------------------------
// VTT Export
// ---------------------------------------------------------------------------

export function exportMonsterToFoundryJSON(monster) {
  if (!monster) return;

  const sizeMap = { Tiny:'tiny', Small:'sm', Medium:'med', Large:'lg', Huge:'huge', Gargantuan:'grg' };
  const typeMap = {
    Aberration:'aberration', Beast:'beast', Celestial:'celestial', Construct:'construct',
    Dragon:'dragon', Elemental:'elemental', Fey:'fey', Fiend:'fiend', Giant:'giant',
    Humanoid:'humanoid', Monstrosity:'monstrosity', Ooze:'ooze', Plant:'plant', Undead:'undead',
  };
  const crFractions = { '1/8': 0.125, '1/4': 0.25, '1/2': 0.5 };
  const crFloat = crFractions[monster.challenge_rating] ?? (parseFloat(monster.challenge_rating) || 0);

  const abilityKeys = { strength:'str', dexterity:'dex', constitution:'con', intelligence:'int', wisdom:'wis', charisma:'cha' };
  const abilities = {};
  for (const [full, abbr] of Object.entries(abilityKeys)) {
    const s = monster.ability_scores[full];
    abilities[abbr] = { value: s.score };
  }
  const saveNameMap = { STR:'str', DEX:'dex', CON:'con', INT:'int', WIS:'wis', CHA:'cha',
    Str:'str', Dex:'dex', Con:'con', Int:'int', Wis:'wis', Cha:'cha' };
  for (const key of Object.keys(monster.saving_throws || {})) {
    const abbr = saveNameMap[key];
    if (abbr) abilities[abbr].proficient = 1;
  }

  const skillAbilityMap = {
    acr:'dex', ani:'wis', arc:'int', ath:'str', dec:'cha', his:'int', ins:'wis', itm:'cha',
    inv:'int', med:'wis', nat:'int', prc:'wis', prf:'cha', per:'cha', rel:'int', slt:'dex', ste:'dex', sur:'wis',
  };
  const skillNameToKey = {
    'Acrobatics':'acr', 'Animal Handling':'ani', 'Arcana':'arc', 'Athletics':'ath',
    'Deception':'dec', 'History':'his', 'Insight':'ins', 'Intimidation':'itm',
    'Investigation':'inv', 'Medicine':'med', 'Nature':'nat', 'Perception':'prc',
    'Performance':'prf', 'Persuasion':'per', 'Religion':'rel',
    'Sleight of Hand':'slt', 'Stealth':'ste', 'Survival':'sur',
  };
  const skills = {};
  for (const name of Object.keys(monster.skills || {})) {
    const key = skillNameToKey[name];
    if (key) skills[key] = { value: 1, ability: skillAbilityMap[key] };
  }

  const senses = { darkvision:0, blindsight:0, tremorsense:0, truesight:0, units:'ft', special:'' };
  for (const s of (monster.senses || [])) {
    for (const t of ['darkvision', 'blindsight', 'tremorsense', 'truesight']) {
      if (s.toLowerCase().includes(t)) {
        const m = s.match(/(\d+)/);
        if (m) senses[t] = parseInt(m[1]);
      }
    }
  }

  const items = [];
  const addFeat = (name, desc, activation, cost = 1) => items.push({
    name, type: 'feat', img: 'icons/svg/upgrade.svg',
    system: { description: { value: desc || '' }, activation: { type: activation, cost, condition: '' }, type: { value: 'monster', subtype: '' } },
  });
  for (const t of (monster.special_traits || []))   addFeat(t.name, t.description, 'passive', null);
  for (const a of (monster.actions || []))           addFeat(a.name, a.description, 'action');
  for (const b of (monster.bonus_actions || []))     addFeat(b.name, b.description, 'bonus');
  for (const r of (monster.reactions || []))         addFeat(r.name, r.description, 'reaction');
  for (const l of (monster.legendary_actions || [])) addFeat(l.name, l.description, 'legendary', l.cost || 1);

  const bioHtml = [
    monster.description && `<p>${monster.description}</p>`,
    monster.ecology    && `<h2>Ecology</h2><p>${monster.ecology}</p>`,
    monster.tactics    && `<h2>Tactics</h2><p>${monster.tactics}</p>`,
    monster.lore       && `<h2>Lore</h2><p>${monster.lore}</p>`,
  ].filter(Boolean).join('');

  const dmgList = arr => ({
    value: (arr || []).map(d => d.toLowerCase().split(' ')[0]).filter(Boolean),
    bypasses: [], custom: '',
  });

  const spd = monster.speed || {};
  const actor = {
    name: monster.name,
    type: 'npc',
    img: 'icons/svg/mystery-man.svg',
    system: {
      abilities,
      attributes: {
        hp: { value: monster.hit_points, min: 0, max: monster.hit_points, temp: 0, tempmax: 0, formula: monster.hit_dice || '' },
        ac: { flat: monster.armor_class, calc: 'flat', formula: '' },
        init: { ability: 'dex', bonus: '' },
        movement: { burrow: spd.burrow||0, climb: spd.climb||0, fly: spd.fly||0, swim: spd.swim||0, walk: spd.walk||30, hover: spd.hover||false, units: 'ft' },
        senses,
        prof: monster.proficiency_bonus || 2,
        cr: crFloat,
        death: { success: 0, failure: 0 },
        exhaustion: 0,
      },
      details: {
        biography: { value: bioHtml, public: '' },
        alignment: (monster.alignment || '').toLowerCase(),
        type: { value: typeMap[monster.monster_type] || monster.monster_type?.toLowerCase() || 'humanoid', subtype: monster.subtype || '', swarm: '', custom: '' },
        cr: crFloat,
        xp: { value: monster.xp || 0 },
        source: { custom: 'Niswins Tavern' },
        environment: '',
      },
      traits: {
        size: sizeMap[monster.size] || 'med',
        languages: { value: [], custom: (monster.languages || []).join(', ') },
        di: dmgList(monster.damage_immunities),
        dr: dmgList(monster.damage_resistances),
        dv: dmgList(monster.damage_vulnerabilities),
        ci: { value: (monster.condition_immunities || []).map(c => c.toLowerCase()), custom: '' },
      },
      skills,
      resources: {
        legact: { value: (monster.legendary_actions || []).length, max: (monster.legendary_actions || []).length },
        legres: { value: monster.legendary_resistance_count || 0, max: monster.legendary_resistance_count || 0 },
      },
      bonuses: { mwak:{attack:'',damage:''}, rwak:{attack:'',damage:''}, msak:{attack:'',damage:''}, rsak:{attack:'',damage:''}, abilities:{check:'',save:'',skill:''}, spell:{dc:''} },
      currency: { pp:0, gp:0, ep:0, sp:0, cp:0 },
    },
    items,
    effects: [],
    flags: { 'niswins-tavern': { generated: true, cr: monster.challenge_rating } },
    prototypeToken: { name: monster.name, displayName: 20, actorLink: false, disposition: -1, displayBars: 20, bar1: { attribute: 'attributes.hp' } },
  };

  _downloadJSON(actor, monster.name);
}

export function exportCurrentMonsterToFoundryJSON() {
  exportMonsterToFoundryJSON(state.currentMonster);
}

function _downloadJSON(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]/gi, '_')}_foundry.json`;
  a.click();
  URL.revokeObjectURL(url);
}
