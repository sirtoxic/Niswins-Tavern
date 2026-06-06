// location.js — location generation, rendering, editing, parent/child linking

import { el, sectionHeader, setBusy, toast, buildContextNote, getContextId, cacheHistoryEntry, _renderAssocLinks, _apiDetail, _escHtml, _escAttr, _showTokenUsage, _editField, _editTextarea, _editSelect, _sectionLabel } from './utils.js';
import { state } from './state.js';

// ---------------------------------------------------------------------------
// Location type config
// ---------------------------------------------------------------------------

const LOCATION_TYPES = ['Continent', 'Country', 'Region/Province', 'City/Town', 'District/Quarter', 'Building/Location'];

const TYPE_TIER = {
  'Continent': 0, 'Country': 1, 'Region/Province': 2,
  'City/Town': 3, 'District/Quarter': 4, 'Building/Location': 5,
};

const TYPE_ICON = {
  'Continent': 'fa-earth-americas', 'Country': 'fa-flag', 'Region/Province': 'fa-mountain',
  'City/Town': 'fa-city', 'District/Quarter': 'fa-building-columns', 'Building/Location': 'fa-door-open',
};

const TYPE_COLOR = {
  'Continent': '#4a9eff', 'Country': '#c9a227', 'Region/Province': '#4a7c59',
  'City/Town': '#e07b39', 'District/Quarter': '#a335ee', 'Building/Location': '#8a7560',
};

// Which optional form fields to show per type
const TYPE_FIELDS = {
  'Continent':        { climate: true,  terrain: false, population: false, government: false, building_type: false },
  'Country':          { climate: true,  terrain: true,  population: true,  government: true,  building_type: false },
  'Region/Province':  { climate: false, terrain: true,  population: false, government: true,  building_type: false },
  'City/Town':        { climate: false, terrain: false, population: true,  government: true,  building_type: false },
  'District/Quarter': { climate: false, terrain: false, population: false, government: false, building_type: false },
  'Building/Location':{ climate: false, terrain: false, population: false, government: false, building_type: true  },
};

const BUILDING_TYPES = [
  'Tavern/Inn', 'Temple/Shrine', 'Blacksmith', 'Alchemist/Apothecary', 'Magic Shop',
  'General Store', 'Guild Hall', 'Noble Manor', 'Palace/Castle', 'Prison/Dungeon',
  'Library/Archive', 'Barracks/Guard Post', 'Harbour/Dockyard', 'Ruins', 'Cave/Dungeon',
  'Tower/Spire', 'Graveyard/Crypt', 'Arena/Coliseum', 'Theatre/Bard Hall', 'Other',
];

// ---------------------------------------------------------------------------
// Form field visibility
// ---------------------------------------------------------------------------

export function onLocationContextChange() {
  const sel = document.getElementById('locationContextSelect');
  const hint = document.getElementById('locationContextHint');
  if (!sel || !hint) return;
  const entryId = sel.value;
  if (!entryId) {
    hint.textContent = 'Assign a parent location — creates a hierarchy in Docmost on save.';
    return;
  }
  const entry = (state.historyEntries || []).find(e => e.id === entryId);
  if (!entry) return;
  hint.innerHTML = `<i class="fa-solid fa-arrow-up mr-1 text-gold opacity-70"></i><span class="text-gold">${_escHtml(entry.name)}</span> <span class="text-gray-500">(${_escHtml(entry.location_type || '')})</span> — will be set as parent on save.`;
}

export function onLocationTypeChange() {
  const locType = document.getElementById('locationTypeSelect').value;
  const fields = TYPE_FIELDS[locType] || {};
  document.getElementById('locationFieldClimate').classList.toggle('hidden', !fields.climate);
  document.getElementById('locationFieldTerrain').classList.toggle('hidden', !fields.terrain);
  document.getElementById('locationFieldPopulation').classList.toggle('hidden', !fields.population);
  document.getElementById('locationFieldGovernment').classList.toggle('hidden', !fields.government);
  document.getElementById('locationFieldBuildingType').classList.toggle('hidden', !fields.building_type);
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export async function generateLocation() {
  const locType = document.getElementById('locationTypeSelect').value;
  const concept = document.getElementById('locationConcept').value.trim();

  setBusy('generateLocationBtn', 'generateLocationSpinner', 'generateLocationBtnText', true, 'Generating…');
  document.getElementById('locationSheet').classList.add('hidden');
  document.getElementById('locationPlaceholder').classList.remove('hidden');
  document.getElementById('locationSaveSection').classList.add('hidden');
  document.getElementById('locationTokenUsage').classList.add('hidden');

  try {
    const fields = TYPE_FIELDS[locType] || {};
    const body = {
      concept,
      location_type: locType,
      climate: fields.climate ? document.getElementById('locationClimate').value.trim() : '',
      terrain: fields.terrain ? document.getElementById('locationTerrain').value.trim() : '',
      population_scale: fields.population ? document.getElementById('locationPopulation').value.trim() : '',
      government_type: fields.government ? document.getElementById('locationGovernment').value.trim() : '',
      building_type: fields.building_type ? document.getElementById('locationBuildingType').value : '',
      atmosphere_hint: document.getElementById('locationAtmosphere').value.trim(),
      additional_notes: document.getElementById('locationNotes').value.trim(),
      detail_level: state.locationDetailLevel || 'medium',
      parent_context_id: getContextId('locationContextSelect'),
    };

    const r = await fetch('/api/generate-location', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { const e = await r.json(); throw new Error(_apiDetail(e.detail, 'Generation failed')); }

    const data = await r.json();
    state.currentLocation = data.location;
    state.currentLocationHistoryId = data.history_id ?? null;
    state.currentLocationSynced = false;
    state.currentLocationDocmostUrl = null;
    state.currentLocationParent = null;
    state.currentLocationChildren = [];
    cacheHistoryEntry({ id: data.history_id, type: 'Location', name: data.location.name, location_type: data.location.location_type, location: { atmosphere: data.location.atmosphere, description: data.location.description }, timestamp: new Date().toISOString() });

    document.getElementById('locationPlaceholder').classList.add('hidden');
    document.getElementById('locationSheet').classList.remove('hidden');
    renderLocationSheet(state.currentLocation);
    document.getElementById('locationSaveSection').classList.remove('hidden');
    _renderAssocLinks('locationAssocLinks', data.history_id, 'locationContextSelect');
    _showTokenUsage(data.usage, 'locationTokenUsage');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  } finally {
    setBusy('generateLocationBtn', 'generateLocationSpinner', 'generateLocationBtnText', false, 'Generate Location');
  }
}

// ---------------------------------------------------------------------------
// Detail level
// ---------------------------------------------------------------------------

export function setLocationDetail(level) {
  state.locationDetailLevel = level;
  ['low', 'medium', 'high'].forEach(d => {
    const btn = document.getElementById(`locationDetail-${d}`);
    if (!btn) return;
    btn.className = d === level ? 'flex-1 btn-primary text-xs py-2' : 'flex-1 btn-secondary text-xs py-2';
  });
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function saveLocation() {
  if (!state.currentLocation) return;
  setBusy('saveLocationBtn', 'saveLocationSpinner', 'saveLocationBtnText', true, 'Saving…');

  try {
    const body = {
      location: state.currentLocation,
      history_id: state.currentLocationHistoryId,
      parent_location_id: getContextId('locationContextSelect') || null,
    };

    const r = await fetch('/api/save-location', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    state.currentLocationSynced = true;
    state.currentLocationDocmostUrl = data.docmost_url || null;

    const entry = state.historyEntries.find(e => e.id === state.currentLocationHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }

    toast(`Saved to Locations / ${state.currentLocation.location_type}`);

    const link = document.getElementById('locationDocmostLink');
    if (data.docmost_url && link) {
      link.href = data.docmost_url;
      link.classList.remove('hidden');
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setBusy('saveLocationBtn', 'saveLocationSpinner', 'saveLocationBtnText', false, 'Save to Docmost');
  }
}

// ---------------------------------------------------------------------------
// Link parent from detail view
// ---------------------------------------------------------------------------

export async function linkLocationParent() {
  const sel = document.getElementById('locationLinkParentSelect');
  if (!sel || !sel.value || !state.currentLocationHistoryId) return;
  const btn = document.getElementById('locationLinkParentBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Linking…'; }

  try {
    const parentEntry = state.historyEntries.find(e => e.id === sel.value);
    if (!parentEntry) throw new Error('Parent entry not found');

    const r = await fetch(`/api/location/${state.currentLocationHistoryId}/link-parent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent_history_id: parentEntry.id,
        parent_name: parentEntry.name,
        parent_type: parentEntry.location_type,
        parent_docmost_url: parentEntry.docmost_url || '',
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Link failed');

    state.currentLocationParent = data.parent_location;
    renderLocationSheet(state.currentLocation, state.currentLocationSynced, state.currentLocationParent, state.currentLocationChildren);
    toast(`Linked to ${parentEntry.name}`);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Link'; }
  }
}

// ---------------------------------------------------------------------------
// Render sheet
// ---------------------------------------------------------------------------

export function renderLocationSheet(loc, isSynced = false, parentLocation = null, childLocations = []) {
  const container = document.getElementById('locationSheet');
  if (!container) return;
  container.innerHTML = '';
  _renderLocationContent(loc, container, isSynced, parentLocation, childLocations);
}

export function _renderLocationContent(loc, container, isSynced = false, parentLocation = null, childLocations = []) {
  const color = TYPE_COLOR[loc.location_type] || '#8a7560';
  const icon = TYPE_ICON[loc.location_type] || 'fa-map-pin';

  // Header
  const header = el('div', 'mb-4');
  const nameRow = el('div', 'flex items-start gap-2 mb-1');
  const nameEl = el('h2', 'text-xl font-bold text-parchment leading-tight');
  nameEl.textContent = loc.name;
  const typeChip = el('span', 'text-xs px-2 py-0.5 rounded-full mt-1 shrink-0');
  typeChip.style.color = color;
  typeChip.style.background = `${color}20`;
  typeChip.style.border = `1px solid ${color}40`;
  typeChip.innerHTML = `<i class="fa-solid ${icon} mr-1"></i>${loc.location_type}`;
  nameRow.appendChild(nameEl);
  nameRow.appendChild(typeChip);
  header.appendChild(nameRow);

  if (loc.atmosphere) {
    const atmos = el('p', 'text-sm italic text-gray-400 mb-2');
    atmos.textContent = loc.atmosphere;
    header.appendChild(atmos);
  }

  // Core stats chips
  const chips = [];
  if (loc.climate) chips.push(['Climate', loc.climate]);
  if (loc.terrain) chips.push(['Terrain', loc.terrain]);
  if (loc.population) chips.push(['Population', loc.population]);
  if (loc.government) chips.push(['Government', loc.government]);
  if (loc.building_type) chips.push(['Type', loc.building_type]);
  if (loc.condition) chips.push(['Condition', loc.condition]);
  if (loc.owner) chips.push(['Run by', loc.owner]);
  if (loc.dominant_culture) chips.push(['Culture', loc.dominant_culture]);
  if (loc.economy) chips.push(['Economy', loc.economy]);

  if (chips.length > 0) {
    const statsGrid = el('div', 'grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3');
    for (const [label, value] of chips) {
      const row = el('div', 'flex gap-1');
      const lbl = el('span', 'text-gray-500 shrink-0');
      lbl.textContent = label + ':';
      const val = el('span', 'text-parchment');
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      statsGrid.appendChild(row);
    }
    header.appendChild(statsGrid);
  }
  container.appendChild(header);

  // Hierarchy breadcrumb
  if (parentLocation || childLocations.length > 0) {
    const hierDiv = el('div', 'panel mb-4 space-y-1.5');
    if (parentLocation) {
      const parentRow = el('div', 'flex items-center gap-2 text-xs');
      parentRow.innerHTML = `<i class="fa-solid fa-arrow-up text-gray-500"></i><span class="text-gray-400">Part of</span>`;
      const parentLink = el('a', 'text-gold hover:underline font-medium');
      parentLink.textContent = `${parentLocation.name} (${parentLocation.type})`;
      if (parentLocation.id) {
        parentLink.href = `#entry/${parentLocation.id}`;
      } else if (parentLocation.docmost_url) {
        parentLink.href = parentLocation.docmost_url;
        parentLink.target = '_blank';
      }
      parentRow.appendChild(parentLink);
      hierDiv.appendChild(parentRow);
    }
    if (childLocations.length > 0) {
      const childHeader = el('div', 'text-xs text-gray-500 flex items-center gap-1 mt-1');
      childHeader.innerHTML = `<i class="fa-solid fa-arrow-down"></i> Contains`;
      hierDiv.appendChild(childHeader);
      for (const child of childLocations) {
        const childRow = el('div', 'flex items-center gap-2 text-xs ml-4');
        const childChip = el('span', 'text-xs');
        childChip.style.color = TYPE_COLOR[child.type] || '#8a7560';
        childChip.innerHTML = `<i class="fa-solid ${TYPE_ICON[child.type] || 'fa-map-pin'} mr-1"></i>${child.type}`;
        const childLink = el('a', 'text-parchment hover:underline');
        childLink.textContent = child.name;
        if (child.id) {
          childLink.href = `#entry/${child.id}`;
        } else if (child.docmost_url) {
          childLink.href = child.docmost_url;
          childLink.target = '_blank';
        }
        childRow.appendChild(childChip);
        childRow.appendChild(childLink);
        hierDiv.appendChild(childRow);
      }
    }
    container.appendChild(hierDiv);
  }

  // Description
  if (loc.description) {
    const descDiv = el('div', 'space-y-2 mb-4');
    container.appendChild(sectionHeader('Description'));
    const paras = loc.description.split('\n').filter(Boolean);
    for (const para of paras) {
      const p = el('p', 'text-sm text-gray-300 leading-relaxed');
      p.textContent = para;
      descDiv.appendChild(p);
    }
    container.appendChild(descDiv);
  }

  // History
  if (loc.history) {
    container.appendChild(sectionHeader('History'));
    const histDiv = el('div', 'space-y-2 mb-4');
    for (const para of loc.history.split('\n').filter(Boolean)) {
      const p = el('p', 'text-sm text-gray-300 leading-relaxed');
      p.textContent = para;
      histDiv.appendChild(p);
    }
    container.appendChild(histDiv);
  }

  // Notable features
  if (loc.notable_features?.length) {
    container.appendChild(sectionHeader('Notable Features'));
    const ul = el('ul', 'list-disc list-inside space-y-1 mb-4');
    for (const f of loc.notable_features) {
      const li = el('li', 'text-sm text-gray-300');
      li.textContent = f;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  // Notable NPCs
  if (loc.notable_npcs?.length) {
    container.appendChild(sectionHeader('Notable People'));
    const npcGrid = el('div', 'space-y-2 mb-4');
    for (const npc of loc.notable_npcs) {
      const card = el('div', 'panel-inner space-y-0.5');
      const nameRow = el('div', 'flex items-baseline gap-2');
      const npcName = el('span', 'text-sm font-bold text-parchment');
      npcName.textContent = npc.name;
      const role = el('span', 'text-xs text-gray-400');
      role.textContent = npc.role;
      nameRow.appendChild(npcName);
      nameRow.appendChild(role);
      card.appendChild(nameRow);
      if (npc.concept) {
        const concept = el('p', 'text-xs text-gray-500 italic');
        concept.textContent = npc.concept;
        card.appendChild(concept);
      }
      npcGrid.appendChild(card);
    }
    container.appendChild(npcGrid);
  }

  // Factions
  if (loc.factions?.length) {
    container.appendChild(sectionHeader('Power Groups & Factions'));
    const ul = el('ul', 'list-disc list-inside space-y-1 mb-4');
    for (const f of loc.factions) {
      const li = el('li', 'text-sm text-gray-300');
      li.textContent = f;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  // Plot hooks
  if (loc.plot_hooks?.length) {
    container.appendChild(sectionHeader('Plot Hooks'));
    const ul = el('ul', 'space-y-1.5 mb-4');
    for (const hook of loc.plot_hooks) {
      const li = el('li', 'flex gap-2 text-sm text-gray-300');
      li.innerHTML = `<i class="fa-solid fa-diamond text-gold text-xs mt-1 shrink-0"></i><span>${_escHtml(hook)}</span>`;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  // Secrets
  if (loc.secrets?.length) {
    container.appendChild(sectionHeader('Secrets (DM Only)'));
    const ul = el('ul', 'space-y-1.5 mb-4');
    for (const s of loc.secrets) {
      const li = el('li', 'flex gap-2 text-sm text-gray-300');
      li.innerHTML = `<i class="fa-solid fa-eye-slash text-red-400 text-xs mt-1 shrink-0"></i><span>${_escHtml(s)}</span>`;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }
}

// ---------------------------------------------------------------------------
// Link parent panel (shown on saved location sheet)
// ---------------------------------------------------------------------------

export function _renderLocationLinkPanel(container) {
  if (!state.currentLocationHistoryId) return;

  const locType = state.currentLocation?.location_type;
  const currentTier = TYPE_TIER[locType] ?? 99;
  const candidates = (state.historyEntries || []).filter(e =>
    e.type === 'Location' && e.id !== state.currentLocationHistoryId &&
    (TYPE_TIER[e.location_type] ?? 99) < currentTier
  );
  if (!candidates.length) return;

  const panel = el('div', 'panel space-y-2 mt-4');
  const label = el('div', 'text-xs text-gray-400');
  label.textContent = 'Link to parent location';
  panel.appendChild(label);

  const row = el('div', 'flex gap-2');
  const sel = el('select', 'input-field text-sm flex-1');
  sel.id = 'locationLinkParentSelect';
  sel.innerHTML = '<option value="">Select parent…</option>';
  for (const e of candidates) {
    sel.innerHTML += `<option value="${_escAttr(e.id)}">${_escHtml(e.name)} (${_escHtml(e.location_type)})</option>`;
  }
  // Pre-select existing parent
  if (state.currentLocationParent?.id) sel.value = state.currentLocationParent.id;

  const btn = el('button', 'btn-secondary text-xs px-3');
  btn.id = 'locationLinkParentBtn';
  btn.textContent = 'Link';
  btn.onclick = linkLocationParent;

  row.appendChild(sel);
  row.appendChild(btn);
  panel.appendChild(row);
  container.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

export function _buildLocationEditForm(loc) {
  const form = el('div', 'space-y-3');

  const basicPanel = el('div', 'panel space-y-3');
  basicPanel.appendChild(_editField('editLocName', 'Name', loc.name));
  basicPanel.appendChild(_editTextarea('editLocAtmosphere', 'Atmosphere', loc.atmosphere, 2));
  basicPanel.appendChild(_editTextarea('editLocDescription', 'Description', loc.description, 5));
  basicPanel.appendChild(_editTextarea('editLocHistory', 'History', loc.history || '', 3));
  form.appendChild(basicPanel);

  if (loc.climate != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocClimate', 'Climate', loc.climate || ''));
    form.appendChild(panel);
  }
  if (loc.terrain != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocTerrain', 'Terrain', loc.terrain || ''));
    form.appendChild(panel);
  }
  if (loc.population != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocPopulation', 'Population', loc.population || ''));
    form.appendChild(panel);
  }
  if (loc.government != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocGovernment', 'Government', loc.government || ''));
    form.appendChild(panel);
  }
  if (loc.economy != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocEconomy', 'Economy', loc.economy || ''));
    form.appendChild(panel);
  }
  if (loc.dominant_culture != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocCulture', 'Dominant Culture', loc.dominant_culture || ''));
    form.appendChild(panel);
  }
  if (loc.building_type != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocBuildingType', 'Building Type', loc.building_type || ''));
    form.appendChild(panel);
  }
  if (loc.condition != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocCondition', 'Condition', loc.condition || ''));
    form.appendChild(panel);
  }
  if (loc.owner != null) {
    const panel = el('div', 'panel'); panel.appendChild(_editField('editLocOwner', 'Owner / Operator', loc.owner || ''));
    form.appendChild(panel);
  }

  return form;
}

export function _collectLocationEdits(loc) {
  const g = id => document.getElementById(id)?.value ?? null;
  const updates = {
    name: g('editLocName') ?? loc.name,
    atmosphere: g('editLocAtmosphere') ?? loc.atmosphere,
    description: g('editLocDescription') ?? loc.description,
    history: g('editLocHistory') ?? loc.history,
  };
  if (loc.climate != null) updates.climate = g('editLocClimate') ?? loc.climate;
  if (loc.terrain != null) updates.terrain = g('editLocTerrain') ?? loc.terrain;
  if (loc.population != null) updates.population = g('editLocPopulation') ?? loc.population;
  if (loc.government != null) updates.government = g('editLocGovernment') ?? loc.government;
  if (loc.economy != null) updates.economy = g('editLocEconomy') ?? loc.economy;
  if (loc.dominant_culture != null) updates.dominant_culture = g('editLocCulture') ?? loc.dominant_culture;
  if (loc.building_type != null) updates.building_type = g('editLocBuildingType') ?? loc.building_type;
  if (loc.condition != null) updates.condition = g('editLocCondition') ?? loc.condition;
  if (loc.owner != null) updates.owner = g('editLocOwner') ?? loc.owner;
  return updates;
}
