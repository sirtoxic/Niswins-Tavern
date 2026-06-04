// stats.js — D&D 5e stat rolling + recalculation

import { sign } from './utils.js';
import { state } from './state.js';

// Ability score priority by class — ordered [most important → least important]
// Used to assign the highest rolled values to the most critical stats.
export const _CLASS_STAT_PRIORITY = {
  Artificer: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
  Barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  Bard:      ['cha', 'dex', 'con', 'int', 'wis', 'str'],
  Cleric:    ['wis', 'con', 'str', 'cha', 'dex', 'int'],
  Commoner:  ['con', 'wis', 'str', 'dex', 'cha', 'int'],
  Druid:     ['wis', 'con', 'dex', 'int', 'cha', 'str'],
  Fighter:   ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  Monk:      ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  Paladin:   ['str', 'cha', 'con', 'wis', 'dex', 'int'],
  Ranger:    ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  Rogue:     ['dex', 'con', 'int', 'wis', 'cha', 'str'],
  Sorcerer:  ['cha', 'con', 'dex', 'int', 'wis', 'str'],
  Warlock:   ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  Wizard:    ['int', 'con', 'dex', 'wis', 'cha', 'str'],
};

export const _SKILL_ABILITY_MAP = {
  acrobatics: 'dexterity', animal_handling: 'wisdom', arcana: 'intelligence',
  athletics: 'strength', deception: 'charisma', history: 'intelligence',
  insight: 'wisdom', intimidation: 'charisma', investigation: 'intelligence',
  medicine: 'wisdom', nature: 'intelligence', perception: 'wisdom',
  performance: 'charisma', persuasion: 'charisma', religion: 'intelligence',
  sleight_of_hand: 'dexterity', stealth: 'dexterity', survival: 'wisdom',
};

export const _ABILITY_KEYS = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

export function _getRollThreshold() {
  const countEl = document.getElementById('rollMinCount');
  const valueEl = document.getElementById('rollMinValue');
  const count = Math.min(6, Math.max(1, parseInt(countEl?.value) || 3));
  const value = Math.min(20, Math.max(1, parseInt(valueEl?.value) || 12));
  return { count, value };
}

export function _rollAbilityScores(className) {
  const { count, value } = _getRollThreshold();
  let rolls;
  do {
    rolls = Array.from({length: 6}, () => Math.floor(Math.random() * 20) + 1);
  } while (rolls.filter(v => v > value).length < count);
  const priority = _CLASS_STAT_PRIORITY[className] || _CLASS_STAT_PRIORITY['Fighter'];
  const sorted = [...rolls].sort((a, b) => b - a);
  const result = {};
  priority.forEach((stat, i) => result[stat] = sorted[i]);
  return result;
}

export function _displayRolledStats(stats, prefix) {
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const e = document.getElementById(`${prefix}_${key}`);
    if (e) e.textContent = stats[key];
  }
}

export function _updateRollHint(hintId) {
  const e = document.getElementById(hintId);
  if (!e) return;
  const { count, value } = _getRollThreshold();
  e.textContent = `Rolls 1–20 until ≥${count} exceed ${value}. Best values assigned to class primary stats.`;
}

export function rollForgeStats() {
  const cls = document.getElementById('charClass').value;
  state.forgeRolledStats = _rollAbilityScores(cls);
  _displayRolledStats(state.forgeRolledStats, 'forge');
  _updateRollHint('forgeRollHint');
}

export function rollPcStats() {
  const cls = document.getElementById('pcClass').value;
  state.pcRolledStats = _rollAbilityScores(cls);
  _displayRolledStats(state.pcRolledStats, 'pcgen');
  _updateRollHint('pcgenRollHint');
}

export function _recalcAbilityScores(char, newTotals) {
  const c = JSON.parse(JSON.stringify(char));
  const profBonus = c.proficiency_bonus;
  const abbr = (a) => a.slice(0, 3).toUpperCase();

  for (const ability of _ABILITY_KEYS) {
    if (newTotals[ability] == null) continue;
    const total = newTotals[ability];
    const mod = Math.floor((total - 10) / 2);
    const s = c.ability_scores[ability];
    s.base = total - (s.racial_bonus || 0) - (s.other_bonus || 0);
    s.total = total;
    s.modifier = mod;
  }

  const getMod = (a) => c.ability_scores[a].modifier;

  for (const ability of _ABILITY_KEYS) {
    const st = c.saving_throws[ability];
    const m = getMod(ability);
    const profAdd = st.proficient ? profBonus : 0;
    st.base_modifier = m;
    st.proficiency_bonus = profBonus;
    st.total = m + profAdd;
    st.breakdown = st.proficient
      ? `${abbr(ability)} ${sign(m)} + Prof +${profBonus} = ${sign(st.total)}`
      : `${abbr(ability)} ${sign(m)} = ${sign(st.total)}`;
  }

  for (const [skillName, ability] of Object.entries(_SKILL_ABILITY_MAP)) {
    const sk = c.skills[skillName];
    if (!sk) continue;
    const m = getMod(ability);
    const profAdd = sk.expertise ? profBonus * 2 : (sk.proficient ? profBonus : 0);
    sk.base_modifier = m;
    sk.proficiency_bonus = profBonus;
    sk.total = m + profAdd + (sk.other_bonus || 0);
    let bd = `${abbr(ability)} ${sign(m)}`;
    if (sk.expertise) bd += ` + Exp +${profBonus * 2}`;
    else if (sk.proficient) bd += ` + Prof +${profBonus}`;
    if (sk.other_bonus) bd += ` + ${sign(sk.other_bonus)}`;
    bd += ` = ${sign(sk.total)}`;
    sk.breakdown = bd;
  }

  const dexMod = getMod('dexterity');
  c.initiative = dexMod;
  c.initiative_breakdown = `DEX ${sign(dexMod)}`;
  c.passive_perception = 10 + c.skills.perception.total;
  c.passive_perception_breakdown = `10 + Perception ${sign(c.skills.perception.total)} = ${c.passive_perception}`;

  if (c.armor_class && c.armor_class.components) {
    for (const comp of c.armor_class.components) {
      if (comp.type === 'dex') comp.value = dexMod;
    }
    c.armor_class.total = c.armor_class.components.reduce((sum, comp) => sum + comp.value, 0);
  }

  if (c.spellcasting) {
    const spellAbilKey = c.spellcasting.ability.toLowerCase();
    if (c.ability_scores[spellAbilKey]) {
      const sm = getMod(spellAbilKey);
      const ab = abbr(c.spellcasting.ability);
      c.spellcasting.ability_modifier = sm;
      c.spellcasting.proficiency_bonus = profBonus;
      c.spellcasting.spell_attack_bonus = profBonus + sm;
      c.spellcasting.spell_attack_breakdown = `Prof +${profBonus} + ${ab} ${sign(sm)} = ${sign(profBonus + sm)}`;
      c.spellcasting.spell_save_dc = 8 + profBonus + sm;
      c.spellcasting.spell_save_breakdown = `8 + Prof +${profBonus} + ${ab} ${sign(sm)} = ${8 + profBonus + sm}`;
    }
  }

  return c;
}

export function _collectNewScoreTotals(prefix) {
  return {
    strength:     parseInt(document.getElementById(`${prefix}Str`)?.value) || 10,
    dexterity:    parseInt(document.getElementById(`${prefix}Dex`)?.value) || 10,
    constitution: parseInt(document.getElementById(`${prefix}Con`)?.value) || 10,
    intelligence: parseInt(document.getElementById(`${prefix}Int`)?.value) || 10,
    wisdom:       parseInt(document.getElementById(`${prefix}Wis`)?.value) || 10,
    charisma:     parseInt(document.getElementById(`${prefix}Cha`)?.value) || 10,
  };
}
