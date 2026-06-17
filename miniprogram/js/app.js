// ===== 寺语S - 多寺庙前端逻辑 =====
// Temple context injected by server: window.TEMPLE_ID, window.TEMPLE_SLUG, window.TEMPLE_NAME

const TEMPLE_ID = window.TEMPLE_ID || 1;
const TEMPLE_SLUG = window.TEMPLE_SLUG || 'dajue';
const TEMPLE_NAME = window.TEMPLE_NAME || '大觉禅寺';
const API = `/api/temple/${TEMPLE_ID}`;

let currentTab = 'home';
let currentPage = null;
let currentUser = null;
let shopCategory = '';
let selectedOfferingType = 1;
let selectedBuddha = null;
let selectedReleaseAnimal = null;
let bannerTimer = null;
let bannerIndex = 0;
let bannerImages = [];

// ===== 工具函数 =====
function $(id) { return document.getElementById(id); }
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }

// ===== AI 语音讲解 =====
var _ttsSpeaking = false, _ttsUtterance = null, _ttsConfig = { provider:'web-speech', speed:0, volume:5, autoPlay:false };
var _ttsAudio = null;

async function loadTtsConfig() {
  try {
    var res = await fetch('/api/platform/ai/tts-config');
    var d = await res.json();
    if (d.code === 0) _ttsConfig = d.data;
  } catch (e) {}
}

async function speakText(text, btnId) {
  var btn = document.getElementById(btnId);
  
  if (_ttsSpeaking) {
    stopSpeech();
    if (btn) btn.textContent = '🔊 语音讲解';
    return;
  }
  
  _ttsSpeaking = true;
  if (btn) btn.textContent = '⏸ 停止';
  
  if (_ttsConfig.provider === 'tencent') {
    speakTencent(text, btn);
  } else {
    speakBrowser(text, btn);
  }
}

function speakBrowser(text, btn) {
  if (!('speechSynthesis' in window)) { showToast('浏览器不支持语音合成'); _ttsSpeaking = false; return; }
  var utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 1 + ((_ttsConfig.speed || 0) / 10);
  utterance.pitch = 1;
  utterance.volume = (_ttsConfig.volume || 5) / 10;
  utterance.onend = function() { _ttsSpeaking = false; if (btn) btn.textContent = '🔊 语音讲解'; };
  utterance.onerror = function() { _ttsSpeaking = false; if (btn) btn.textContent = '🔊 语音讲解'; };
  _ttsUtterance = utterance;
  speechSynthesis.speak(utterance);
}

async function speakTencent(text, btn) {
  try {
    var res = await fetch('/api/platform/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
    var d = await res.json();
    if (d.code !== 0) {
      showToast(d.msg || 'TTS 合成失败');
      _ttsSpeaking = false;
      if (btn) btn.textContent = '🔊 语音讲解';
      return;
    }
    // Play base64 audio
    var audio = new Audio('data:audio/mp3;base64,' + d.data.audio);
    audio.volume = (_ttsConfig.volume || 5) / 10;
    audio.onended = function() { _ttsSpeaking = false; if (btn) btn.textContent = '🔊 语音讲解'; };
    audio.onerror = function() { _ttsSpeaking = false; if (btn) btn.textContent = '🔊 语音讲解'; showToast('播放失败'); };
    _ttsAudio = audio;
    audio.play();
  } catch (e) {
    showToast('TTS 请求失败');
    _ttsSpeaking = false;
    if (btn) btn.textContent = '🔊 语音讲解';
  }
}

function autoSpeakDesc() {
  setTimeout(function() {
    var descEl = document.getElementById('detail-desc-text') || document.getElementById('buddha-desc-display');
    if (descEl && !_ttsSpeaking) {
      var btnId = document.getElementById('tour-tts-btn') ? 'tour-tts-btn' : 'buddha-tts-btn';
      speakText(descEl.textContent, btnId);
    }
  }, 500);
}

function stopSpeech() {
  if (_ttsConfig.provider === 'tencent' && _ttsAudio) {
    _ttsAudio.pause();
    _ttsAudio = null;
  } else {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  _ttsSpeaking = false;
}

loadTtsConfig();

async function fetchAPI(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    console.error('API Error:', e);
    return { code: 1, msg: '网络错误' };
  }
}

async function postAPI(url, data) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (e) {
    console.error('API Error:', e);
    return { code: 1, msg: '网络错误' };
  }
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ===== 模态框 =====
function showModal(html) {
  const overlay = $('modal-overlay');
  const content = $('modal-content');
  content.innerHTML = html;
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeModal(e) {
  if (!e || e.target === $('modal-overlay') || e.target.classList.contains('modal-close')) {
    $('modal-overlay').classList.remove('show');
    document.body.style.overflow = '';
  }
}

// ===== 导航系统 =====
function switchTab(tab) {
  if (currentTab === tab && !currentPage) return;
  currentTab = tab;
  currentPage = null;

  qsa('.tab-item').forEach(el => el.classList.remove('active'));
  const tabEl = qs(`.tab-item[data-tab="${tab}"]`);
  if (tabEl) tabEl.classList.add('active');

  qsa('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`page-${tab}`);
  if (pageEl) pageEl.classList.add('active');

  $('tab-bar').style.display = 'flex';

  if (tab === 'home') loadHome();
  else if (tab === 'activities') loadActivities();
  else if (tab === 'tour') loadTour();
  else if (tab === 'shop') loadShop();
  else if (tab === 'mine') loadMine();

  window.scrollTo(0, 0);
}

function navigateTo(page) {
  currentPage = page;
  qsa('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  $('tab-bar').style.display = 'none';

  if (page === 'offering') loadOffering();
  else if (page === 'tablet') loadTablet();
  else if (page === 'prayer') loadPrayer();
  else if (page === 'release') loadRelease();
  else if (page === 'merit') loadMerit();

  window.scrollTo(0, 0);
}

function goBack() {
  $('tab-bar').style.display = 'flex';
  currentPage = null;
  qsa('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`page-${currentTab}`);
  if (pageEl) pageEl.classList.add('active');

  if (currentTab === 'home') loadHome();
  else if (currentTab === 'activities') loadActivities();
  else if (currentTab === 'tour') loadTour();
  else if (currentTab === 'shop') loadShop();
  else if (currentTab === 'mine') loadMine();

  window.scrollTo(0, 0);
}

// ===== 首页 =====
async function loadHome() {
  // Temple info for header
  const templeRes = await fetchAPI(`${API}/info`);
  if (templeRes.code === 0 && templeRes.data) {
    document.querySelector('.temple-name').textContent = templeRes.data.name;
    document.querySelector('.temple-slogan').textContent = templeRes.data.slogan || '';
    bannerImages = templeRes.data.banner || [];
    renderBanner();
  }

  // Stats (from admin stats endpoint)
  const statsRes = await fetchAPI(`${API}/admin/stats`);
  if (statsRes.code === 0) {
    $('stat-offering').textContent = statsRes.data.total_offerings || 0;
    $('stat-merit').textContent = statsRes.data.total_donations || 0;
    $('stat-release').textContent = statsRes.data.total_releases || 0;
  }

  // Announcements
  const annRes = await fetchAPI(`${API}/announcements`);
  if (annRes.code === 0) {
    const list = (annRes.data || []).slice(0, 3);
    $('home-announcements').innerHTML = list.map(a => `
      <div class="announcement-item">
        <div class="announcement-dot"></div>
        <span class="announcement-title">${a.title}</span>
        <span class="announcement-date">${a.time}</span>
      </div>
    `).join('') || '<p style="color:var(--text-muted);padding:10px 0">暂无公告</p>';
  }

  // Merit rank
  const rankRes = await fetchAPI(`${API}/merit-rank`);
  if (rankRes.code === 0 && rankRes.data.length > 0) {
    $('home-rank').innerHTML = rankRes.data.slice(0, 5).map((r, i) => {
      const numClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : 'normal';
      return `<div class="rank-item">
        <span class="rank-num ${numClass}">${i + 1}</span>
        <span class="rank-name">${r.name}</span>
        <span class="rank-amount">¥${r.amount.toLocaleString()}</span>
        <span class="rank-project">${r.project}</span>
      </div>`;
    }).join('');
  } else {
    $('home-rank').innerHTML = '<p style="color:var(--text-muted);padding:10px 0">暂无功德记录，来成为第一位功德主吧 ❤️</p>';
  }

  // Activities
  const actRes = await fetchAPI(`${API}/activities`);
  if (actRes.code === 0 && actRes.data.length > 0) {
    $('home-activities').innerHTML = actRes.data.slice(0, 2).map(a => `
      <div class="activity-mini-item">
        <img src="${a.image}" alt="${a.title}" loading="lazy" decoding="async">
        <div class="activity-mini-info">
          <div class="activity-mini-title">${a.title}</div>
          <div class="activity-mini-desc">${a.desc}</div>
          <div class="activity-mini-time">📅 ${a.date} | ${a.time}</div>
        </div>
      </div>
    `).join('');
  } else {
    $('home-activities').innerHTML = '<p style="color:var(--text-muted);padding:10px 0">暂无近期活动</p>';
  }
}

function renderBanner() {
  if (!bannerImages.length) return;
  $('banner-slider').innerHTML = bannerImages.map((img, i) =>
    `<img src="${img}" alt="banner" class="${i === 0 ? 'active' : ''}" fetchpriority="high" decoding="async">`
  ).join('');
  $('banner-dots').innerHTML = bannerImages.map((_, i) =>
    `<div class="banner-dot ${i === 0 ? 'active' : ''}" data-i="${i}" onclick="setBanner(${i})"></div>`
  ).join('');

  if (bannerTimer) clearInterval(bannerTimer);
  bannerTimer = setInterval(() => {
    bannerIndex = (bannerIndex + 1) % bannerImages.length;
    setBanner(bannerIndex);
  }, 4000);
}

function setBanner(i) {
  bannerIndex = i;
  qsa('#banner-slider img').forEach((img, idx) => img.classList.toggle('active', idx === i));
  qsa('.banner-dot').forEach((dot, idx) => dot.classList.toggle('active', idx === i));
}

// ===== 供奉页 =====
async function loadOffering() {
  selectedOfferingType = 1;
  selectedBuddha = null;

  const typesRes = await fetchAPI(`${API}/offering-types`);
  if (typesRes.code === 0) {
    $('offering-types').innerHTML = (typesRes.data || []).map(t => `
      <div class="offering-type-item ${t.id === 1 ? 'active' : ''}" onclick="selectOfferingType(${t.id})" data-otid="${t.id}">
        <div class="type-icon">${t.icon}</div>
        <span class="type-name">${t.name}</span>
      </div>
    `).join('');
  }

  const buddhaList = await getBuddhas();
  $('buddha-grid').innerHTML = buddhaList.map(b => `
      <div class="buddha-item" data-bid="${b.id}" onclick="selectBuddha(${b.id})">
        <img src="${b.image || ''}" alt="${b.name}" loading="lazy" decoding="async" onclick="event.stopPropagation();navigateToBuddha(${b.id})">
        <div class="buddha-name" onclick="event.stopPropagation();navigateToBuddha(${b.id})">${b.name}</div>
        <div class="buddha-hall">${b.hall}</div>
        <button class="buddha-offer-btn" onclick="event.stopPropagation();selectBuddha(${b.id})">🙏 供奉</button>
      </div>
    `).join('');
}

function selectOfferingType(id) {
  selectedOfferingType = id;
  qsa('.offering-type-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.otid) === id));
}

function selectBuddha(id) {
  selectedBuddha = id;
  qsa('.buddha-item').forEach(el => el.classList.toggle('selected', parseInt(el.dataset.bid) === id));
  showOfferingModal();
}

async function showOfferingModal() {
  const buddhaList = await getBuddhas();
  const buddha = buddhaList.find(b => b.id === selectedBuddha);
  if (!buddha) return showToast('请选择佛像');

  const typesRes = await fetchAPI(`${API}/offering-types`);
  const type = typesRes.data?.find(t => t.id === selectedOfferingType);
  const typeName = type ? type.name : '供奉';
  const prices = buddha.offering_price || [10, 50, 100, 200];

  showModal(`
    <div style="position:relative">
      <span class="modal-close" onclick="closeModal(event)">✕</span>
      <div class="modal-title">${typeName} · ${buddha.name}</div>
      <div style="text-align:center;margin-bottom:12px">
        <img src="${buddha.image || ''}" style="width:72px;height:72px;border-radius:50%;border:2px solid var(--gold-light)" alt="${buddha.name}" loading="lazy" decoding="async" onclick="closeModal(event);navigateToBuddha(${buddha.id})">
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px">${buddha.intro}</p>
        <button class="btn-sm" style="font-size:11px;color:#C9A96E;background:none;border:1px solid var(--gold-light);border-radius:12px;padding:2px 12px;margin-top:4px" onclick="closeModal();navigateToBuddha(${buddha.id})">查看佛像详情 →</button>
      </div>
      <div class="form-group">
        <label>供奉金额</label>
        <div class="price-options" id="modal-prices">
          ${prices.map((p, i) => `<span class="price-option ${i === 0 ? 'selected' : ''}" data-price="${p}" onclick="selectPrice(this)">¥${p}</span>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>自定义金额</label>
        <input type="number" id="offering-amount" placeholder="输入金额（元）" value="${prices[0]}">
      </div>
      <div class="form-group"><label>您的姓名</label><input type="text" id="offering-name" placeholder="请输入您的姓名"></div>
      <div class="form-group"><label>联系电话</label><input type="tel" id="offering-phone" placeholder="请输入联系电话"></div>
      <div class="form-group"><label>祈福留言</label><textarea id="offering-message" placeholder="请输入祈福留言..." rows="3"></textarea></div>
      <button class="btn-primary btn-lg btn-block" onclick="submitOffering()">确认供奉 · 功德无量</button>
    </div>
  `);
}

function selectPrice(el) {
  qsa('#modal-prices .price-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  $('offering-amount').value = el.dataset.price;
}

async function submitOffering() {
  const amount = $('offering-amount').value;
  if (!amount || parseFloat(amount) <= 0) return showToast('请选择或输入供奉金额');
  const res = await postAPI(`${API}/offering`, {
    buddha_id: selectedBuddha,
    offering_type: selectedOfferingType,
    amount: parseFloat(amount),
    message: $('offering-message').value,
    user_name: $('offering-name').value || '善信',
    user_phone: $('offering-phone').value
  });
  if (res.code === 0) { showToast(res.msg); closeModal({ target: $('modal-overlay') }); }
  else showToast(res.msg || '提交失败');
}

// ===== 牌位页 =====
var _tabletConfigs = [];
var _currentTabletType = 'ancestor';
var _currentTabletPrice = 100;

async function loadTablet() {
  var res = await fetchAPI(API + '/tablet-configs');
  if (res.code === 0) _tabletConfigs = res.data || [];
  
  var ancestor = _tabletConfigs.find(t => t.type === 'ancestor') || { id: 1, type: 'ancestor', name: '往生牌位', price: 100, duration: '一年' };
  var living = _tabletConfigs.find(t => t.type === 'living') || { id: 2, type: 'living', name: '延生牌位', price: 100, duration: '一年' };
  
  // 渲染类型卡片
  var tabsEl = document.querySelector('.tablet-type-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = 
      '<span class="tablet-tab ancestor active" data-type="ancestor" data-price="' + ancestor.price + '" data-id="' + ancestor.id + '">🕯️ ' + ancestor.name + '<br><small>¥' + ancestor.price + '/' + (ancestor.duration || '一年') + '</small></span>' +
      '<span class="tablet-tab living" data-type="living" data-price="' + living.price + '" data-id="' + living.id + '">🌸 ' + living.name + '<br><small>¥' + living.price + '/' + (living.duration || '一年') + '</small></span>';
    document.querySelectorAll('.tablet-tab').forEach(tab => {
      tab.onclick = function() {
        document.querySelectorAll('.tablet-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        selectTabletType(this.dataset.type, parseFloat(this.dataset.price));
      };
    });
  }
  // 默认选往生
  selectTabletType('ancestor', ancestor.price);
}

function selectTabletType(type, price) {
  _currentTabletType = type;
  _currentTabletPrice = price;
  $('tablet-type').value = type;
  
  var infoEl = $('tablet-info-area');
  var nameLabel = $('tablet-name-label');
  var durationGroup = $('tablet-duration-group');
  var amountEl = $('tablet-amount');
  var submitBtn = $('tablet-submit-btn');
  
  // 更新所有class
  [infoEl, amountEl, submitBtn].forEach(function(el) { 
    if (el) { el.classList.remove('ancestor', 'living'); el.classList.add(type); }
  });
  document.getElementById('tablet-date-display')?.classList.remove('ancestor', 'living');
  document.getElementById('tablet-date-display')?.classList.add(type);
  
  if (type === 'ancestor') {
    infoEl.innerHTML = '🕯️ <b>往生牌位</b> · 为逝者祈福超度<br>愿往生净土，离苦得乐，莲登九品';
    nameLabel.textContent = '逝者姓名 *';
    $('tablet-deceased').placeholder = '请输入逝者姓名';
    durationGroup.style.display = 'block';
    submitBtn.textContent = '🕯️ 确认登记往生牌位';
  } else {
    infoEl.innerHTML = '🌸 <b>延生牌位</b> · 为生者祈福消灾<br>愿福寿康宁，吉祥如意，诸事顺遂';
    nameLabel.textContent = '祈福者姓名 *';
    $('tablet-deceased').placeholder = '请输入祈福者姓名';
    durationGroup.style.display = 'block';
    submitBtn.textContent = '🌸 确认登记延生牌位';
  }
  
  updateTabletAmount();
}

function updateTabletAmount() {
  var years = parseInt($('tablet-duration')?.value || 1);
  var total = _currentTabletPrice * years;
  $('tablet-amount').value = total.toFixed(2);
  
  // 计算到期日期
  var d = new Date();
  d.setFullYear(d.getFullYear() + years);
  var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  $('tablet-date').value = dateStr;
  $('tablet-date-display').value = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + years + '年后）';
}

async function submitTablet(e) {
  e.preventDefault();
  var amount = parseFloat($('tablet-amount')?.value || 0);
  var type = $('tablet-type').value;
  var years = parseInt($('tablet-duration')?.value || 1);
  var typeName = type === 'ancestor' ? '往生牌位' : '延生牌位';
  
  // 先创建牌位记录
  var recordRes = await postAPI(`${API}/tablet`, {
    type: type,
    deceased_name: $('tablet-deceased').value,
    sponsor_name: $('tablet-sponsor').value,
    sponsor_phone: $('tablet-phone').value,
    date: $('tablet-date').value,
    message: $('tablet-message').value,
    amount: amount,
    years: years
  });
  if (recordRes.code !== 0) return showToast(recordRes.msg || '提交失败');
  
  // 金额大于0，走支付
  if (amount > 0) {
    var paid = await doPay({
      order_type: 'tablet',
      biz_ref_id: recordRes.data ? recordRes.data.id : 0,
      amount: amount,
      description: typeName + ' · ' + ($('tablet-deceased').value || '') + (type === 'ancestor' ? ' · ' + years + '年' : ''),
      extra: { type: type, years: years }
    });
    if (paid === false) return;
  }
  showToast(recordRes.msg || '牌位登记成功');
  ['tablet-deceased','tablet-sponsor','tablet-phone','tablet-message'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  // 恢复默认
  selectTabletType('ancestor', _currentTabletPrice);
}

// ===== 祈愿页 =====
var _prayerWishes = [];

async function loadPrayer() {
  initPrayerStars();
  await refreshPrayerWall();
  startFloatingLanterns();
}

function initPrayerStars() {
  const container = $('lanterns-container');
  container.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 80 + '%';
    star.style.animationDelay = Math.random() * 5 + 's';
    star.style.animationDuration = (2 + Math.random() * 4) + 's';
    star.style.width = (1.5 + Math.random() * 2) + 'px';
    star.style.height = star.style.width;
    container.appendChild(star);
  }
}

function startFloatingLanterns() {
  const container = $('lanterns-container');
  setInterval(() => {
    const lantern = document.createElement('div');
    lantern.className = 'lantern-fly';
    var icons = ['🏮', '🪷', '✨', '🏮'];
    var icon = icons[Math.floor(Math.random() * icons.length)];
    var html = '<span class="lantern-icon">' + icon + '</span>';
    // Add wish bubble with name + message
    if (_prayerWishes.length > 0) {
      var idx = Math.floor(Math.random() * _prayerWishes.length);
      var w = _prayerWishes[idx] || { name: '善信', content: '' };
      var name = (w.name || '善信');
      var msg = (w.content || w);
      if (msg && msg.length > 20) msg = msg.substring(0, 20) + '…';
      html += '<span class="lantern-bubble"><div class="bubble-name">' + name + '</div><div class="bubble-msg">' + (msg || '祈愿') + '</div></span>';
    }
    lantern.innerHTML = html;
    lantern.style.left = (8 + Math.random() * 84) + '%';
    lantern.style.animationDuration = (10 + Math.random() * 8) + 's';
    container.appendChild(lantern);
    setTimeout(() => { if (lantern.parentNode) lantern.parentNode.removeChild(lantern); }, 15000);
  }, 2800);
}

async function refreshPrayerWall() {
  const res = await fetchAPI(`${API}/prayers`);
  if (res.code === 0 && res.data.length > 0) {
    var items = res.data.slice(-8).reverse();
    _prayerWishes = items.map(function(p) { return { name: p.name || '善信', content: p.content }; });
    $('prayer-wall').innerHTML = items.map(p => `
      <div class="prayer-card"><div class="prayer-name">🏮 ${p.name || '善信'}</div><div class="prayer-content">${p.content}</div></div>
    `).join('');
  } else {
    _prayerWishes = [];
    $('prayer-wall').innerHTML = '<p style="text-align:center;color:#8D6E63;padding:24px;font-size:14px">还没有人许愿，来点亮第一盏心灯吧 🏮</p>';
  }
}

function showPrayerModal() {
  showModal(`
    <div style="position:relative">
      <span class="modal-close" onclick="closeModal(event)">✕</span>
      <div class="modal-title">🏮 祈愿</div>
      <div class="form-group"><label>您的称呼</label><input type="text" id="prayer-name" placeholder="请输入您的称呼"></div>
      <div class="form-group"><label>心愿内容 *</label><textarea id="prayer-content" placeholder="写下你的心愿..." rows="4" required></textarea></div>
      <div class="form-group">
        <label>祈愿类型</label>
        <div style="display:flex;gap:10px;margin-top:6px">
          <span class="price-option selected" data-type="lamp" onclick="selectPrayerType(this)" style="flex:1;text-align:center">🏮 心灯</span>
          <span class="price-option" data-type="lotus" onclick="selectPrayerType(this)" style="flex:1;text-align:center">🪷 莲花</span>
        </div>
        <input type="hidden" id="prayer-type" value="lamp">
      </div>
      <button class="btn-primary btn-lg btn-block" onclick="submitPrayer()">放飞心愿 🏮</button>
    </div>
  `);
}

function selectPrayerType(el) {
  qsa('.price-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  $('prayer-type').value = el.dataset.type;
}

async function submitPrayer() {
  const content = $('prayer-content')?.value;
  if (!content) return showToast('请写下你的心愿');
  const res = await postAPI(`${API}/prayer`, { name: $('prayer-name').value || '善信', content, type: $('prayer-type').value });
  if (res.code === 0) {
    showToast(res.msg);
    closeModal({ target: $('modal-overlay') });
    const container = $('lanterns-container');
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const l = document.createElement('div');
        l.className = 'lantern-fly';
        var icon = res.data.type === 'lotus' ? '🪷' : '🏮';
        var name = $('prayer-name').value || '善信';
        var msg = content.length > 20 ? content.substring(0, 20) + '…' : content;
        l.innerHTML = '<span class="lantern-icon">' + icon + '</span><span class="lantern-bubble"><div class="bubble-name">' + name + '</div><div class="bubble-msg">' + msg + '</div></span>';
        l.style.left = (8 + Math.random() * 84) + '%';
        l.style.animationDuration = (10 + Math.random() * 6) + 's';
        container.appendChild(l);
        setTimeout(() => { if (l.parentNode) l.parentNode.removeChild(l); }, 14000);
      }, i * 600);
    }
    setTimeout(() => refreshPrayerWall(), 1000);
  } else showToast(res.msg || '提交失败');
}

// ===== 放生页 =====
async function loadRelease() {
  selectedReleaseAnimal = null;
  const res = await fetchAPI(`${API}/releases`);
  if (res.code === 0) {
    $('release-animals').innerHTML = (res.data || []).map(a => `
      <div class="release-animal-card" onclick="selectReleaseAnimal(${a.id})">
        <div class="animal-icon">${a.image}</div>
        <div class="animal-name">${a.name}</div>
        <div class="animal-price">¥${a.price}/只</div>
        <div class="animal-desc">${a.desc}</div>
      </div>
    `).join('');
  }
}

function selectReleaseAnimal(id) {
  selectedReleaseAnimal = id;
  qsa('.release-animal-card').forEach(el => el.classList.remove('selected'));
  const card = qs(`.release-animal-card[onclick="selectReleaseAnimal(${id})"]`);
  if (card) card.classList.add('selected');
  showReleaseModal(id);
}

async function showReleaseModal(animalId) {
  const res = await fetchAPI(`${API}/releases`);
  const animal = res.data?.find(a => a.id === animalId);
  if (!animal) return;
  showModal(`
    <div style="position:relative">
      <span class="modal-close" onclick="closeModal(event)">✕</span>
      <div class="modal-title">${animal.image} 放生 · ${animal.name}</div>
      <p style="font-size:13px;color:var(--text-muted);text-align:center;margin-bottom:16px">${animal.desc}</p>
      <div class="form-group">
        <label>放生数量</label>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn-secondary" onclick="changeQty(-1)" style="width:36px;height:36px;padding:0;font-size:18px">−</button>
          <input type="number" id="release-qty" value="1" min="1" max="99" style="width:60px;text-align:center" readonly>
          <button class="btn-secondary" onclick="changeQty(1)" style="width:36px;height:36px;padding:0;font-size:18px">+</button>
          <span style="font-size:14px;color:var(--red);font-weight:600">¥<span id="release-total-price">${animal.price}</span></span>
        </div>
        <input type="hidden" id="release-unit-price" value="${animal.price}">
      </div>
      <div class="form-group"><label>您的姓名</label><input type="text" id="release-name" placeholder="请输入您的姓名"></div>
      <div class="form-group"><label>联系电话</label><input type="tel" id="release-phone" placeholder="请输入联系电话"></div>
      <div class="form-group"><label>功德回向</label><textarea id="release-dedication" rows="2">愿以此功德，普及于一切，我等与众生，皆共成佛道。</textarea></div>
      <button class="btn-primary btn-lg btn-block" onclick="submitRelease()">确认放生 🕊️</button>
    </div>
  `);
}

function changeQty(delta) {
  const input = $('release-qty');
  const unitPrice = parseFloat($('release-unit-price').value);
  let qty = parseInt(input.value) + delta;
  if (qty < 1) qty = 1; if (qty > 99) qty = 99;
  input.value = qty;
  $('release-total-price').textContent = (unitPrice * qty).toFixed(0);
}

async function submitRelease() {
  var qty = parseInt($('release-qty').value);
  var totalAmount = parseFloat($('release-total-price').textContent);
  var name = $('release-name').value || '善信';
  var phone = $('release-phone').value || '';
  var dedication = $('release-dedication').value || '';
  
  // 先创建放生记录
  var recordRes = await postAPI(`${API}/release`, {
    animal_id: selectedReleaseAnimal,
    quantity: qty,
    amount: totalAmount,
    name: name,
    phone: phone,
    dedication: dedication
  });
  if (recordRes.code !== 0) return showToast(recordRes.msg || '提交失败');
  
  // 金额大于0，走支付
  if (totalAmount > 0) {
    var paid = await doPay({
      order_type: 'release',
      biz_ref_id: recordRes.data ? recordRes.data.id : 0,
      amount: totalAmount,
      description: '放生 · ' + (recordRes.data?.animal_name || '护生'),
      extra: { animal_id: selectedReleaseAnimal, quantity: qty }
    });
    if (paid === false) return;
  }
  showToast(recordRes.msg || '放生功德已记录');
  closeModal({ target: $('modal-overlay') });
}

// ===== 行善页 =====
async function loadMerit() {
  const res = await fetchAPI(`${API}/merit-projects`);
  if (res.code === 0) {
    $('merit-projects').innerHTML = (res.data || []).map(p => {
      const percent = p.target > 0 ? Math.round((p.current / p.target) * 100) : 0;
      return `<div class="merit-project-card" onclick="showDonateModal(${p.id})">
        <div class="merit-project-header"><span class="merit-project-icon">${p.image}</span><span class="merit-project-title">${p.name}</span></div>
        <div class="merit-project-desc">${p.desc}</div>
        <div class="merit-progress-bar"><div class="merit-progress-fill" style="width:${percent}%"></div></div>
        <div class="merit-progress-info"><span>已筹 <b>¥${p.current.toLocaleString()}</b></span><span>目标 ¥${p.target.toLocaleString()} (${percent}%)</span></div>
      </div>`;
    }).join('');
  }
}

async function showDonateModal(projectId) {
  const res = await fetchAPI(`${API}/merit-projects`);
  const project = res.data?.find(p => p.id === projectId);
  if (!project) return;
  const prices = project.price_options || [50, 100, 200, 500];
  showModal(`
    <div style="position:relative">
      <span class="modal-close" onclick="closeModal(event)">✕</span>
      <div class="modal-title">❤️ 随喜功德 · ${project.name}</div>
      <p style="font-size:13px;color:var(--text-muted);text-align:center;margin-bottom:16px">${project.desc}</p>
      <div class="form-group"><label>随喜金额</label><div class="price-options" id="modal-donate-prices">${prices.map((p, i) => `<span class="price-option ${i === 0 ? 'selected' : ''}" data-price="${p}" onclick="selectDonatePrice(this)">¥${p}</span>`).join('')}</div></div>
      <div class="form-group"><label>自定义金额</label><input type="number" id="donate-amount" placeholder="输入金额（元）" value="${prices[0]}"></div>
      <div class="form-group"><label>您的姓名</label><input type="text" id="donate-name" placeholder="请输入您的姓名"></div>
      <div class="form-group"><label>联系电话</label><input type="tel" id="donate-phone" placeholder="请输入联系电话"></div>
      <div class="form-group"><label>留言</label><textarea id="donate-message" rows="2"></textarea></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="donate-anonymous" style="width:auto"><label for="donate-anonymous" style="margin-bottom:0">匿名捐赠</label></div>
      <input type="hidden" id="donate-project-id" value="${projectId}">
      <button class="btn-primary btn-lg btn-block" onclick="submitDonation()">确认功德 ❤️</button>
    </div>
  `);
}

function selectDonatePrice(el) {
  qsa('#modal-donate-prices .price-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  $('donate-amount').value = el.dataset.price;
}

async function submitDonation() {
  const amount = $('donate-amount').value;
  if (!amount || parseFloat(amount) <= 0) return showToast('请选择或输入随喜金额');
  const res = await postAPI(`${API}/donate`, {
    project_id: parseInt($('donate-project-id').value),
    amount: parseFloat(amount),
    name: $('donate-name').value || '善信',
    phone: $('donate-phone').value,
    message: $('donate-message').value,
    is_anonymous: $('donate-anonymous').checked
  });
  if (res.code === 0) { showToast(res.msg); closeModal({ target: $('modal-overlay') }); loadMerit(); }
  else showToast(res.msg || '提交失败');
}

// ===== 活动页 =====
async function loadActivities() {
  const res = await fetchAPI(`${API}/activities`);
  if (res.code === 0) {
    $('activity-list').innerHTML = (res.data || []).map(a => {
      const statusMap = { upcoming: '即将开始', ongoing: '进行中', ended: '已结束' };
      const isFull = a.participants >= a.max_participants;
      const statusClass = isFull ? 'full' : a.status;
      const percent = a.max_participants ? Math.round(a.participants / a.max_participants * 100) : 0;
      return `<div class="activity-card">
        <div class="act-img-wrap">
          <img src="${a.image}" alt="${a.title}" loading="lazy" decoding="async">
          <span class="act-img-tag ${statusClass}">${isFull ? '已满' : statusMap[a.status] || '即将开始'}</span>
        </div>
        <div class="activity-card-body">
          <h3>${a.title}</h3>
          <p class="act-desc">${a.desc}</p>
          <div class="act-meta">
            <span>📅 ${a.date}</span><span>🕐 ${a.time}</span><span>📍 ${a.location}</span>
          </div>
          <div class="act-footer">
            <span class="act-people">👥 ${a.participants}/${a.max_participants}人<div class="act-people-bar"><div class="act-people-bar-inner" style="width:${percent}%"></div></div></span>
            ${(!isFull && a.status === 'upcoming') ? `<button class="act-reg-btn" onclick="showActivityRegModal(${a.id})">我要报名</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }
}

async function showActivityRegModal(activityId) {
  var res = await fetchAPI(API + '/activities');
  var act = res.data?.find(a => a.id === activityId);
  if (!act) return;
  var price = act.price || 0;
  var hasFee = price > 0;
  showModal(
    '<div style="position:relative">' +
      '<span class="modal-close" onclick="closeModal(event)">✕</span>' +
      '<div class="modal-title">📝 报名 · ' + act.title + '</div>' +
      '<div style="font-size:13px;color:var(--text-muted);text-align:center;margin-bottom:16px">📅 ' + act.date + ' | 🕐 ' + act.time + ' | 📍 ' + act.location +
        (hasFee ? '<br><span style="color:#D4A017;font-weight:700">¥' + price.toFixed(2) + '/人</span>' : '<br><span style="color:#28a745">免费</span>') +
      '</div>' +
      '<div class="form-group"><label>您的姓名 *</label><input type="text" id="reg-name" placeholder="请输入您的姓名" required></div>' +
      '<div class="form-group"><label>联系电话</label><input type="tel" id="reg-phone" placeholder="请输入联系电话"></div>' +
      '<div class="form-group"><label>参加人数</label><input type="number" id="reg-num" value="1" min="1" max="' + (act.max_participants - act.participants) + '" onchange="updateRegTotal(' + price + ')"></div>' +
      (hasFee ? '<div class="form-group"><label>合计金额（元）</label><input type="text" id="reg-total" value="' + price.toFixed(2) + '" readonly style="font-weight:700;font-size:18px;color:#D4A017;background:#faf6f0"></div>' : '') +
      '<input type="hidden" id="reg-activity-id" value="' + activityId + '">' +
      '<input type="hidden" id="reg-price" value="' + price + '">' +
      '<button class="btn-primary btn-lg btn-block" onclick="submitActivityReg()">' + (hasFee ? '💰 确认报名并支付' : '确认报名') + '</button>' +
    '</div>'
  );
}

function updateRegTotal(pricePer) {
  var num = parseInt(document.getElementById('reg-num')?.value || 1);
  var total = pricePer * num;
  var el = document.getElementById('reg-total');
  if (el) el.value = total.toFixed(2);
}

async function submitActivityReg() {
  var name = $('reg-name').value;
  if (!name) return showToast('请输入姓名');
  var activityId = parseInt($('reg-activity-id').value);
  var num = parseInt($('reg-num').value) || 1;
  var price = parseFloat($('reg-price')?.value) || 0;
  var totalAmount = price * num;

  // 先创建报名记录
  var res = await postAPI(API + '/activity/register', {
    activity_id: activityId,
    name: name,
    phone: $('reg-phone').value,
    num_people: num
  });
  if (res.code !== 0) return showToast(res.msg || '报名失败');

  // 需要支付
  if (totalAmount > 0) {
    var actRes = await fetchAPI(API + '/activities');
    var act = actRes.data?.find(a => a.id === activityId);
    var paid = await doPay({
      order_type: 'activity',
      biz_ref_id: res.data ? res.data.id : 0,
      amount: totalAmount,
      description: (act?.title || '法会活动') + ' · 报名费 · ' + num + '人',
      extra: { activity_id: activityId, num_people: num }
    });
    if (paid === false) return;
  }

  showToast(res.msg || '报名成功');
  closeModal({ target: $('modal-overlay') });
  loadActivities();
}

// ===== 商城 =====
async function loadShop(category) {
  if (category !== undefined) shopCategory = category;
  else category = shopCategory;
  qsa('.cat-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.cat === category);
    tab.onclick = () => loadShop(tab.dataset.cat);
  });
  const url = category ? `${API}/shop/items?category=${encodeURIComponent(category)}` : `${API}/shop/items`;
  const res = await fetchAPI(url);
  if (res.code === 0) {
    $('shop-grid').innerHTML = (res.data || []).map(item => `
      <div class="shop-item">
        <img src="${item.image}" alt="${item.name}" loading="lazy">
        <div class="shop-item-body">
          <div class="shop-item-name">${item.name}</div><div class="shop-item-desc">${item.desc}</div>
          <div class="shop-item-footer"><span class="shop-item-price">¥${item.price}</span><button class="shop-item-add" onclick="event.stopPropagation();addToCart(${item.id})">+</button></div>
        </div>
      </div>
    `).join('');
  }
}

async function addToCart(itemId) {
  if (!currentUser) { showToast('请先登录'); showLoginModal(); return; }
  // 直接购买取代购物车
  const res = await fetchAPI(`${API}/shop/items`);
  const item = res.data?.find(i => i.id === itemId);
  if (!item) return showToast('商品不存在');
  showModal(`
    <div style="position:relative">
      <span class="modal-close" onclick="closeModal(event)">✕</span>
      <div class="modal-title">🛍️ 请购法物</div>
      <div style="text-align:center;margin-bottom:12px">
        <img src="${item.image}" style="width:100px;height:100px;border-radius:8px;object-fit:cover" alt="${item.name}" loading="lazy" decoding="async">
        <p style="font-size:15px;font-weight:600;margin-top:8px">${item.name}</p>
        <p style="font-size:20px;font-weight:700;color:var(--red)">¥${item.price}</p>
      </div>
      <div class="form-group">
        <label>数量</label>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn-secondary" onclick="changeBuyQty(-1)" style="width:36px;height:36px;padding:0;font-size:18px">−</button>
          <input type="number" id="buy-qty" value="1" min="1" max="${item.stock}" style="width:60px;text-align:center" readonly>
          <button class="btn-secondary" onclick="changeBuyQty(1)" style="width:36px;height:36px;padding:0;font-size:18px">+</button>
        </div>
      </div>
      <div class="form-group"><label>您的姓名</label><input type="text" id="buy-name" value="${currentUser?.nickname || ''}"></div>
      <div class="form-group"><label>联系电话</label><input type="tel" id="buy-phone" value="${currentUser?.phone || ''}"></div>
      <input type="hidden" id="buy-item-id" value="${itemId}">
      <input type="hidden" id="buy-price" value="${item.price}">
      <button class="btn-primary btn-lg btn-block" onclick="submitBuyOrder()">确认请购 · 功德无量</button>
    </div>
  `);
}

function changeBuyQty(delta) {
  const input = $('buy-qty');
  let q = parseInt(input.value) + delta;
  if (q < 1) q = 1; if (q > 99) q = 99;
  input.value = q;
}

async function submitBuyOrder() {
  const itemId = parseInt($('buy-item-id').value);
  const price = parseFloat($('buy-price').value);
  const qty = parseInt($('buy-qty').value);
  const name = $('buy-name').value || '善信';
  const phone = $('buy-phone').value;
  const total = price * qty;
  const res = await postAPI(`${API}/order/create`, {
    user_id: currentUser.id,
    items: [{ name: '法物', price, quantity: qty }],
    total_amount: total
  });
  if (res.code === 0) {
    showToast('结缘成功，功德无量！');
    closeModal({ target: $('modal-overlay') });
  } else showToast(res.msg || '创建订单失败');
}

// ===== 导览页 =====
var _currentHallData = null, _currentAreaName = '';
var _detailTab = 'intro';

async function loadTour() {
  $('tour-list-view').style.display = 'block';
  $('tour-detail-view').style.display = 'none';
  
  const res = await fetchAPI(`${API}/areas`);
  const areas = (res.code === 0 && res.data && res.data.length > 0) ? res.data : [];

  if (areas.length === 0) {
    $('tour-map').innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px">暂无导览内容，请管理员配置</p>';
    return;
  }

  $('tour-map').innerHTML = areas.map(area => {
    const halls = (area.halls || []).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    if (halls.length === 0) return '';
    return '<div class="tour-area">' +
      '<div class="tour-area-header">' +
        '<span class="tour-area-icon">🏛️</span>' +
        '<span class="tour-area-name">' + area.name + '</span>' +
        '<span class="tour-area-desc">' + (area.desc || '') + '</span>' +
      '</div>' +
      halls.map(function(h) {
        var img = h.image || '';
        if (!img) img = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90"><rect fill="#f0e8d8" width="120" height="90"/><text x="60" y="50" text-anchor="middle" font-size="24">🏛️</text></svg>');
        var areaName = area.name;
        return '<div class="tour-hall" onclick="showTourDetail(\'' + 
          h.id + '\',\'' + 
          h.name.replace(/'/g, "\\'") + '\',\'' + 
          areaName.replace(/'/g, "\\'") + '\',\'' + 
          (h.desc || '').replace(/'/g, "\\'") + '\',\'' + 
          img.replace(/'/g, "\\'") + '\')">' +
          '<div class="tour-hall-thumb"><img src="' + img + '" alt="' + h.name + '" loading="lazy" decoding="async"></div>' +
          '<div class="tour-hall-body">' +
            '<div class="tour-hall-name">' + h.name + '</div>' +
            '<div class="tour-hall-desc">' + (h.desc || '') + '</div>' +
            (h.video ? '<div class="tour-hall-video">🎬 视频介绍</div>' : '') +
          '</div>' +
          '<div class="tour-hall-arrow">›</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('') || '<p style="text-align:center;color:var(--text-muted);padding:20px">暂无导览内容</p>';
}

// Store hall data globally and show detail
window._allAreas = [];
async function showTourDetail(hallId, name, areaName, desc, image) {
  // Find full hall data
  var hall = null;
  var areas = window._allAreas;
  if (areas.length === 0) {
    var res = await fetchAPI(API + '/areas');
    if (res.code === 0) { areas = res.data; window._allAreas = areas; }
  }
  for (var i = 0; i < areas.length; i++) {
    var h = (areas[i].halls || []).find(function(x) { return x.id == hallId; });
    if (h) { hall = h; areaName = areas[i].name; break; }
  }
  
  _currentHallData = hall || { id: hallId, name: name, desc: desc, images: [image], video: '', buddha_ids: [] };
  _currentAreaName = areaName;
  _detailTab = 'intro';
  
  // Get images array (backward compat)
  var images = (_currentHallData.images && _currentHallData.images.length) ? _currentHallData.images : (_currentHallData.image ? [_currentHallData.image] : [image]);
  _currentHallData._heroImages = images;
  _currentHallData._heroIndex = 0;
  setHeroImage(0);
  
  // Set title and tags
  $('detail-title').textContent = name;
  $('detail-tags').innerHTML = '<span class="detail-tag">🏛️ ' + areaName + '</span><span class="detail-tag">📍 殿堂</span>';
  
  // Set reminder
  $('detail-open-info').textContent = '每日开放 · 请保持肃静 · 勿大声喧哗';
  
  // Audio bar (show if video URL exists)
  if (_currentHallData.video) {
    $('detail-audio-bar').style.display = 'flex';
  } else {
    $('detail-audio-bar').style.display = 'none';
  }
  
  // Description
  var descEl = $('detail-desc-text');
  descEl.textContent = (desc || '暂无详细介绍') + '\n\n' + (desc || '');
  descEl.classList.remove('expanded');
  $('detail-expand-btn').textContent = '展开阅读全文';
  $('detail-expand-btn').style.display = 'block';
  
  // Tabs
  document.querySelectorAll('.detail-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelector('.detail-tab[onclick*="intro"]').classList.add('active');
  
  loadDetailTabContent('intro');
  
  // Show detail view
  $('tour-list-view').style.display = 'none';
  $('tour-detail-view').style.display = 'block';
  window.scrollTo(0, 0);
  // Auto-play if enabled
  if (_ttsConfig.autoPlay) autoSpeakDesc();
}

function backToTourList() {
  $('tour-detail-view').style.display = 'none';
  $('tour-list-view').style.display = 'block';
  _currentHallData = null;
}

function setHeroImage(index) {
  if (!_currentHallData || !_currentHallData._heroImages) return;
  var images = _currentHallData._heroImages;
  if (index < 0) index = 0;
  if (index >= images.length) index = images.length - 1;
  _currentHallData._heroIndex = index;
  var url = images[index] || '';
  $('detail-hero').style.backgroundImage = 'linear-gradient(180deg, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0.6)), url(\'' + url + '\')';
  // Update dots
  var dots = document.getElementById('detail-hero-dots');
  if (images.length > 1) {
    dots.innerHTML = images.map(function(_, i) {
      return '<span class="detail-hero-dot' + (i === index ? ' active' : '') + '" onclick="setHeroImage(' + i + ')"></span>';
    }).join('');
    dots.style.display = 'flex';
    document.getElementById('detail-hero-prev').style.display = index > 0 ? 'flex' : 'none';
    document.getElementById('detail-hero-next').style.display = index < images.length - 1 ? 'flex' : 'none';
  } else {
    dots.innerHTML = '';
    dots.style.display = 'none';
    document.getElementById('detail-hero-prev').style.display = 'none';
    document.getElementById('detail-hero-next').style.display = 'none';
  }
}
function prevHeroImage() {
  if (!_currentHallData) return;
  setHeroImage((_currentHallData._heroIndex || 0) - 1);
}
function nextHeroImage() {
  if (!_currentHallData) return;
  setHeroImage((_currentHallData._heroIndex || 0) + 1);
}

function toggleDesc() {
  var desc = $('detail-desc-text');
  var btn = $('detail-expand-btn');
  if (desc.classList.contains('expanded')) {
    desc.classList.remove('expanded');
    btn.textContent = '展开阅读全文';
  } else {
    desc.classList.add('expanded');
    btn.textContent = '收起';
  }
}

function switchDetailTab(tab) {
  _detailTab = tab;
  document.querySelectorAll('.detail-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.includes(tab === 'intro' ? '详细' : tab === 'buddhas' ? '佛像' : '参拜'));
  });
  loadDetailTabContent(tab);
}

async function loadDetailTabContent(tab) {
  var content = $('detail-tab-content');
  if (!_currentHallData) return;
  
  if (tab === 'intro') {
    content.innerHTML = '<p style="line-height:2">' + (_currentHallData.desc || '暂无详细介绍') + '</p>' +
      '<p style="margin-top:12px;color:#8D6E63;font-size:13px">📍 所属区域：' + _currentAreaName + '</p>';
  } else if (tab === 'buddhas') {
    var buddhaIds = _currentHallData.buddha_ids || [];
    if (buddhaIds.length === 0) {
      content.innerHTML = '<p style="color:#8D6E63;text-align:center;padding:12px">此殿暂无供奉佛像记录</p>';
      return;
    }
    var buddhas = await getBuddhas();
    content.innerHTML = buddhaIds.map(function(bid) {
      var b = buddhas.find(function(x) { return x.id == bid; });
      if (!b) return '';
      return '<div class="detail-buddha-item" onclick="navigateToBuddha(' + b.id + ')" style="cursor:pointer">' +
        '<img src="' + (b.image || '') + '" alt="' + b.name + '" loading="lazy" decoding="async">' +
        '<div><b>' + b.name + '</b><br><span style="font-size:12px;color:#8D6E63">' + (b.hall || '') + '</span></div>' +
        '<span style="color:#C9A96E;font-size:18px;flex-shrink:0">›</span>' +
      '</div>';
    }).join('') || '<p style="color:#8D6E63;text-align:center;padding:12px">暂无佛像信息</p>';
  } else if (tab === 'tips') {
    content.innerHTML = '<p style="line-height:2">🙏 <b>参拜须知</b></p>' +
      '<p style="line-height:2;margin-top:8px">1. 进入殿堂请保持安静，勿大声喧哗。</p>' +
      '<p style="line-height:2">2. 请衣着整洁，勿穿短裤、背心等暴露服装。</p>' +
      '<p style="line-height:2">3. 礼佛时三拜为宜，心诚则灵。</p>' +
      '<p style="line-height:2">4. 殿堂内请勿拍照，如需拍照请先询问。</p>' +
      '<p style="line-height:2">5. 请勿触摸佛像及法器等庄严物品。</p>' +
      '<p style="line-height:2;margin-top:10px;color:#8D6E63">📿 愿您法喜充满，六时吉祥。</p>';
  }
}

var _audioPlaying = false;
function toggleAudio() {
  _audioPlaying = !_audioPlaying;
  var btn = $('audio-btn');
  var progress = $('audio-progress');
  btn.textContent = _audioPlaying ? '⏸' : '▶';
  if (_audioPlaying) {
    progress.style.width = '0%';
    var w = 0;
    var timer = setInterval(function() {
      if (!_audioPlaying) { clearInterval(timer); return; }
      w += 1; if (w > 100) { clearInterval(timer); _audioPlaying = false; btn.textContent = '▶'; w = 0; }
      progress.style.width = w + '%';
    }, 300);
  } else {
    progress.style.width = '0%';
  }
}

function toggleDetailFav() {
  var icon = $('detail-fav-icon');
  if (icon.textContent === '🤍') {
    icon.textContent = '❤️';
    showToast('已收藏');
  } else {
    icon.textContent = '🤍';
    showToast('已取消收藏');
  }
}

function detailNavigate(action) {
  if (action === 'offering') {
    navigateTo('offering');
  }
}

// ===== 佛像详情页 =====
var _buddhaImages = [], _buddhaImgIdx = 0, _currentBuddhaData = null;
var _buddhasCache = null; // { data, time } cache for buddhas list

var _buddhaOriginTab = 'home';
var _buddhaOriginPage = null;

async function getBuddhas() {
  // Return cached buddhas if fresh (< 5 min)
  if (_buddhasCache && (Date.now() - _buddhasCache.time) < 5 * 60 * 1000) {
    return _buddhasCache.data;
  }
  var res = await fetchAPI(API + '/buddhas');
  if (res.code !== 0 || !res.data) return [];
  _buddhasCache = { data: res.data, time: Date.now() };
  return res.data;
}

async function navigateToBuddha(buddhaId) {
  // Save origin for back navigation
  _buddhaOriginTab = currentTab;
  _buddhaOriginPage = currentPage;
  // If coming from tour detail, save the detail state for restoration
  if (_currentHallData) {
    window._buddhaRestoreTour = {
      hallId: _currentHallData.id,
      name: _currentHallData.name,
      areaName: _currentAreaName,
      desc: _currentHallData.desc,
      image: (_currentHallData.images && _currentHallData.images[0]) || _currentHallData.image || ''
    };
  } else {
    window._buddhaRestoreTour = null;
  }

  var buddhas = await getBuddhas();
  var b = buddhas.find(function(x) { return x.id === buddhaId; });
  if (!b) return;
  _currentBuddhaData = b;
  _buddhaImages = (b.images && b.images.length) ? b.images : (b.image ? [b.image] : []);
  _buddhaImgIdx = 0;

  // Switch to buddha page (consistent with switchTab style)
  qsa('.page').forEach(function(p) { p.classList.remove('active'); });
  qsa('.tab-item').forEach(function(t) { t.classList.remove('active'); });
  $('tab-bar').style.display = 'none';
  var page = $('page-buddha');
  if (page) page.classList.add('active');

  // Set content
  document.getElementById('buddha-name-display').textContent = b.name;
  document.getElementById('buddha-intro-display').textContent = b.intro || '';
  document.getElementById('buddha-desc-display').textContent = (b.description || b.intro || '暂无详细介绍') + '\n\n愿见闻者，悉发菩提心，尽此一报身，同生极乐国。';

  // Video
  var vs = document.getElementById('buddha-video-section');
  var vp = document.getElementById('buddha-video-player');
  if (b.video) { vs.style.display = 'block'; vp.src = b.video; } else { vs.style.display = 'none'; }

  // Offering options
  var prices = b.offering_price || [10, 50, 100, 200];
  document.getElementById('buddha-offering-options').innerHTML = prices.map(function(p, i) {
    return '<span class="offering-opt' + (i === 1 ? ' active' : '') + '" onclick="selectBuddhaPrice(this)" data-price="' + p + '">¥' + p + '</span>';
  }).join('');
  window._buddhaSelectedPrice = prices[1] || prices[0];

  // Set first image
  setBuddhaHeroImage(0);
  window.scrollTo(0, 0);
  // Auto-play if enabled
  if (_ttsConfig.autoPlay) autoSpeakDesc();
}

function selectBuddhaPrice(el) {
  document.querySelectorAll('.offering-opt').forEach(function(o) { o.classList.remove('active'); });
  el.classList.add('active');
  window._buddhaSelectedPrice = parseInt(el.dataset.price);
}

function setBuddhaHeroImage(idx) {
  if (_buddhaImages.length === 0) return;
  if (idx < 0) idx = 0;
  if (idx >= _buddhaImages.length) idx = _buddhaImages.length - 1;
  _buddhaImgIdx = idx;
  var url = _buddhaImages[idx];
  var container = document.getElementById('buddha-hero-img');
  if (container) container.innerHTML = '<img src="' + url + '" alt="" decoding="async">';
  // Dots
  var dotsEl = document.getElementById('buddha-hero-dots');
  if (_buddhaImages.length > 1) {
    dotsEl.innerHTML = _buddhaImages.map(function(_, i) {
      return '<span class="buddha-hero-dot' + (i === idx ? ' active' : '') + '" onclick="setBuddhaHeroImage(' + i + ')"></span>';
    }).join('');
    document.getElementById('buddha-prev').style.display = idx > 0 ? 'flex' : 'none';
    document.getElementById('buddha-next').style.display = idx < _buddhaImages.length - 1 ? 'flex' : 'none';
  } else {
    dotsEl.innerHTML = '';
    document.getElementById('buddha-prev').style.display = 'none';
    document.getElementById('buddha-next').style.display = 'none';
  }
}
function prevBuddhaImg() { setBuddhaHeroImage(_buddhaImgIdx - 1); }
function nextBuddhaImg() { setBuddhaHeroImage(_buddhaImgIdx + 1); }

async function backFromBuddha() {
  $('page-buddha').classList.remove('active');
  
  // If came from tour detail, restore that view
  if (window._buddhaRestoreTour) {
    var t = window._buddhaRestoreTour;
    window._buddhaRestoreTour = null;
    // Activate page-tour first, then show detail
    qsa('.page').forEach(function(p) { p.classList.remove('active'); });
    $('page-tour').classList.add('active');
    $('tab-bar').style.display = 'flex';
    currentTab = 'tour';
    currentPage = null;
    qsa('.tab-item').forEach(function(t) { t.classList.remove('active'); });
    var tabEl = qs('.tab-item[data-tab="tour"]');
    if (tabEl) tabEl.classList.add('active');
    await showTourDetail(t.hallId, t.name, t.areaName, t.desc, t.image);
    window.scrollTo(0, 0);
    return;
  }
  
  // Otherwise restore previous tab/page
  $('tab-bar').style.display = (_buddhaOriginPage ? 'none' : 'flex');
  currentTab = _buddhaOriginTab;
  currentPage = _buddhaOriginPage;
  
  qsa('.page').forEach(function(p) { p.classList.remove('active'); });
  qsa('.tab-item').forEach(function(t) { t.classList.remove('active'); });
  
  if (_buddhaOriginPage) {
    var pageEl = $('page-' + _buddhaOriginPage);
    if (pageEl) pageEl.classList.add('active');
    if (_buddhaOriginPage === 'offering') loadOffering();
    else if (_buddhaOriginPage === 'tablet') loadTablet();
    else if (_buddhaOriginPage === 'prayer') loadPrayer();
    else if (_buddhaOriginPage === 'release') loadRelease();
    else if (_buddhaOriginPage === 'merit') loadMerit();
  } else {
    var pageEl = $('page-' + _buddhaOriginTab);
    if (pageEl) pageEl.classList.add('active');
    var tabEl = qs('.tab-item[data-tab="' + _buddhaOriginTab + '"]');
    if (tabEl) tabEl.classList.add('active');
    if (_buddhaOriginTab === 'home') loadHome();
    else if (_buddhaOriginTab === 'activities') loadActivities();
    else if (_buddhaOriginTab === 'tour') loadTour();
    else if (_buddhaOriginTab === 'shop') loadShop();
  }
  
  window.scrollTo(0, 0);
}

function buddhaQuickOffering() {
  if (!currentUser) { showToast('请先登录'); showLoginModal(); return; }
  if (!_currentBuddhaData) return;
  showModal('<div style="position:relative"><span class="modal-close" onclick="closeModal(event)">✕</span>' +
    '<div class="modal-title">🙏 供奉 ' + _currentBuddhaData.name + '</div>' +
    '<div style="text-align:center;font-size:28px;margin:12px 0;color:#C9A96E">¥' + (window._buddhaSelectedPrice || 50) + '</div>' +
    '<div class="form-group"><label>您的姓名</label><input id="bf-offer-name" placeholder="请输入您的姓名"></div>' +
    '<div class="form-group"><label>祈福心愿</label><textarea id="bf-offer-wish" rows="2" placeholder="写下您的祈福心愿..."></textarea></div>' +
    '<button class="btn-primary btn-lg btn-block" onclick="submitBuddhaOffering()">确认供奉 · 功德无量</button></div>');
}

async function submitBuddhaOffering() {
  var name = document.getElementById('bf-offer-name').value || '善信';
  var wish = document.getElementById('bf-offer-wish').value || '';
  var amount = window._buddhaSelectedPrice || 50;
  var res = await postAPI(API + '/offering', {
    user_id: currentUser.id,
    buddha_id: _currentBuddhaData.id,
    buddha_name: _currentBuddhaData.name,
    type: '供灯',
    amount: amount,
    wish: wish,
    donor: name
  });
  if (res.code === 0) {
    showToast('供奉成功，功德无量！');
    document.getElementById('modal').classList.remove('show');
    backFromBuddha();
  } else showToast(res.msg || '供奉失败');
}

function buddhaToggleFav() {
  var icon = document.getElementById('buddha-fav-icon');
  if (icon.textContent === '🤍') { icon.textContent = '❤️'; showToast('已礼敬'); }
  else { icon.textContent = '🤍'; showToast('已取消'); }
}

// ===== 我的 =====
var userAvatars = ['🙏','🧘','😊','🌟','🪷','🌸','🍀','💎','🎋','🏮','✨','🕊️'];
var mineDataLoaded = {};

async function loadMine() {
  // 用户信息
  if (currentUser) {
    var avatar = currentUser.avatar || '🙏';
    $('user-avatar').textContent = avatar;
    $('user-name').textContent = currentUser.nickname || '善信';
    $('user-name').onclick = function() { showProfileModal(); };
    var phoneEl = $('user-phone');
    phoneEl.style.display = 'block';
    phoneEl.textContent = '📱 ' + (currentUser.phone || '未设置');
    $('user-merit').innerHTML = '<span class="merit-icon">🏆</span><span>累计功德值：<b>' + (currentUser.merit || 0) + '</b></span>';
    $('edit-btn-icon').textContent = '✎';
  } else {
    $('user-avatar').textContent = '👤';
    $('user-name').textContent = '点击登录';
    $('user-name').onclick = showLoginModal;
    $('user-phone').style.display = 'none';
    $('user-merit').innerHTML = '<span class="merit-icon">🏆</span><span>累计功德值：<b>0</b></span>';
    $('edit-btn-icon').textContent = '→';
  }

  // 加载所有记录
  try {
    var res = await fetchAPI(API + '/info');
    if (res.code === 0 && res.data) {
      var d = res.data;
      // 供奉记录
      var offerings = d.offering_records || [];
      $('count-offering').textContent = offerings.length;
      $('list-offering').innerHTML = offerings.length > 0
        ? offerings.slice(0, 10).map(function(r) {
            return '<div class="mine-record">' +
              '<div class="mine-record-info">' +
                '<div class="mine-record-title">🙏 ' + (r.buddha_name || '供奉') + '</div>' +
                '<div class="mine-record-meta">' + (r.offering_type_name || '') + ' · ' + fmtTime(r.time) + '</div>' +
              '</div>' +
              '<div class="mine-record-extra">' +
                '<div class="mine-record-amount">¥' + (r.amount || 0).toFixed(2) + '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="mine-empty">暂无供奉记录</div>';

      // 牌位
      var tablets = d.tablets || [];
      $('count-tablet').textContent = tablets.length;
      $('list-tablet').innerHTML = tablets.length > 0
        ? tablets.slice(0, 10).map(function(r) {
            return '<div class="mine-record">' +
              '<div class="mine-record-info">' +
                '<div class="mine-record-title">🪷 为 ' + (r.name || '') + ' 设立 · ' + (r.type || '') + '</div>' +
                '<div class="mine-record-meta">' + fmtTime(r.time) + '</div>' +
              '</div>' +
              '<div class="mine-record-extra">' +
                '<div class="mine-record-amount">¥' + (r.amount || 0).toFixed(2) + '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="mine-empty">暂无牌位记录</div>';

      // 祈愿
      var prayers = d.prayers || [];
      $('count-prayer').textContent = prayers.length;
      $('list-prayer').innerHTML = prayers.length > 0
        ? prayers.slice(0, 10).map(function(r) {
            return '<div class="mine-record">' +
              '<div class="mine-record-info">' +
                '<div class="mine-record-title">🏮 ' + (r.content || '祈愿') + '</div>' +
                '<div class="mine-record-meta">' + fmtTime(r.time) + '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="mine-empty">暂无祈愿记录</div>';

      // 放生
      var releases = d.releases || [];
      $('count-release').textContent = releases.length;
      $('list-release').innerHTML = releases.length > 0
        ? releases.slice(0, 10).map(function(r) {
            return '<div class="mine-record">' +
              '<div class="mine-record-info">' +
                '<div class="mine-record-title">🕊️ ' + (r.type || '放生') + ' ' + (r.count || 1) + '位生灵</div>' +
                '<div class="mine-record-meta">' + fmtTime(r.time) + '</div>' +
              '</div>' +
              '<div class="mine-record-extra">' +
                '<div class="mine-record-amount">¥' + (r.amount || 0).toFixed(2) + '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="mine-empty">暂无放生记录</div>';

      // 功德
      var merits = d.merit_records || [];
      $('count-merit').textContent = merits.length;
      $('list-merit').innerHTML = merits.length > 0
        ? merits.slice(0, 10).map(function(r) {
            return '<div class="mine-record">' +
              '<div class="mine-record-info">' +
                '<div class="mine-record-title">❤️ ' + (r.project_name || '功德') + '</div>' +
                '<div class="mine-record-meta">' + (r.name || '') + ' · ' + fmtTime(r.time) + '</div>' +
              '</div>' +
              '<div class="mine-record-extra">' +
                '<div class="mine-record-amount">¥' + (r.amount || 0).toFixed(2) + '</div>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="mine-empty">暂无功德记录</div>';
    }
  } catch(e) { console.error('load mine data:', e); }

  // 订单记录
  try {
    var orderRes = await fetchAPI(API + '/pay/orders/list' + (currentUser ? '?user_id=' + currentUser.id : ''));
    $('count-order').textContent = orderRes.data ? orderRes.data.length : 0;
    $('list-order').innerHTML = orderRes.data && orderRes.data.length > 0
      ? orderRes.data.slice(0, 10).map(function(o) {
          var stText = o.status === 'paid' ? '已支付' : (o.status === 'pending' ? '待支付' : '已关闭');
          return '<div class="mine-record">' +
            '<div class="mine-record-info">' +
              '<div class="mine-record-title">💰 ' + (o.description || '支付') + '</div>' +
              '<div class="mine-record-meta">' + fmtTime(o.createtime) + '</div>' +
            '</div>' +
            '<div class="mine-record-extra">' +
              '<div class="mine-record-amount">¥' + ((o.total_amount || 0) / 100).toFixed(2) + '</div>' +
              '<div class="mine-record-status">' + stText + '</div>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="mine-empty">暂无订单记录</div>';
  } catch(e) {}

  // 收起所有展开的区块
  document.querySelectorAll('.mine-section-content').forEach(function(el) { el.style.display = 'none'; });
  document.querySelectorAll('.mine-arrow').forEach(function(el) { el.classList.remove('open'); });
}

function fmtTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return (d.getMonth()+1) + '/' + d.getDate() + ' ' +
    String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

function toggleMineSection(type) {
  var content = $('content-' + type);
  var arrow = $('arrow-' + type);
  var isOpen = content.style.display === 'block';
  content.style.display = isOpen ? 'none' : 'block';
  if (isOpen) {
    arrow.classList.remove('open');
  } else {
    arrow.classList.add('open');
  }
}

// 个人资料编辑
function showProfileModal() {
  if (!currentUser) return showLoginModal();
  var avatar = currentUser.avatar || '🙏';
  var avatarOpts = '';
  userAvatars.forEach(function(a) {
    avatarOpts += '<div class="avatar-option' + (a === avatar ? ' active' : '') + '" onclick="selectAvatar(this,\'' + a + '\')">' + a + '</div>';
  });
  showModal(
    '<div style="position:relative">' +
      '<span class="modal-close" onclick="closeModal(event)">✕</span>' +
      '<div class="modal-title">✎ 编辑个人资料</div>' +
      '<div style="text-align:center;margin:12px 0 4px;font-size:13px;color:#999">选择头像</div>' +
      '<div class="profile-avatar-pick" id="avatar-picker">' + avatarOpts + '</div>' +
      '<input type="hidden" id="profile-avatar" value="' + avatar + '">' +
      '<div class="form-group"><label>昵称</label><input type="text" id="profile-nickname" value="' + (currentUser.nickname || '') + '" placeholder="请输入昵称"></div>' +
      '<div class="form-group"><label>手机号</label><input type="tel" id="profile-phone" value="' + (currentUser.phone || '') + '" placeholder="请输入手机号"></div>' +
      '<button class="btn-primary btn-lg btn-block" onclick="saveProfile()" style="margin-top:10px">💾 保存</button>' +
    '</div>'
  );
}

function selectAvatar(el, avatar) {
  var opts = document.querySelectorAll('.avatar-option');
  opts.forEach(function(o) { o.classList.remove('active'); });
  el.classList.add('active');
  $('profile-avatar').value = avatar;
}

async function saveProfile() {
  var nickname = $('profile-nickname').value || '善信';
  var phone = $('profile-phone').value || '';
  var avatar = $('profile-avatar').value || '🙏';
  var res = await postAPI(API + '/user/profile', {
    user_id: currentUser.id,
    nickname: nickname,
    phone: phone,
    avatar: avatar
  });
  if (res.code === 0) {
    currentUser = res.data;
    showToast('信息已更新');
    closeModal({ target: $('modal-overlay') });
    loadMine();
  } else {
    showToast(res.msg || '保存失败');
  }
}

function showLoginModal() {
  showModal(
    '<div style="position:relative">' +
      '<span class="modal-close" onclick="closeModal(event)">✕</span>' +
      '<div class="modal-title">🙏 登录 · ' + TEMPLE_NAME + '</div>' +
      '<div class="form-group"><label>您的称呼</label><input type="text" id="login-nickname" placeholder="请输入您的称呼" value="善信"></div>' +
      '<div class="form-group"><label>手机号</label><input type="tel" id="login-phone" placeholder="请输入手机号"></div>' +
      '<button class="btn-primary btn-lg btn-block" onclick="doLogin()">登录</button>' +
    '</div>'
  );
}

async function doLogin() {
  var nickname = $('login-nickname').value || '善信';
  var phone = $('login-phone').value || ('guest_' + TEMPLE_ID + '_' + Date.now());
  var res = await postAPI(API + '/user/login', { nickname, phone });
  if (res.code === 0) { currentUser = res.data; showToast('登录成功'); closeModal({ target: $('modal-overlay') }); loadMine(); }
  else showToast(res.msg || '登录失败');
}

// ============================================================
// ========== 微信支付集成 ==========
// ============================================================

// 检测当前支付环境
function detectPayEnv() {
  const ua = navigator.userAgent || '';
  if (/miniprogram/i.test(ua)) return 'miniprogram';
  if (/MicroMessenger/i.test(ua)) return 'wechat_mp';
  return 'h5';
}

const PAY_ENV = detectPayEnv();

// 获取存储的 openid
function getOpenid() {
  return localStorage.getItem('wx_openid_' + TEMPLE_ID + '_' + PAY_ENV) || '';
}

function saveOpenid(openid) {
  localStorage.setItem('wx_openid_' + TEMPLE_ID + '_' + PAY_ENV, openid);
}

// ===== 获取 openid（公众号环境） =====
async function ensureOpenid() {
  if (PAY_ENV === 'h5') return ''; // H5 不需要 openid

  var openid = getOpenid();
  if (openid) {
    console.log('[OAuth] 使用缓存的 openid:', openid.substring(0,8) + '...');
    return openid;
  }

  // 检查 URL 中是否已有 openid（OAuth 回调带回）
  var p = new URLSearchParams(window.location.search);
  openid = p.get('openid');
  if (openid) {
    console.log('[OAuth] URL 中有 openid:', openid.substring(0,8) + '...');
    saveOpenid(openid);
    // 清理 URL
    if (window.history && window.history.replaceState) {
      var cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
    return openid;
  }

  // 检查 URL 中是否有 code（微信 OAuth 回调带回）
  var code = p.get('code');
  if (code && PAY_ENV === 'wechat_mp') {
    console.log('[OAuth] 收到 code，正在换取 openid...');
    try {
      var callbackRes = await fetchAPI(API + '/pay/oauth-callback?code=' + code);
      console.log('[OAuth] oauth-callback 响应:', callbackRes);
      if (callbackRes.code === 0 && callbackRes.data && callbackRes.data.openid) {
        openid = callbackRes.data.openid;
        saveOpenid(openid);
        console.log('[OAuth] openid 获取成功:', openid.substring(0,8) + '...');
        // 清理 URL
        if (window.history && window.history.replaceState) {
          var cleanUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
        }
        return openid;
      } else {
        console.error('[OAuth] code 换 openid 失败:', callbackRes);
        return '';
      }
    } catch (e) {
      console.error('[OAuth] code 换 openid 异常:', e);
      return '';
    }
  }

  // 公众号环境：需要 OAuth 授权
  if (PAY_ENV === 'wechat_mp') {
    // 暂存当前支付意图，OAuth 返回后自动恢复
    sessionStorage.setItem('pay_pending', '1');
    try {
      var res = await fetchAPI(API + '/pay/oauth-url?redirect=' +
        encodeURIComponent(window.location.href));
      console.log('[OAuth] oauth-url 响应:', res);
      if (res.code === 0 && res.data && res.data.oauth_url) {
        window.location.href = res.data.oauth_url;
        return null; // 等待跳转
      }
    } catch (e) { console.error('OAuth error:', e); }
    sessionStorage.removeItem('pay_pending');
  }

  // 小程序环境：需要 wx.login()
  if (PAY_ENV === 'miniprogram' && typeof wx !== 'undefined') {
    return new Promise(function(resolve) {
      wx.login({
        success: async function(loginRes) {
          if (loginRes.code) {
            try {
              var r = await postAPI(API + '/pay/miniprogram/login', { code: loginRes.code });
              if (r.code === 0 && r.data.openid) {
                saveOpenid(r.data.openid);
                resolve(r.data.openid);
              } else { resolve(''); }
            } catch (e) { resolve(''); }
          } else { resolve(''); }
        },
        fail: function() { resolve(''); }
      });
    });
  }

  return '';
}

// ===== 统一支付入口 =====
async function doPay(params) {
  if (!params.amount || params.amount <= 0) {
    showToast('金额无效');
    return false;
  }

  var tradeType = PAY_ENV === 'h5' ? 'h5' : 'jsapi';
  var channel = PAY_ENV === 'miniprogram' ? 'miniprogram' : (PAY_ENV === 'wechat_mp' ? 'wechat_mp' : 'h5');
  console.log('[支付] 环境:', PAY_ENV, '交易类型:', tradeType, '渠道:', channel);

  showToast('正在发起支付...');

  try {
    var openid = '';

    if (tradeType !== 'h5') {
      openid = await ensureOpenid();
      if (openid === null) return false;
      if (!openid) {
        showToast('获取用户身份失败，请重试');
        return false;
      }
    }

    var res = await postAPI(API + '/pay/unified-order', {
      user_id: currentUser ? currentUser.id : 0,
      order_type: params.order_type,
      biz_ref_id: params.biz_ref_id || 0,
      trade_type: tradeType,
      channel: channel,
      openid: openid,
      amount: Math.round(params.amount * 100),
      description: params.description || '寺语·功德',
      extra: params.extra || {}
    });

    console.log('[支付] 下单响应:', res);

    if (res.code !== 0) {
      var errMsg = res.msg || '下单失败';
      if (errMsg.includes('未启用') || errMsg.includes('H5')) {
        showToast(errMsg + '。请用微信扫码访问以使用公众号支付。');
      } else {
        showToast(errMsg);
      }
      return false;
    }

    var data = res.data;

    if (PAY_ENV === 'h5') {
      // H5: 跳转微信支付
      var redirectUrl = window.location.origin + '/t/' + TEMPLE_SLUG + '?order_no=' + data.order_no + '&pay_done=1';
      window.location.href = data.mweb_url + '&redirect_url=' + encodeURIComponent(redirectUrl);

    } else if (PAY_ENV === 'wechat_mp') {
      // 公众号: WeixinJSBridge
      console.log('[支付] JSAPI 调起参数:', JSON.stringify({
        appId: data.appId,
        timeStamp: data.timeStamp,
        nonceStr: data.nonceStr,
        package: data.package,
        signType: data.signType
      }));

      var invokePay = function() {
        try {
          if (typeof WeixinJSBridge !== 'undefined') {
            WeixinJSBridge.invoke('getBrandWCPayRequest', {
              appId: data.appId,
              timeStamp: data.timeStamp,
              nonceStr: data.nonceStr,
              package: data.package,
              signType: data.signType,
              paySign: data.paySign
            }, function(wxRes) {
              console.log('[支付] WeixinJSBridge 回调:', JSON.stringify(wxRes));
              if (wxRes.err_msg === 'get_brand_wcpay_request:ok') {
                showToast('支付成功，功德无量！');
                pollPaymentResult(data.order_no);
              } else if (wxRes.err_msg && wxRes.err_msg.indexOf('cancel') > -1) {
                showToast('支付已取消');
              } else {
                showToast('支付失败: ' + (wxRes.err_msg || '未知错误'));
              }
            });
          } else {
            console.error('[支付] WeixinJSBridge 未定义');
            showToast('请在微信中打开此页面进行支付');
          }
        } catch (e) {
          console.error('[支付] JSAPI 调起异常:', e);
          showToast('支付异常: ' + e.message);
        }
      };

      if (typeof WeixinJSBridge === 'undefined') {
        console.log('[支付] 等待 WeixinJSBridgeReady 事件...');
        if (document.addEventListener) {
          document.addEventListener('WeixinJSBridgeReady', invokePay, false);
        }
        if (document.attachEvent) {
          document.attachEvent('WeixinJSBridgeReady', invokePay);
        }
        // 超时回退
        setTimeout(function() {
          if (typeof WeixinJSBridge === 'undefined') {
            console.error('[支付] WeixinJSBridge 加载超时');
            showToast('微信支付组件加载失败，请刷新重试');
          }
        }, 5000);
      } else {
        console.log('[支付] WeixinJSBridge 已就绪，直接调起');
        invokePay();
      }

    } else if (PAY_ENV === 'miniprogram') {
      // 小程序: wx.requestPayment
      if (typeof wx !== 'undefined' && wx.requestPayment) {
        wx.requestPayment({
          timeStamp: data.timeStamp,
          nonceStr: data.nonceStr,
          package: data.package,
          signType: data.signType,
          paySign: data.paySign,
          success: function() {
            showToast('支付成功，功德无量！');
            pollPaymentResult(data.order_no);
          },
          fail: function(err) {
            if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) {
              showToast('支付已取消');
            } else {
              showToast('支付失败');
            }
          }
        });
      } else {
        showToast('请在微信小程序内支付');
      }
    }

    return true;

  } catch (e) {
    console.error('支付异常:', e);
    showToast('支付异常，请重试');
    return false;
  }
}

// ===== 轮询支付结果 =====
function pollPaymentResult(orderNo) {
  var retries = 0;
  var maxRetries = 30;

  var timer = setInterval(async function() {
    var res = await fetchAPI(API + '/pay/order/' + orderNo);
    if (res.code === 0 && res.data.status === 'paid') {
      clearInterval(timer);
      closeModal({ target: $('modal-overlay') });
      // 刷新当前页面
      if (currentPage === 'offering') loadOffering();
      else if (currentPage === 'merit') loadMerit();
      else if (currentTab === 'shop') loadShop();
      else if (currentTab === 'home') loadHome();
    }
    retries++;
    if (retries >= maxRetries) {
      clearInterval(timer);
    }
  }, 2000);
}

// ===== 改造 submitOffering — 接入支付 =====
var _origSubmitOffering = submitOffering;
submitOffering = async function() {
  var amountEl = $('offering-amount');
  var amount = amountEl ? parseFloat(amountEl.value) : 0;
  if (!amount || amount <= 0) return showToast('请选择或输入供奉金额');

  // 先创建供奉记录
  var offeringRes = await postAPI(API + '/offering', {
    buddha_id: selectedBuddha,
    offering_type: selectedOfferingType,
    amount: amount,
    message: $('offering-message') ? $('offering-message').value : '',
    user_name: ($('offering-name') ? $('offering-name').value : '') || '善信',
    user_phone: $('offering-phone') ? $('offering-phone').value : ''
  });

  if (offeringRes.code !== 0) {
    return showToast(offeringRes.msg || '提交失败');
  }

  // 如果金额大于0，走支付
  if (amount > 0) {
    var paid = await doPay({
      order_type: 'offering',
      biz_ref_id: offeringRes.data.id,
      amount: amount,
      description: '供奉 · 功德无量',
      extra: {
        buddha_id: selectedBuddha,
        offering_type: selectedOfferingType
      }
    });
    if (!paid) return;
  }

  showToast(offeringRes.msg || '供奉成功，功德无量！');
  closeModal({ target: $('modal-overlay') });
};

// ===== 改造 submitDonation — 接入支付 =====
var _origSubmitDonation = submitDonation;
submitDonation = async function() {
  var amountEl = $('donate-amount');
  var amount = amountEl ? parseFloat(amountEl.value) : 0;
  if (!amount || amount <= 0) return showToast('请选择或输入随喜金额');

  if (amount > 0) {
    var paid = await doPay({
      order_type: 'donation',
      biz_ref_id: parseInt($('donate-project-id') ? $('donate-project-id').value : 0) || 0,
      amount: amount,
      description: '功德 · 随喜',
      extra: {
        project_id: parseInt($('donate-project-id') ? $('donate-project-id').value : 0) || 0,
        is_anonymous: $('donate-anonymous') ? $('donate-anonymous').checked : false
      }
    });
    if (paid === false) return;
    // 支付成功后记录功德
    var projectId = parseInt($('donate-project-id') ? $('donate-project-id').value : 0) || 0;
    var nameEl = $('donate-name');
    var phoneEl = $('donate-phone');
    var msgEl = $('donate-message');
    var anonEl = $('donate-anonymous');
    var donationRes = await postAPI(API + '/donate', {
      project_id: projectId,
      amount: amount,
      name: (nameEl ? nameEl.value : '') || '善信',
      phone: phoneEl ? phoneEl.value : '',
      message: msgEl ? msgEl.value : '',
      is_anonymous: anonEl ? anonEl.checked : false
    });
    showToast(donationRes.msg || '功德已记录，随喜赞叹！');
    closeModal({ target: $('modal-overlay') });
    if (currentPage === 'merit') loadMerit();
  }
};

// ===== 改造 submitBuyOrder — 接入支付 =====
var _origSubmitBuyOrder = submitBuyOrder;
submitBuyOrder = async function() {
  var itemId = parseInt($('buy-item-id').value);
  var price = parseFloat($('buy-price').value);
  var qty = parseInt($('buy-qty').value);
  var total = price * qty;

  if (total <= 0) {
    showToast('金额无效');
    return;
  }

  var paid = await doPay({
    order_type: 'shop',
    biz_ref_id: itemId,
    amount: total,
    description: '法物请购 · ¥' + total.toFixed(2),
    extra: { item_id: itemId, quantity: qty }
  });

  if (paid === false) return;

  // 创建订单记录
  var res = await postAPI(API + '/order/create', {
    user_id: currentUser ? currentUser.id : 0,
    items: [{ name: '法物', price: price, quantity: qty }],
    total_amount: total
  });

  if (res.code === 0) {
    showToast('结缘成功，功德无量！');
    closeModal({ target: $('modal-overlay') });
  } else {
    showToast(res.msg || '创建订单失败');
  }
};

// ===== Init =====
async function init() {
  loadHome();
  var res = await postAPI(API + '/user/login', { nickname: '善信', phone: 'guest_' + TEMPLE_ID + '_' + Date.now() });
  if (res.code === 0) currentUser = res.data;

  // 自动处理 OAuth 回调：code → openid（不主动跳转）
  if (PAY_ENV === 'wechat_mp') {
    var qp = new URLSearchParams(window.location.search);
    var hasCode = qp.get('code');
    var hasOpenid = qp.get('openid');
    if (hasCode || hasOpenid) {
      await ensureOpenid();
      // 如果有暂存的支付标记，说明是从 OAuth 返回
      if (sessionStorage.getItem('pay_pending') === '1') {
        sessionStorage.removeItem('pay_pending');
        showToast('授权成功，请重新点击支付按钮');
      }
    }
  }

  // 检查URL参数：自动打开佛像详情或殿堂（扫码进入）
  (function() {
    var q = new URLSearchParams(window.location.search);
    var buddhaId = q.get('buddha');
    var hallId = q.get('hall');
    if (buddhaId) {
      setTimeout(function() { navigateToBuddha(parseInt(buddhaId)); }, 500);
    }
    if (hallId) {
      setTimeout(function() {
        navigateTo('tour');
        loadTour().then(function() {
          // 加载区域数据并找到对应的大殿
          fetchAPI(API + '/areas').then(function(res) {
            if (res.code === 0) {
              var areas = res.data || [];
              for (var i = 0; i < areas.length; i++) {
                var hall = (areas[i].halls || []).find(function(h) { return h.id == hallId; });
                if (hall) {
                  showTourDetail(hall.id, hall.name, areas[i].name, hall.desc || '', hall.image || '');
                  break;
                }
              }
            }
          });
        });
      }, 800);
    }
  })();

  // 检查支付返回参数
  var p = new URLSearchParams(window.location.search);
  if (p.get('pay_done') === '1') {
    var orderNo = p.get('order_no');
    if (orderNo) {
      showToast('支付处理中，请稍候...');
      pollPaymentResult(orderNo);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);

// Back button to platform home
window.addEventListener('pageshow', function() {
  if (window.TEMPLE_ID) document.title = TEMPLE_NAME + ' · 寺语';
});
