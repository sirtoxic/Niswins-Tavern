// shop.js — shop generation, rendering, staff management, editing
// Note: openShopkeeperModal and openShopStaffModal call window.openGenModal()
// at runtime to avoid circular imports with main.js.

import { el, setBusy, _escHtml, _escAttr, _showTokenUsage, RARITY_COLORS, _editField, _editTextarea, _editSelect, _sectionLabel } from './utils.js';
import { state } from './state.js';

export function _shopRarityStyle(rarity, active) {
  const color = RARITY_COLORS[rarity] || '#9d9d9d';
  const btn = document.getElementById(`shopRarity${rarity}`);
  if (!btn) return;
  btn.style.color = active ? color : '#8a7560';
  btn.style.borderColor = active ? color : '#5a3e28';
  btn.style.background = active ? `${color}18` : 'transparent';
}

export function toggleShopRarity(rarity) {
  if (state.shopSelectedRarities.has(rarity)) {
    if (state.shopSelectedRarities.size === 1) return; // always keep at least one
    state.shopSelectedRarities.delete(rarity);
  } else {
    state.shopSelectedRarities.add(rarity);
  }
  _shopRarityStyle(rarity, state.shopSelectedRarities.has(rarity));
}

export function setShopDetail(level) {
  state.shopDetailLevel = level;
  ['low', 'medium', 'high'].forEach(d => {
    const btn = document.getElementById(`shopDetail-${d}`);
    btn.className = d === level
      ? 'flex-1 btn-primary text-xs py-2'
      : 'flex-1 btn-secondary text-xs py-2';
  });
}

export function _initShopRarityToggles() {
  for (const r of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']) {
    _shopRarityStyle(r, state.shopSelectedRarities.has(r));
  }
}

export async function generateShop() {
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
      rarities: [...state.shopSelectedRarities],
      detail_level: state.shopDetailLevel,
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
    state.currentShop = data.shop;
    state.currentShopHistoryId = data.history_id ?? null;
    state.currentShopSynced = false;
    state.currentShopDocmostUrl = null;

    document.getElementById('shopPlaceholder').classList.add('hidden');
    document.getElementById('shopSheet').classList.remove('hidden');
    renderShopSheet(state.currentShop, false, []);
    _showTokenUsage(data.usage, 'shopTokenUsage');
  } catch (e) {
    alert(`Error: ${e.message}`);
  } finally {
    setBusy('generateShopBtn', 'generateShopSpinner', 'generateShopBtnText', false, 'Generate Shop');
  }
}

export function renderShopSheet(shop, isSynced = false, linkedNpcs = []) {
  document.getElementById('shopSaveResult').classList.add('hidden');
  document.getElementById('shopDocmostLink').classList.add('hidden');
  document.getElementById('saveShopBtnText').textContent = 'Save to Docmost';
  document.getElementById('shopMeta').textContent =
    `${shop.category} · ${shop.shop_type} · ${shop.items.length} items · Run by ${shop.shopkeeper.name}`;

  const container = document.getElementById('shopSheet');
  while (container.children.length > 2) container.removeChild(container.lastChild);

  _renderShopContent(shop, container, isSynced, linkedNpcs);
}

export async function saveShop() {
  if (!state.currentShop) return;
  setBusy('saveShopBtn', 'saveShopSpinner', 'saveShopBtnText', true, 'Saving…');
  const resultEl = document.getElementById('shopSaveResult');
  resultEl.classList.add('hidden');

  try {
    const r = await fetch('/api/save-shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop: state.currentShop, history_id: state.currentShopHistoryId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Save failed');

    const entry = state.historyEntries.find(e => e.id === state.currentShopHistoryId);
    if (entry) {
      entry.docmost_page_id = data.page_id;
      entry.docmost_url = data.docmost_url;
    }

    state.currentShopSynced = true;
    state.currentShopDocmostUrl = data.docmost_url || null;
    renderShopSheet(state.currentShop, true, entry?.linked_npcs || []);

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

export function _renderShopContent(shop, container, isSynced = false, linkedNpcs = []) {
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
  const skLinkedNpc = linkedNpcs.find(n => n.is_shopkeeper);
  const genderNote = sk.gender ? ` (${sk.gender})` : '';
  const skPanel = el('div', 'panel');
  const skHeader = el('div', 'flex items-center gap-2 mb-3 flex-wrap');
  skHeader.innerHTML = `<div class="section-header" style="margin-bottom:0;border:none;flex:1">The Shopkeeper</div>`;

  const skBtns = el('div', 'flex gap-2 flex-shrink-0 flex-wrap');
  skBtns.innerHTML = `
    <button onclick="regenerateShopkeeperUI()" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-rotate mr-1"></i>Regenerate</button>
    ${isSynced && !skLinkedNpc ? `<button onclick="openShopkeeperModal()" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-user-plus mr-1"></i>Generate NPC</button>` : ''}
  `;
  skHeader.appendChild(skBtns);
  skPanel.appendChild(skHeader);

  const skBody = el('div', '');
  skBody.innerHTML = `
    <p class="text-sm font-bold text-parchment mb-1">${_escHtml(sk.name)}
      <span class="text-gray-500 font-normal text-xs ml-1">— ${_escHtml(sk.race)}${_escHtml(genderNote)}, ${_escHtml(sk.character_class)}</span>
    </p>
    <p class="text-sm text-gray-300 mb-1">${_escHtml(sk.appearance)}</p>
    <p class="text-sm text-gray-300 mb-1">${_escHtml(sk.personality)}</p>
    ${sk.motivation ? `<p class="text-xs text-gray-500 italic mt-1">${_escHtml(sk.motivation)}</p>` : ''}
  `;
  if (skLinkedNpc) {
    skBody.innerHTML += `<p class="text-xs text-emerald-400 mt-2"><i class="fa-solid fa-link mr-1"></i>${_escHtml(skLinkedNpc.npc_name)} — <a href="${_escHtml(skLinkedNpc.npc_docmost_url)}" target="_blank" class="underline">View in Docmost</a></p>`;
  }
  skPanel.appendChild(skBody);
  container.appendChild(skPanel);

  // Staff
  const staff = shop.staff || [];
  const staffPanel = el('div', 'panel');
  const staffHeaderRow = el('div', 'flex items-center gap-2 mb-3 flex-wrap');
  staffHeaderRow.innerHTML = `<div class="section-header" style="margin-bottom:0;border:none;flex:1">Staff</div>`;
  const addStaffBtn = el('button', 'btn-secondary text-xs py-1 px-2 whitespace-nowrap flex-shrink-0', '<i class="fa-solid fa-plus mr-1"></i>Add Staff');
  addStaffBtn.onclick = () => addShopStaffUI();
  staffHeaderRow.appendChild(addStaffBtn);
  staffPanel.appendChild(staffHeaderRow);

  if (staff.length === 0) {
    staffPanel.innerHTML += `<p class="text-xs text-gray-500 italic">No staff added yet.</p>`;
  } else {
    const staffList = el('div', 'space-y-3');
    staff.forEach((member, idx) => {
      const memberLinkedNpc = linkedNpcs.find(n => !n.is_shopkeeper && n.member_name === member.name);
      const row = el('div', 'flex items-start gap-3');
      const info = el('div', 'flex-1 min-w-0');
      info.innerHTML = `
        <p class="text-sm font-bold text-parchment">${_escHtml(member.name)} <span class="text-gray-500 font-normal text-xs">— ${_escHtml(member.role)}</span></p>
        <p class="text-xs text-gray-400 mt-0.5">${_escHtml(member.description)}</p>
        ${memberLinkedNpc ? `<p class="text-xs text-emerald-400 mt-1"><i class="fa-solid fa-link mr-1"></i>${_escHtml(memberLinkedNpc.npc_name)} — <a href="${_escHtml(memberLinkedNpc.npc_docmost_url)}" target="_blank" class="underline">View in Docmost</a></p>` : ''}
      `;
      const btns = el('div', 'flex gap-1 flex-shrink-0 flex-wrap');
      btns.innerHTML = `
        <button onclick="regenerateShopStaffUI(${idx})" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-rotate"></i></button>
        ${isSynced && !memberLinkedNpc ? `<button onclick="openShopStaffModal(${_escAttr(JSON.stringify(member.name))},${_escAttr(JSON.stringify(member.role))})" class="btn-secondary text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-user-plus mr-1"></i>NPC</button>` : ''}
        <button onclick="removeShopStaffUI(${idx})" class="text-red-500 hover:text-red-300 text-xs py-1 px-2 whitespace-nowrap"><i class="fa-solid fa-trash"></i></button>
      `;
      row.appendChild(info);
      row.appendChild(btns);
      staffList.appendChild(row);
    });
    staffPanel.appendChild(staffList);
  }
  container.appendChild(staffPanel);

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

  // Connected NPCs summary
  if (linkedNpcs.length > 0) {
    const npcPanel = el('div', 'panel');
    npcPanel.innerHTML = `<div class="section-header">Connected NPCs</div>`;
    const npcList = el('div', 'space-y-1');
    for (const npc of linkedNpcs) {
      const line = el('p', 'text-sm text-gray-300');
      line.innerHTML = `<span class="font-bold text-parchment">${_escHtml(npc.npc_name)}</span> — ${_escHtml(npc.member_role)}`;
      if (npc.npc_docmost_url) {
        line.innerHTML += ` <a href="${_escHtml(npc.npc_docmost_url)}" target="_blank" class="text-xs text-blue-400 underline ml-1">View in Docmost</a>`;
      }
      npcList.appendChild(line);
    }
    npcPanel.appendChild(npcList);
    container.appendChild(npcPanel);
  }
}

export function _shopItemCard(item, globalIdx) {
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

export function useShopItemAsPrompt(itemIndex) {
  const item = state.currentShop?.items[itemIndex];
  if (!item) return;
  window.openGenModal('item', item);
}

export function openShopkeeperModal() {
  const sk = state.currentShop?.shopkeeper;
  if (!sk) return;
  const shopId = state.currentShopHistoryId || state.currentHistoryId;
  state._modalShopContext = {
    shopHistoryId: shopId,
    memberName: sk.name,
    memberRole: sk.character_class || 'Shopkeeper',
    isShopkeeper: true,
    additionalNotes: `This NPC is the shopkeeper of ${state.currentShop.name}, a ${state.currentShop.category} ${state.currentShop.shop_type}. ${state.currentShop.atmosphere || ''}`.trim(),
  };
  window.openGenModal('npc', sk);
}

export function openShopStaffModal(staffName, staffRole) {
  if (!state.currentShop) return;
  const shopId = state.currentShopHistoryId || state.currentHistoryId;
  state._modalShopContext = {
    shopHistoryId: shopId,
    memberName: staffName,
    memberRole: staffRole,
    isShopkeeper: false,
    additionalNotes: `This NPC works at ${state.currentShop.name}, a ${state.currentShop.category} ${state.currentShop.shop_type}, as ${staffRole}. ${state.currentShop.atmosphere || ''}`.trim(),
  };
  window.openGenModal('npc', { name: staffName, concept: `${staffRole} at ${state.currentShop.name}`, race: '', character_class: 'Commoner' });
}

export async function regenerateShopkeeperUI() {
  if (!state.currentShop) return;
  const shopId = state.currentShopHistoryId || state.currentHistoryId;
  if (!shopId) return;
  try {
    const r = await fetch(`/api/shop/${shopId}/regenerate-staff`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_shopkeeper: true }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Failed');
    state.currentShop.shopkeeper = { ...state.currentShop.shopkeeper, ...data.member };
    await _saveShopStaffChanges(shopId);
  } catch (e) {
    alert(`Regenerate failed: ${e.message}`);
  }
}

export async function regenerateShopStaffUI(staffIndex) {
  if (!state.currentShop) return;
  const shopId = state.currentShopHistoryId || state.currentHistoryId;
  if (!shopId) return;
  try {
    const r = await fetch(`/api/shop/${shopId}/regenerate-staff`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_shopkeeper: false, staff_index: staffIndex }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Failed');
    state.currentShop.staff[staffIndex] = data.member;
    await _saveShopStaffChanges(shopId);
  } catch (e) {
    alert(`Regenerate failed: ${e.message}`);
  }
}

export async function addShopStaffUI() {
  if (!state.currentShop) return;
  const shopId = state.currentShopHistoryId || state.currentHistoryId;
  if (!shopId) return;
  try {
    const r = await fetch(`/api/shop/${shopId}/regenerate-staff`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_shopkeeper: false, staff_index: null }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || 'Failed');
    if (!state.currentShop.staff) state.currentShop.staff = [];
    state.currentShop.staff.push(data.member);
    await _saveShopStaffChanges(shopId);
  } catch (e) {
    alert(`Add staff failed: ${e.message}`);
  }
}

export async function removeShopStaffUI(staffIndex) {
  if (!state.currentShop) return;
  const shopId = state.currentShopHistoryId || state.currentHistoryId;
  if (!shopId) return;
  state.currentShop.staff.splice(staffIndex, 1);
  await _saveShopStaffChanges(shopId);
}

export async function _saveShopStaffChanges(shopId) {
  try {
    const r = await fetch(`/api/history/${shopId}/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { shopkeeper: state.currentShop.shopkeeper, staff: state.currentShop.staff || [] } }),
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Save failed'); }
    const entry = state.historyEntries.find(e => e.id === shopId);
    if (entry) {
      entry.shop = { ...entry.shop, shopkeeper: state.currentShop.shopkeeper, staff: state.currentShop.staff || [] };
    }
    const linkedNpcs = entry?.linked_npcs || [];
    const isSynced = state.currentShopSynced;
    if (document.getElementById('shopSheet') && !document.getElementById('shopSheet').classList.contains('hidden')) {
      renderShopSheet(state.currentShop, isSynced, linkedNpcs);
    } else {
      const historySheet = document.getElementById('historySheet');
      if (historySheet) {
        historySheet.innerHTML = '';
        _renderShopContent(state.currentShop, historySheet, isSynced, linkedNpcs);
      }
    }
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  }
}

export function _buildShopEditForm(shop) {
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

export function _collectShopEdits() {
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
      concept: state.currentShop?.shopkeeper?.concept || '',
    },
    items,
    staff: state.currentShop?.staff || [],
  };
}

export function _makeShopItemRow(item) {
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
