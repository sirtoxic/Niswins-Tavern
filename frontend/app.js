'use strict';

let currentCharacter = null;
let selectedDetail = 'medium';

// Load config on startup to populate folder dropdown
async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    const sel = document.getElementById('saveFolder');
    sel.innerHTML = '';
    for (const [key, label] of Object.entries(cfg.folders)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      if (key === 'npcs') opt.selected = true;
      sel.appendChild(opt);
    }
  } catch {}
}

function setDetail(level) {
  selectedDetail = level;
  ['short','medium','long'].forEach(d => {
    const btn = document.getElementById(`detail-${d}`);
    btn.className = d === level
      ? 'flex-1 btn-primary text-xs py-2'
      : 'flex-1 btn-secondary text-xs py-2';
  });
}

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
    renderSheet(currentCharacter);
    document.getElementById('saveSection').classList.remove('hidden');
    _showTokenUsage(data.usage);
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    setBusy('generateBtn', 'generateSpinner', 'generateBtnText', false, 'Generate Character');
  }
}

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
      body: JSON.stringify({ character: currentCharacter, folder }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');
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

  // Abilities
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

  // Skills (0 = none, 1 = proficient, 2 = expertise)
  const skills = {};
  for (const [full, { abbr, ability }] of Object.entries(skillMap)) {
    const sk = c.skills[full];
    skills[abbr] = {
      value: sk.expertise ? 2 : sk.proficient ? 1 : 0,
      ability,
      bonuses: { check: '', passive: '' },
    };
  }

  // Spell slots
  const spells = {};
  for (let i = 1; i <= 9; i++) {
    const count = c.spellcasting ? (c.spellcasting.spell_slots[`level_${i}`] || 0) : 0;
    spells[`spell${i}`] = { value: count, override: null, max: count };
  }
  spells.spell0 = { value: 0, override: null };

  // Items: weapons
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

  // Items: spells
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

  // Items: class features & traits
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

  // Items: equipment (non-weapon gear as loot)
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

function renderSheet(c) {
  const sheet = document.getElementById('characterSheet');
  sheet.innerHTML = '';
  document.getElementById('placeholder').classList.add('hidden');
  sheet.classList.remove('hidden');

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
  sheet.appendChild(sectionHeader('Ability Scores'));
  const abilityGrid = el('div', 'grid grid-cols-3 md:grid-cols-6 gap-2');
  const abilities = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  const abbrMap = {strength:'STR',dexterity:'DEX',constitution:'CON',intelligence:'INT',wisdom:'WIS',charisma:'CHA'};

  for (const name of abilities) {
    const a = c.ability_scores[name];
    const box = el('div', 'stat-box');
    box.innerHTML = `
      <div class="text-xs text-gold font-bold">${abbrMap[name]}</div>
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
  sheet.appendChild(sectionHeader('Saving Throws & Skills'));
  const twoCol = el('div', 'grid grid-cols-1 md:grid-cols-2 gap-4');

  // Saving throws
  const savesPanel = el('div', 'panel');
  savesPanel.innerHTML = '<div class="text-xs text-gold uppercase font-bold mb-2">Saving Throws</div>';
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
  skillsPanel.innerHTML = '<div class="text-xs text-gold uppercase font-bold mb-2">Skills <span class="text-gray-600 font-normal normal-case">(● prof, ●● expertise)</span></div>';
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
    sheet.appendChild(sectionHeader('Attacks'));
    const attacksPanel = el('div', 'panel overflow-x-auto');
    const table = el('table', 'w-full text-xs border-collapse');
    table.innerHTML = `
      <thead>
        <tr class="text-gold text-left">
          <th class="pb-1 pr-3">Weapon</th>
          <th class="pb-1 pr-3">To Hit</th>
          <th class="pb-1 pr-3">Breakdown</th>
          <th class="pb-1 pr-3">Damage</th>
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

    // Header row
    spPanel.innerHTML = `
      <div class="grid grid-cols-3 gap-3 text-center text-xs">
        <div class="stat-box">
          <div class="text-gold font-bold">Ability</div>
          <div class="text-lg font-bold">${sp.ability}</div>
          <div class="breakdown-text">${sign(sp.ability_modifier)}</div>
        </div>
        <div class="stat-box">
          <div class="text-gold font-bold">Spell Attack</div>
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

    // Spell slots
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

    // Cantrips
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
// Token usage display
// -----------------------------------------------------------------------

function _showTokenUsage(usage) {
  const el = document.getElementById('tokenUsage');
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

// Init
loadConfig();
