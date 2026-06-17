const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ====== 加载 .env 环境变量 ======
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const app = express();
app.set('trust proxy', 1);
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PLATFORM_FILE = path.join(DATA_DIR, 'platform.json');
const TEMPLES_DIR = path.join(DATA_DIR, 'temples');

// 加载支付模块（环境变量加载后）
const WxPayCore = require('./lib/wxpay-core');
const wxpayCrypto = require('./lib/wxpay-crypto');
const { reconcileDay } = require('./lib/wxpay-reconciliation');

// Middleware
app.use(cors());
// 保留 raw body 用于微信回调验签
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/pay/notify')) {
      req.rawBody = buf.toString('utf-8');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));
// Static file caching: images 7 days, CSS/JS 1 day
var staticCache = function(maxAge) {
  return { maxAge: maxAge, setHeaders: function(res) { res.setHeader('Cache-Control', 'public, max-age=' + maxAge/1000 + ', immutable'); } };
};
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticCache(7 * 24 * 3600 * 1000)));
// Miniprogram static assets
app.use('/css', express.static(path.join(__dirname, 'miniprogram', 'css'), staticCache(24 * 3600 * 1000)));
app.use('/js', express.static(path.join(__dirname, 'miniprogram', 'js'), staticCache(24 * 3600 * 1000)));
app.use('/images', express.static(path.join(__dirname, 'miniprogram', 'images'), staticCache(7 * 24 * 3600 * 1000)));
app.use('/public', express.static(path.join(__dirname, 'public'), staticCache(24 * 3600 * 1000)));

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '_' + Math.random().toString(36).substr(2, 9) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ========== Data Helpers ==========
function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch (e) { return null; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
function readPlatform() { return readJSON(PLATFORM_FILE); }
function writePlatform(data) { writeJSON(PLATFORM_FILE, data); }
function readTemple(id) { return readJSON(path.join(TEMPLES_DIR, id + '.json')); }
function writeTemple(id, data) { writeJSON(path.join(TEMPLES_DIR, id + '.json'), data); }

function templeNextId(templeId, key) {
  const data = readTemple(templeId);
  if (!data) return 0;
  if (!data.nextId[key]) data.nextId[key] = 0;
  data.nextId[key]++;
  writeTemple(templeId, data);
  return data.nextId[key];
}
function platformNextId(key) {
  const p = readPlatform();
  if (!p.nextId[key]) p.nextId[key] = 0;
  p.nextId[key]++;
  writePlatform(p);
  return p.nextId[key];
}

function findTempleBySlug(slug) {
  const p = readPlatform();
  return p.temples.find(t => t.slug === slug);
}
function findTempleById(id) {
  const p = readPlatform();
  return p.temples.find(t => t.id == id);
}

// Ensure data dirs exist
function initData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TEMPLES_DIR)) fs.mkdirSync(TEMPLES_DIR, { recursive: true });
  if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));
}
initData();

// ========== Temple Auth Middleware ==========
function templeAuth(req, res, next) {
  const templeId = parseInt(req.params.templeId);
  const p = readPlatform();
  const temple = p.temples.find(t => t.id === templeId);
  if (!temple) return res.json({ code: 1, msg: '寺庙不存在' });
  if (temple.status !== 'active') return res.json({ code: 1, msg: '该寺庙已停用' });
  req.templeInfo = temple;
  req.templeId = templeId;
  next();
}

// ========== Static Pages ==========

// Landing page - temple selection
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Temple frontend page
app.get('/t/:slug', (req, res) => {
  const temple = findTempleBySlug(req.params.slug);
  if (!temple || temple.status !== 'active') {
    return res.status(404).send('<h1 style="text-align:center;margin-top:100px">寺庙不存在或已停用</h1>');
  }
  // Serve the miniprogram with temple context
  const BUILD_VER = '2026061501';
  let html = fs.readFileSync(path.join(__dirname, 'miniprogram', 'index.html'), 'utf-8');
  html = html.replace('</head>',
    `<script>window.TEMPLE_ID=${temple.id};window.TEMPLE_SLUG="${temple.slug}";window.TEMPLE_NAME="${temple.name}";</script></head>`);
  // Cache busting for CSS/JS
  html = html.replace('css/style.css', 'css/style.css?v=' + BUILD_VER);
  html = html.replace('js/app.js', 'js/app.js?v=' + BUILD_VER);
  res.send(html);
});



// Admin pages
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'admin', 'platform.html'));
});
app.get('/admin/test-pay', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'test-pay.html')));
app.get('/admin/test', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'test.html')));
app.get('/admin/test', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'test.html')));
app.get('/admin/:slug', (req, res) => {
  const temple = findTempleBySlug(req.params.slug);
  if (!temple) return res.status(404).send('寺庙不存在');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  let html = fs.readFileSync(path.join(__dirname, 'admin', 'temple.html'), 'utf-8');
  const VER = '2026061503';
  html = html.replace('</head>',
    `<meta http-equiv="Cache-Control" content="no-cache"><meta http-equiv="Pragma" content="no-cache">` +
    `<script>window.ADMIN_TEMPLE_ID=${temple.id};window.ADMIN_TEMPLE_SLUG="${temple.slug}";window.ADMIN_TEMPLE_NAME="${temple.name}";window._VER="${VER}";</script></head>`);
  res.send(html);
});

// Kiosk / big screen display
app.get('/screen/:slug', (req, res) => {
  const temple = findTempleBySlug(req.params.slug);
  if (!temple || temple.status !== 'active') {
    return res.status(404).send('寺庙不存在');
  }
  let html = fs.readFileSync(path.join(__dirname, 'public', 'screen.html'), 'utf-8');
  html = html.replace('TEMPLE_ID = 1', `TEMPLE_ID = ${temple.id}`);
  html = html.replace('TEMPLE_SLUG = \'dajue\'', `TEMPLE_SLUG = '${temple.slug}'`);
  html = html.replace('TEMPLE_NAME = \'寺语\'', `TEMPLE_NAME = '${temple.name}'`);
  res.send(html);
});

// ========== Platform API (寺语总管理) ==========

// Platform login
app.post('/api/platform/login', (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash('md5').update(password || '').digest('hex');
  const p = readPlatform();
  const admin = p.super_admins.find(a => a.username === username && a.password === hash);
  if (admin) {
    res.json({ code: 0, data: { token: 'plat_' + Date.now(), username: admin.username, nickname: admin.nickname, role: 'super_admin' }, msg: '登录成功' });
  } else {
    res.json({ code: 1, msg: '用户名或密码错误' });
  }
});

// Get all temples (platform)
app.get('/api/platform/temples', (req, res) => {
  const p = readPlatform();
  res.json({ code: 0, data: p.temples.map(t => ({ ...t, admin_password: undefined })) });
});

// Create temple
app.post('/api/platform/temple', (req, res) => {
  const { name, slug, slogan, province, city, address, phone, contact_person, admin_username, admin_password } = req.body;
  const p = readPlatform();
  if (p.temples.find(t => t.slug === slug)) return res.json({ code: 1, msg: '标识已被使用' });
  const newTemple = {
    id: platformNextId('temple'),
    slug,
    name,
    slogan: slogan || '',
    province: province || '',
    city: city || '',
    address: address || '',
    phone: phone || '',
    contact_person: contact_person || '',
    status: 'active',
    admin_username: admin_username || slug,
    admin_password: crypto.createHash('md5').update(admin_password || '123456').digest('hex'),
    createtime: Date.now(),
    updatetime: Date.now()
  };
  p.temples.push(newTemple);
  writePlatform(p);
  // Initialize temple data file
  const defaultTempleData = {
    nextId: { buddha: 0, offering_record: 0, tablet: 0, prayer: 0, release: 0, donation: 0, activity: 0, activity_reg: 0, shop_item: 0, order: 0, cart: 0, user: 0, announcement: 0, tour_spot: 0, area: 0, hall: 0, media: 0 },
    temple: { name, slogan: slogan || '', intro: '', address: address || '', phone: phone || '', open_time: '06:00 - 18:00', banner: [] },
    buddhas: [], offering_types: [], offering_records: [],     tablets: [], prayers: [],
    tablet_config: [
      { id: 1, type: 'ancestor', name: '往生牌位', price: 100, duration: '一年' },
      { id: 2, type: 'living', name: '延生牌位', price: 100, duration: '一年' }
    ],
    releases: [], release_records: [], merit_projects: [], donations: [], merit_rank: [],
    activities: [], activity_registrations: [], shop_items: [], carts: [], orders: [], users: [], announcements: [], tour_spots: [], areas: [], media: []
  };
  writeTemple(newTemple.id, defaultTempleData);
  res.json({ code: 0, data: { ...newTemple, admin_password: undefined }, msg: '寺庙创建成功' });
});

// Update temple config
app.put('/api/platform/temple/:id', (req, res) => {
  const p = readPlatform();
  const idx = p.temples.findIndex(t => t.id == req.params.id);
  if (idx < 0) return res.json({ code: 1, msg: '寺庙不存在' });
  const { name, slogan, province, city, address, phone, contact_person, status, admin_username, admin_password } = req.body;
  if (name) p.temples[idx].name = name;
  if (slogan !== undefined) p.temples[idx].slogan = slogan;
  if (province) p.temples[idx].province = province;
  if (city) p.temples[idx].city = city;
  if (address) p.temples[idx].address = address;
  if (phone) p.temples[idx].phone = phone;
  if (contact_person) p.temples[idx].contact_person = contact_person;
  if (status) p.temples[idx].status = status;
  if (admin_username) p.temples[idx].admin_username = admin_username;
  if (admin_password) p.temples[idx].admin_password = crypto.createHash('md5').update(admin_password).digest('hex');
  p.temples[idx].updatetime = Date.now();
  writePlatform(p);
  // Sync name to temple data
  const td = readTemple(req.params.id);
  if (td) {
    if (name) td.temple.name = name;
    if (slogan !== undefined) td.temple.slogan = slogan;
    if (address) td.temple.address = address;
    if (phone) td.temple.phone = phone;
    writeTemple(req.params.id, td);
  }
  res.json({ code: 0, msg: '更新成功' });
});

// Platform config
app.get('/api/platform/config', (req, res) => {
  const p = readPlatform();
  res.json({ code: 0, data: p.config });
});

app.get('/api/platform/ai/tts-config', (req, res) => {
  const p = readPlatform();
  res.json({ code: 0, data: p.config.ai_tts || { enabled: true, provider: 'web-speech', voice: 'zh-CN', speed: 1, pitch: 1 } });
});

app.put('/api/platform/ai/tts-config', (req, res) => {
  const p = readPlatform();
  p.config.ai_tts = { ...(p.config.ai_tts || {}), ...req.body };
  writePlatform(p);
  res.json({ code: 0, msg: 'AI TTS 设置已保存' });
});

// TTS test (for admin preview)
app.post('/api/platform/tts/test', async (req, res) => {
  await synthesizeTTS(req.body.text || '欢迎使用寺语智慧寺院管理平台，语音讲解功能已就绪。', res, true);
});

// Tencent Cloud TTS synthesis (proxy)
app.post('/api/platform/tts/synthesize', async (req, res) => {
  await synthesizeTTS(req.body.text, res, false);
});

async function synthesizeTTS(text, res, isTest) {
  try {
    if (!text) return res.json({ code: 1, msg: '缺少文本' });
    const p = readPlatform();
    const tts = p.config.ai_tts || {};
    const provider = tts.provider || 'web-speech';
    if (provider === 'web-speech') {
      return res.json({ code: 1, msg: '当前使用浏览器内置引擎，请切换到腾讯云 TTS 后试听' });
    }
    const { secretId, secretKey, appId } = tts;
    if (!secretId || !secretKey || !appId) return res.json({ code: 1, msg: '腾讯云 TTS 密钥未配置' });

    const service = 'tts';
    const host = 'tts.tencentcloudapi.com';
    const action = 'TextToVoice';
    const version = '2019-08-23';
    const region = tts.region || 'ap-guangzhou';
    const voiceType = tts.voice || 101001;
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    const payload = JSON.stringify({
      Text: text,
      SessionId: crypto.randomBytes(8).toString('hex'),
      VoiceType: voiceType,
      PrimaryLanguage: 1,
      Codec: 'mp3',
      Volume: tts.volume || 5,
      Speed: tts.speed || 0
    });

    // TC3-HMAC-SHA256 signing
    const canonicalRequest = [
      'POST', '/', '',
      `content-type:application/json`,
      `host:${host}`,
      '', 'content-type;host', crypto.createHash('sha256').update(payload).digest('hex')
    ].join('\n');
    const stringToSign = [
      'TC3-HMAC-SHA256', timestamp,
      `${date}/${service}/tc3_request`,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');
    const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
    const kService = crypto.createHmac('sha256', kDate).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`;

    const response = await fetch(`https://${host}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': region,
        'Authorization': authorization
      },
      body: payload
    });
    const data = await response.json();
    if (data.Response && data.Response.Audio) {
      res.json({ code: 0, data: { audio: data.Response.Audio, sessionId: data.Response.SessionId } });
    } else {
      res.json({ code: 1, msg: data.Response?.Error?.Message || 'TTS 合成失败' });
    }
  } catch (e) {
    res.json({ code: 1, msg: 'TTS 服务异常: ' + e.message });
  }
}

app.put('/api/platform/config', (req, res) => {
  const p = readPlatform();
  p.config = { ...p.config, ...req.body };
  writePlatform(p);
  res.json({ code: 0, msg: '配置更新成功' });
});

// Platform: channel config
app.get('/api/platform/channels', (req, res) => {
  const p = readPlatform();
  res.json({ code: 0, data: p.config.channels || { h5: {}, wechat_mp: {}, miniprogram: {} } });
});

app.put('/api/platform/channels', (req, res) => {
  const p = readPlatform();
  p.config.channels = { ...(p.config.channels || {}), ...req.body };
  writePlatform(p);
  res.json({ code: 0, msg: '渠道配置更新成功' });
});

// Platform: payment config
app.get('/api/platform/payment', (req, res) => {
  const p = readPlatform();
  res.json({ code: 0, data: p.config.payment || { wechat_pay: {} } });
});

app.put('/api/platform/payment', (req, res) => {
  const p = readPlatform();
  p.config.payment = { ...(p.config.payment || {}), ...req.body };
  writePlatform(p);
  res.json({ code: 0, msg: '支付配置更新成功' });
});

// Admin management
app.get('/api/platform/admins', (req, res) => {
  const p = readPlatform();
  res.json({ code: 0, data: p.super_admins.map(a => ({ ...a, password: undefined })) });
});

app.post('/api/platform/admin', (req, res) => {
  const p = readPlatform();
  const { username, password, nickname } = req.body;
  if (p.super_admins.find(a => a.username === username)) return res.json({ code: 1, msg: '用户名已存在' });
  const admin = {
    id: (p.super_admins.length ? Math.max(...p.super_admins.map(a => a.id)) : 0) + 1,
    username,
    password: crypto.createHash('md5').update(password || '123456').digest('hex'),
    nickname: nickname || username,
    role: 'super_admin',
    createtime: Date.now()
  };
  p.super_admins.push(admin);
  writePlatform(p);
  res.json({ code: 0, msg: '管理员创建成功' });
});

app.put('/api/platform/admin/:id', (req, res) => {
  const p = readPlatform();
  const idx = p.super_admins.findIndex(a => a.id == req.params.id);
  if (idx < 0) return res.json({ code: 1, msg: '管理员不存在' });
  const { username, password, nickname } = req.body;
  if (username && p.super_admins.find(a => a.username === username && a.id != req.params.id)) return res.json({ code: 1, msg: '用户名已存在' });
  if (username) p.super_admins[idx].username = username;
  if (nickname) p.super_admins[idx].nickname = nickname;
  if (password) p.super_admins[idx].password = crypto.createHash('md5').update(password).digest('hex');
  writePlatform(p);
  res.json({ code: 0, msg: '更新成功' });
});

app.delete('/api/platform/admin/:id', (req, res) => {
  const p = readPlatform();
  if (p.super_admins.length <= 1) return res.json({ code: 1, msg: '至少保留一名管理员' });
  p.super_admins = p.super_admins.filter(a => a.id != req.params.id);
  writePlatform(p);
  res.json({ code: 0, msg: '删除成功' });
});

// Storage connection test
app.post('/api/platform/storage/test', (req, res) => {
  const { type, cos_bucket, cos_region, cos_secret_id, cos_secret_key } = req.body;
  if (type === 'local') {
    const uploadDir = path.join(__dirname, 'uploads');
    try {
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const testFile = path.join(uploadDir, '.test_' + Date.now());
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      res.json({ code: 0, msg: '连接成功！本地存储目录可正常读写。' });
    } catch (e) {
      res.json({ code: 1, msg: '连接失败：无法写入存储目录，请检查权限。' });
    }
  } else if (type === 'cos') {
    if (!cos_bucket || !cos_region || !cos_secret_id || !cos_secret_key) {
      return res.json({ code: 1, msg: '连接失败：COS 配置不完整，请填写所有必填项。' });
    }
    // In production, this would actually test the COS connection
    // For now, validate config completeness
    res.json({ code: 0, msg: `COS 配置验证通过！Bucket: ${cos_bucket}，Region: ${cos_region}。请在部署环境验证实际连接。` });
  } else {
    res.json({ code: 1, msg: '未知存储类型' });
  }
});

// Cross-temple statistics (platform)
app.get('/api/platform/stats', (req, res) => {
  const p = readPlatform();
  let totalOfferings = 0, totalTablets = 0, totalPrayers = 0, totalReleases = 0;
  let totalDonations = 0, totalDonationAmount = 0, totalOrders = 0, totalOrderAmount = 0, totalUsers = 0;

  p.temples.forEach(t => {
    const td = readTemple(t.id);
    if (!td) return;
    totalOfferings += td.offering_records.length;
    totalTablets += td.tablets.length;
    totalPrayers += td.prayers.length;
    totalReleases += td.release_records.length;
    totalDonations += td.donations.length;
    totalDonationAmount += td.donations.reduce((s, d) => s + d.amount, 0);
    totalOrders += td.orders.length;
    totalOrderAmount += td.orders.reduce((s, o) => s + (o.total_amount || 0), 0);
    totalUsers += td.users.length;
  });

  res.json({ code: 0, data: {
    temple_count: p.temples.length,
    active_temples: p.temples.filter(t => t.status === 'active').length,
    total_offerings: totalOfferings,
    total_tablets: totalTablets,
    total_prayers: totalPrayers,
    total_releases: totalReleases,
    total_donations: totalDonations,
    donation_amount: totalDonationAmount,
    total_orders: totalOrders,
    order_amount: totalOrderAmount,
    total_users: totalUsers,
    temples_detail: p.temples.map(t => {
      const td = readTemple(t.id);
      return {
        id: t.id, name: t.name, slug: t.slug, status: t.status,
        offerings: td ? td.offering_records.length : 0,
        donations: td ? td.donations.length : 0,
        users: td ? td.users.length : 0,
        orders: td ? td.orders.length : 0
      };
    })
  }});
});

// ========== Temple Admin Auth ==========
function templeAdminAuth(req, res, next) {
  const templeId = parseInt(req.params.templeId);
  const p = readPlatform();
  const temple = p.temples.find(t => t.id === templeId);
  if (!temple) return res.json({ code: 1, msg: '寺庙不存在' });
  req.templeInfo = temple;
  req.templeId = templeId;
  next();
}

// Temple admin login
app.post('/api/temple/:templeId/admin/login', templeAdminAuth, (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash('md5').update(password || '').digest('hex');
  const temple = req.templeInfo;
  if (username === temple.admin_username && hash === temple.admin_password) {
    res.json({ code: 0, data: { token: 'temple_' + temple.id + '_' + Date.now(), temple_id: temple.id, temple_name: temple.name, role: 'temple_admin' }, msg: '登录成功' });
  } else {
    res.json({ code: 1, msg: '用户名或密码错误' });
  }
});

// Temple admin stats
app.get('/api/temple/:templeId/admin/stats', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  if (!data) return res.json({ code: 1, msg: '数据错误' });
  res.json({ code: 0, data: {
    total_offerings: data.offering_records.length,
    total_tablets: data.tablets.length,
    total_prayers: data.prayers.length,
    total_releases: data.release_records.length,
    total_donations: data.donations.length,
    donation_amount: data.donations.reduce((s, d) => s + d.amount, 0),
    total_orders: data.orders.length,
    order_amount: data.orders.reduce((s, o) => s + (o.total_amount || 0), 0),
    total_users: data.users.length
  }});
});

// ========== Temple Business APIs (数据隔离) ==========

// Temple info (for home page header)
app.get('/api/temple/:templeId/info', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: {
    ...data.temple,
    offering_records: data.offering_records || [],
    tablets: data.tablets || [],
    prayers: data.prayers || [],
    releases: data.releases || [],
    merit_records: data.merit_records || [],
  }});
});

// Buddhas
app.get('/api/temple/:templeId/buddhas', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.buddhas });
});

// Offering types
app.get('/api/temple/:templeId/offering-types', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.offering_types });
});

// Submit offering
app.post('/api/temple/:templeId/offering', templeAuth, (req, res) => {
  const { buddha_id, offering_type, amount, message, user_name, user_phone } = req.body;
  const data = readTemple(req.templeId);
  const record = {
    id: templeNextId(req.templeId, 'offering_record'),
    buddha_id, offering_type,
    amount: parseFloat(amount) || 0,
    message: message || '',
    user_name: user_name || '善信',
    user_phone: user_phone || '',
    createtime: Date.now()
  };
  data.offering_records.push(record);
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: record, msg: '供奉成功，功德无量！' });
});

// Tablet configs (public - for frontend)
app.get('/api/temple/:templeId/tablet-configs', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  if (!data.tablet_config) data.tablet_config = [];
  res.json({ code: 0, data: data.tablet_config });
});

// Tablet configs management (admin)
app.get('/api/temple/:templeId/admin/tablet-configs', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  if (!data.tablet_config) data.tablet_config = [];
  res.json({ code: 0, data: data.tablet_config });
});

app.post('/api/temple/:templeId/admin/tablet-config', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  if (!data.tablet_config) data.tablet_config = [];
  const { id, name, type, price, duration } = req.body;
  if (id) {
    const idx = data.tablet_config.findIndex(t => t.id == id);
    if (idx >= 0) {
      data.tablet_config[idx] = { ...data.tablet_config[idx], name, type, price: parseFloat(price) || 0, duration: duration || '一年' };
    }
  } else {
    data.tablet_config.push({
      id: (data.tablet_config.length > 0 ? Math.max(...data.tablet_config.map(t => t.id)) : 0) + 1,
      name: name || '牌位',
      type: type || 'ancestor',
      price: parseFloat(price) || 100,
      duration: duration || '一年'
    });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '保存成功', data: data.tablet_config });
});

app.post('/api/temple/:templeId/admin/tablet-config/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.tablet_config = (data.tablet_config || []).filter(t => t.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '已删除' });
});

// Tablets
app.get('/api/temple/:templeId/tablets', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.tablets });
});

app.post('/api/temple/:templeId/tablet', templeAuth, (req, res) => {
  const { type, deceased_name, sponsor_name, sponsor_phone, date, message, amount } = req.body;
  const data = readTemple(req.templeId);
  const record = {
    id: templeNextId(req.templeId, 'tablet'),
    type, deceased_name, sponsor_name,
    sponsor_phone: sponsor_phone || '',
    date: date || '', message: message || '',
    amount: parseFloat(amount) || 0,
    status: 'active', createtime: Date.now()
  };
  data.tablets.push(record);
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: record, msg: '牌位登记成功！' });
});

// Prayers
app.get('/api/temple/:templeId/prayers', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.prayers });
});

app.post('/api/temple/:templeId/prayer', templeAuth, (req, res) => {
  const { name, content, type } = req.body;
  const data = readTemple(req.templeId);
  const record = {
    id: templeNextId(req.templeId, 'prayer'),
    name: name || '善信', content,
    type: type || 'lamp', createtime: Date.now()
  };
  data.prayers.push(record);
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: record, msg: '心愿已放飞，愿所求皆如愿！' });
});

// Admin: prayers
app.get('/api/temple/:templeId/admin/prayers', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.prayers || [] });
});

app.post('/api/temple/:templeId/admin/prayer/update', templeAdminAuth, (req, res) => {
  const { id, name, content, type } = req.body;
  const data = readTemple(req.templeId);
  const idx = (data.prayers || []).findIndex(p => p.id == id);
  if (idx < 0) return res.json({ code: 1, msg: '祈愿不存在' });
  if (name !== undefined) data.prayers[idx].name = name;
  if (content !== undefined) data.prayers[idx].content = content;
  if (type !== undefined) data.prayers[idx].type = type;
  data.prayers[idx].updatetime = Date.now();
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '更新成功' });
});

app.post('/api/temple/:templeId/admin/prayer/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.prayers = (data.prayers || []).filter(p => p.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

// Releases
app.get('/api/temple/:templeId/releases', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.releases });
});

app.post('/api/temple/:templeId/release', templeAuth, (req, res) => {
  const { animal_id, quantity, amount, name, phone, dedication } = req.body;
  const data = readTemple(req.templeId);
  const animal = data.releases.find(r => r.id == animal_id);
  const record = {
    id: templeNextId(req.templeId, 'release'),
    animal_id,
    animal_name: animal ? animal.name : '未知',
    quantity: parseInt(quantity) || 1,
    amount: parseFloat(amount) || 0,
    name: name || '善信',
    phone: phone || '',
    dedication: dedication || '愿以此功德，普及于一切',
    createtime: Date.now()
  };
  data.release_records.push(record);
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: record, msg: '放生功德已记录，随喜赞叹！' });
});

// Merit projects
app.get('/api/temple/:templeId/merit-projects', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.merit_projects });
});

app.get('/api/temple/:templeId/merit-rank', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.merit_rank });
});

app.post('/api/temple/:templeId/donate', templeAuth, (req, res) => {
  const { project_id, amount, name, phone, message, is_anonymous } = req.body;
  const data = readTemple(req.templeId);
  const project = data.merit_projects.find(p => p.id == project_id);
  const record = {
    id: templeNextId(req.templeId, 'donation'),
    project_id,
    project_name: project ? project.name : '',
    amount: parseFloat(amount) || 0,
    name: is_anonymous ? '匿名善信' : (name || '善信'),
    phone: phone || '',
    message: message || '',
    is_anonymous: !!is_anonymous,
    createtime: Date.now()
  };
  data.donations.push(record);
  if (project) project.current += parseFloat(amount) || 0;
  const displayName = is_anonymous ? '匿***' : (name || '善信').substr(0, 1) + '**';
  data.merit_rank.unshift({ name: displayName, amount: parseFloat(amount), project: project ? project.name : '' });
  data.merit_rank = data.merit_rank.slice(0, 20);
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: record, msg: '功德已记录，随喜赞叹您的善行！' });
});

// Activities
app.get('/api/temple/:templeId/activities', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.activities });
});

app.post('/api/temple/:templeId/activity/register', templeAuth, (req, res) => {
  const { activity_id, name, phone, num_people } = req.body;
  const data = readTemple(req.templeId);
  const activity = data.activities.find(a => a.id == activity_id);
  if (!activity) return res.json({ code: 1, msg: '活动不存在' });
  if (activity.participants >= activity.max_participants) return res.json({ code: 1, msg: '报名已满' });
  const reg = {
    id: templeNextId(req.templeId, 'activity_reg'),
    activity_id,
    name: name || '善信',
    phone: phone || '',
    num_people: parseInt(num_people) || 1,
    createtime: Date.now()
  };
  data.activity_registrations.push(reg);
  activity.participants += parseInt(num_people) || 1;
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: reg, msg: '报名成功！' });
});

// Shop
app.get('/api/temple/:templeId/shop/items', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  let items = data.shop_items;
  if (req.query.category) items = items.filter(i => i.category === req.query.category);
  res.json({ code: 0, data: items });
});

app.post('/api/temple/:templeId/cart/add', templeAuth, (req, res) => {
  const { user_id, item_id, quantity } = req.body;
  const data = readTemple(req.templeId);
  const item = data.shop_items.find(i => i.id == item_id);
  if (!item) return res.json({ code: 1, msg: '商品不存在' });
  let cartItem = data.carts.find(c => c.user_id == user_id && c.item_id == item_id);
  if (cartItem) {
    cartItem.quantity += parseInt(quantity) || 1;
  } else {
    data.carts.push({
      id: templeNextId(req.templeId, 'cart'),
      user_id: user_id || 0,
      item_id, item_name: item.name, item_image: item.image,
      price: item.price, quantity: parseInt(quantity) || 1
    });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '已加入购物车' });
});

app.get('/api/temple/:templeId/cart', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const items = data.carts.filter(c => c.user_id == (parseInt(req.query.user_id) || 0));
  res.json({ code: 0, data: items });
});

app.post('/api/temple/:templeId/cart/update', templeAuth, (req, res) => {
  const { cart_id, quantity } = req.body;
  const data = readTemple(req.templeId);
  const item = data.carts.find(c => c.id == cart_id);
  if (!item) return res.json({ code: 1, msg: '购物车项不存在' });
  if (quantity <= 0) data.carts = data.carts.filter(c => c.id != cart_id);
  else item.quantity = quantity;
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '更新成功' });
});

app.post('/api/temple/:templeId/cart/clear', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.carts = data.carts.filter(c => c.user_id != (parseInt(req.body.user_id) || 0));
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '购物车已清空' });
});

app.post('/api/temple/:templeId/order/create', templeAuth, (req, res) => {
  const { user_id, items, total_amount } = req.body;
  const data = readTemple(req.templeId);
  const order = {
    id: templeNextId(req.templeId, 'order'),
    order_no: 'ORD' + Date.now() + Math.random().toString(36).substr(2, 6).toUpperCase(),
    user_id: user_id || 0,
    items,
    total_amount: parseFloat(total_amount) || 0,
    status: 'pending',
    createtime: Date.now()
  };
  data.orders.push(order);
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: order, msg: '订单创建成功' });
});

// User login (per temple)
app.post('/api/temple/:templeId/user/login', templeAuth, (req, res) => {
  const { nickname, phone } = req.body;
  const data = readTemple(req.templeId);
  let user = data.users.find(u => u.phone === phone);
  if (!user) {
    user = {
      id: templeNextId(req.templeId, 'user'),
      nickname: nickname || '善信',
      phone: phone || '',
      avatar: '', merit: 0,
      createtime: Date.now()
    };
    data.users.push(user);
    writeTemple(req.templeId, data);
  }
  res.json({ code: 0, data: user, msg: '登录成功' });
});

// User profile update
app.post('/api/temple/:templeId/user/profile', templeAuth, (req, res) => {
  const { user_id, nickname, phone, avatar } = req.body;
  if (!user_id) return res.json({ code: 1, msg: '缺少用户ID' });
  const data = readTemple(req.templeId);
  const user = data.users.find(u => u.id == user_id);
  if (!user) return res.json({ code: 1, msg: '用户不存在' });
  if (nickname !== undefined) user.nickname = nickname;
  if (phone !== undefined) user.phone = phone;
  if (avatar !== undefined) user.avatar = avatar;
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: user, msg: '信息已更新' });
});

// Announcements
app.get('/api/temple/:templeId/announcements', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.announcements });
});

// ========== Temple Admin Management APIs ==========

// Admin: update temple info
app.post('/api/temple/:templeId/admin/temple', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.temple = { ...data.temple, ...req.body };
  writeTemple(req.templeId, data);
  // Sync to platform
  const p = readPlatform();
  const t = p.temples.find(t => t.id == req.templeId);
  if (t) {
    if (req.body.name) t.name = req.body.name;
    if (req.body.slogan !== undefined) t.slogan = req.body.slogan;
    if (req.body.address) t.address = req.body.address;
    if (req.body.phone) t.phone = req.body.phone;
    t.updatetime = Date.now();
    writePlatform(p);
  }
  res.json({ code: 0, msg: '更新成功' });
});

// Admin: manage buddhas
app.post('/api/temple/:templeId/admin/buddha', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, name, hall, image, images, intro, description, video, location, offering_price, sort } = req.body;
  const imagesArr = images || (image ? [image] : []);
  if (id) {
    const idx = data.buddhas.findIndex(b => b.id == id);
    if (idx >= 0) {
      if (name) data.buddhas[idx].name = name;
      if (hall !== undefined) data.buddhas[idx].hall = hall;
      if (description !== undefined) data.buddhas[idx].description = description;
      data.buddhas[idx].images = imagesArr;
      data.buddhas[idx].image = imagesArr[0] || '';
      if (intro !== undefined) data.buddhas[idx].intro = intro;
      if (video !== undefined) data.buddhas[idx].video = video;
      if (location !== undefined) data.buddhas[idx].location = location;
      if (offering_price) data.buddhas[idx].offering_price = offering_price;
      if (sort !== undefined) data.buddhas[idx].sort = sort;
    }
  } else {
    data.buddhas.push({
      id: templeNextId(req.templeId, 'buddha'), name,
      hall: hall || '', images: imagesArr, image: imagesArr[0] || '',
      intro: intro || '', description: description || '',
      video: video || '', location: location || '',
      offering_price: offering_price || [10, 50, 100, 200], sort: sort || 0
    });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

app.post('/api/temple/:templeId/admin/buddha/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.buddhas = data.buddhas.filter(b => b.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

// Admin: announcements
app.post('/api/temple/:templeId/admin/announcement', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, ...rest } = req.body;
  if (id) {
    const idx = data.announcements.findIndex(a => a.id == id);
    if (idx >= 0) data.announcements[idx] = { ...data.announcements[idx], ...rest };
  } else {
    data.announcements.push({ id: templeNextId(req.templeId, 'announcement'), ...rest });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

app.post('/api/temple/:templeId/admin/announcement/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.announcements = data.announcements.filter(a => a.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

// Admin: activities
app.post('/api/temple/:templeId/admin/activity', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, ...rest } = req.body;
  if (id) {
    const idx = data.activities.findIndex(a => a.id == id);
    if (idx >= 0) data.activities[idx] = { ...data.activities[idx], ...rest };
  } else {
    data.activities.push({ id: templeNextId(req.templeId, 'activity'), participants: 0, max_participants: 100, ...rest });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

app.post('/api/temple/:templeId/admin/activity/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.activities = (data.activities || []).filter(a => a.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

// Admin: shop items
app.post('/api/temple/:templeId/admin/shop-item', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, ...rest } = req.body;
  if (id) {
    const idx = data.shop_items.findIndex(s => s.id == id);
    if (idx >= 0) data.shop_items[idx] = { ...data.shop_items[idx], ...rest };
  } else {
    data.shop_items.push({ id: templeNextId(req.templeId, 'shop_item'), ...rest });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

// Admin: merit projects
app.post('/api/temple/:templeId/admin/merit-project', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, ...rest } = req.body;
  if (id) {
    const idx = data.merit_projects.findIndex(m => m.id == id);
    if (idx >= 0) data.merit_projects[idx] = { ...data.merit_projects[idx], ...rest };
  } else {
    data.merit_projects.push({ id: templeNextId(req.templeId, 'donation'), current: 0, ...rest });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

// Tour spots (frontend)
app.get('/api/temple/:templeId/tour-spots', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: data.tour_spots || [] });
});

// Admin: tour spots
app.post('/api/temple/:templeId/admin/tour-spot', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, ...rest } = req.body;
  if (id) {
    const idx = (data.tour_spots || []).findIndex(s => s.id == id);
    if (idx >= 0) data.tour_spots[idx] = { ...data.tour_spots[idx], ...rest };
  } else {
    if (!data.tour_spots) data.tour_spots = [];
    data.tour_spots.push({ id: templeNextId(req.templeId, 'tour_spot'), ...rest });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

app.post('/api/temple/:templeId/admin/tour-spot/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.tour_spots = (data.tour_spots || []).filter(s => s.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

// Admin: releases
app.post('/api/temple/:templeId/admin/release', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, ...rest } = req.body;
  if (id) {
    const idx = data.releases.findIndex(r => r.id == id);
    if (idx >= 0) data.releases[idx] = { ...data.releases[idx], ...rest };
  } else {
    data.releases.push({ id: templeNextId(req.templeId, 'release'), ...rest });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

// Area management (frontend)
app.get('/api/temple/:templeId/areas', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  res.json({ code: 0, data: (data.areas || []).sort((a, b) => (a.sort || 0) - (b.sort || 0)) });
});

// Admin: Area CRUD
app.post('/api/temple/:templeId/admin/area', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, name, desc, sort } = req.body;
  if (!data.areas) data.areas = [];
  if (id) {
    const idx = data.areas.findIndex(a => a.id == id);
    if (idx >= 0) {
      if (name) data.areas[idx].name = name;
      if (desc !== undefined) data.areas[idx].desc = desc;
      if (sort !== undefined) data.areas[idx].sort = sort;
    }
  } else {
    data.areas.push({ id: templeNextId(req.templeId, 'area'), name, desc: desc || '', sort: sort || 0, halls: [] });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

app.post('/api/temple/:templeId/admin/area/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.areas = (data.areas || []).filter(a => a.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

// Admin: Hall CRUD within area
app.post('/api/temple/:templeId/admin/area/:areaId/hall', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const area = (data.areas || []).find(a => a.id == req.params.areaId);
  if (!area) return res.json({ code: 1, msg: '区域不存在' });
  const { id, name, desc, image, images, video, buddha_ids, sort } = req.body;
  // Support both old (image) and new (images) format
  const imagesArr = images || (image ? [image] : []);
  if (!area.halls) area.halls = [];
  if (id) {
    const idx = area.halls.findIndex(h => h.id == id);
    if (idx >= 0) {
      if (name) area.halls[idx].name = name;
      if (desc !== undefined) area.halls[idx].desc = desc;
      area.halls[idx].images = imagesArr;
      if (video !== undefined) area.halls[idx].video = video;
      if (buddha_ids !== undefined) area.halls[idx].buddha_ids = buddha_ids;
      if (sort !== undefined) area.halls[idx].sort = sort;
      // Keep backward compat image field
      area.halls[idx].image = imagesArr[0] || '';
    }
  } else {
    area.halls.push({
      id: templeNextId(req.templeId, 'hall'), name, desc: desc || '',
      images: imagesArr, image: imagesArr[0] || '', video: video || '',
      buddha_ids: buddha_ids || [], sort: sort || 0
    });
  }
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '操作成功' });
});

app.post('/api/temple/:templeId/admin/area/:areaId/hall/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const area = (data.areas || []).find(a => a.id == req.params.areaId);
  if (!area) return res.json({ code: 1, msg: '区域不存在' });
  area.halls = (area.halls || []).filter(h => h.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

// File upload (generic)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ code: 1, msg: '未选择文件' });
  res.json({ code: 0, data: { url: '/uploads/' + req.file.filename } });
});

// Media Library
app.get('/api/temple/:templeId/media', templeAuth, (req, res) => {
  const data = readTemple(req.templeId);
  let list = data.media || [];
  const { type, search, category, page, limit } = req.query;
  if (type === 'image') list = list.filter(m => m.type === 'image');
  if (type === 'video') list = list.filter(m => m.type === 'video');
  if (search) list = list.filter(m => m.filename.toLowerCase().includes(search.toLowerCase()));
  if (category) list = list.filter(m => m.category === category);
  list.sort((a, b) => b.createtime - a.createtime);
  // Pagination
  const total = list.length;
  const pg = parseInt(page) || 1;
  const lm = parseInt(limit) || 24;
  const paged = list.slice((pg - 1) * lm, pg * lm);
  // Category stats
  const catMap = {};
  data.media.forEach(m => {
    const cat = m.category || '未分组';
    catMap[cat] = (catMap[cat] || 0) + 1;
  });
  res.json({ code: 0, data: { items: paged, total, page: pg, limit: lm, categories: catMap } });
});

app.post('/api/temple/:templeId/admin/media/upload', templeAdminAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ code: 1, msg: '未选择文件' });
  const url = '/uploads/' + req.file.filename;
  // Decode UTF-8 filename properly
  var origName = req.file.originalname;
  try { origName = Buffer.from(origName, 'latin1').toString('utf8'); } catch(e) {}
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(origName);
  const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(origName);
  const mediaItem = {
    id: templeNextId(req.templeId, 'media'),
    filename: origName,
    url,
    type: isVideo ? 'video' : (isImage ? 'image' : 'file'),
    size: req.file.size,
    category: req.body.category || '',
    createtime: Date.now()
  };
  const data = readTemple(req.templeId);
  if (!data.media) data.media = [];
  data.media.push(mediaItem);
  writeTemple(req.templeId, data);
  res.json({ code: 0, data: mediaItem, msg: '上传成功' });
});

app.post('/api/temple/:templeId/admin/media/delete', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  data.media = (data.media || []).filter(m => m.id != req.body.id);
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '删除成功' });
});

app.post('/api/temple/:templeId/admin/media/category', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { id, category } = req.body;
  const m = (data.media || []).find(m => m.id == id);
  if (!m) return res.json({ code: 1, msg: '素材不存在' });
  m.category = category || '';
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '分类更新成功' });
});

app.post('/api/temple/:templeId/admin/media/batch-category', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const { ids, category } = req.body;
  (data.media || []).forEach(m => { if (ids.includes(m.id)) m.category = category || ''; });
  writeTemple(req.templeId, data);
  res.json({ code: 0, msg: '批量分类更新成功' });
});

// Platform logo upload
app.post('/api/platform/upload-logo', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ code: 1, msg: '未选择文件' });
  const url = '/uploads/' + req.file.filename;
  // Update platform config
  const p = readPlatform();
  p.config.platform_logo = url;
  writePlatform(p);
  res.json({ code: 0, data: { url }, msg: 'Logo 上传成功' });
});

// ============================================================
// ========== 多寺庙独立微信支付系统 ==========
// ============================================================

// ====== 支付工具函数 ======

function decryptTemplePayment(paymentData) {
  // 【调试模式】数据已是明文，跳过解密直接返回
  if (!paymentData || !paymentData.wxpay) return null;
  return JSON.parse(JSON.stringify(paymentData));
}

// ====== 4.1 商户支付配置管理（总平台） ======

app.get('/api/platform/temple/:id/payment', (req, res) => {
  const p = readPlatform();
  const temple = p.temples.find(t => t.id == req.params.id);
  if (!temple) return res.json({ code: 1, msg: '寺庙不存在' });

  const templeData = readTemple(req.params.id);
  const payment = templeData.payment || {
    enabled: false,
    wxpay: {
      mch_id: '', serial_no: '', api_v3_key: '', cert_pem: '', key_pem: '',
      h5: { enabled: false, appid: '', scene_name: '', notify_domain: '' },
      wechat_mp: { enabled: false, appid: '', appsecret: '', oauth_redirect: '' },
      miniprogram: { enabled: false, appid: '', appsecret: '', original_id: '' }
    }
  };

  // 【调试模式】直接返回完整明文
  res.json({ code: 0, data: payment });
});

app.put('/api/platform/temple/:id/payment', (req, res) => {
  const p = readPlatform();
  const temple = p.temples.find(t => t.id == req.params.id);
  if (!temple) return res.json({ code: 1, msg: '寺庙不存在' });

  const templeData = readTemple(req.params.id);
  if (!templeData) return res.json({ code: 1, msg: '寺庙数据不存在' });

  const current = templeData.payment || { enabled: false, wxpay: {} };
  const incoming = req.body;

  const newPayment = {
    enabled: incoming.enabled !== undefined ? incoming.enabled : current.enabled,
    wxpay: {
      mch_id: incoming.mch_id || current.wxpay?.mch_id || '',
      serial_no: incoming.serial_no || current.wxpay?.serial_no || '',
      // 【调试模式】直接存储明文
      api_v3_key: incoming.api_v3_key || current.wxpay?.api_v3_key || '',
      cert_pem: incoming.cert_pem || current.wxpay?.cert_pem || '',
      key_pem: incoming.key_pem || current.wxpay?.key_pem || '',
      h5: {
        enabled: incoming.h5_enabled !== undefined ? incoming.h5_enabled : (current.wxpay?.h5?.enabled || false),
        appid: incoming.h5_appid || current.wxpay?.h5?.appid || '',
        scene_name: incoming.h5_scene_name || current.wxpay?.h5?.scene_name || '',
        notify_domain: incoming.h5_notify_domain || current.wxpay?.h5?.notify_domain || ''
      },
      wechat_mp: {
        enabled: incoming.mp_enabled !== undefined ? incoming.mp_enabled : (current.wxpay?.wechat_mp?.enabled || false),
        appid: incoming.mp_appid || current.wxpay?.wechat_mp?.appid || '',
        // 【调试模式】直接存储明文
        appsecret: incoming.mp_appsecret || current.wxpay?.wechat_mp?.appsecret || '',
        oauth_redirect: incoming.mp_oauth_redirect || current.wxpay?.wechat_mp?.oauth_redirect || ''
      },
      miniprogram: {
        enabled: incoming.miniprogram_enabled !== undefined
          ? incoming.miniprogram_enabled : (current.wxpay?.miniprogram?.enabled || false),
        appid: incoming.miniprogram_appid || current.wxpay?.miniprogram?.appid || '',
        // 【调试模式】直接存储明文
        appsecret: incoming.miniprogram_appsecret || current.wxpay?.miniprogram?.appsecret || '',
        original_id: incoming.miniprogram_original_id || current.wxpay?.miniprogram?.original_id || ''
      },
      created_at: current.wxpay?.created_at || Date.now(),
      updated_at: Date.now()
    }
  };

  templeData.payment = newPayment;
  writeTemple(req.params.id, templeData);
  res.json({ code: 0, msg: '支付配置保存成功' });
});

app.post('/api/platform/temple/:id/payment/test', async (req, res) => {
  try {
    const templeData = readTemple(req.params.id);
    if (!templeData || !templeData.payment || !templeData.payment.wxpay) {
      return res.json({ code: 1, msg: '该寺庙未配置微信支付' });
    }
    // 【调试模式】数据已是明文，跳过解密
    const wxpayConfig = templeData.payment.wxpay;
    console.log('[TEST PAY] mch_id:', wxpayConfig.mch_id);
    console.log('[TEST PAY] serial_no:', wxpayConfig.serial_no);
    console.log('[TEST PAY] api_v3_key:', wxpayConfig.api_v3_key);
    console.log('[TEST PAY] key_pem len:', wxpayConfig.key_pem?.length || 0);
    console.log('[TEST PAY] cert_pem len:', wxpayConfig.cert_pem?.length || 0);
    if (!wxpayConfig.mch_id) {
      return res.json({ code: 1, msg: '商户号未填写' });
    }
    if (!wxpayConfig.api_v3_key) {
      return res.json({ code: 1, msg: 'API v3 密钥未填写' });
    }
    if (!wxpayConfig.serial_no) {
      return res.json({ code: 1, msg: '证书序列号未填写' });
    }
    if (!wxpayConfig.key_pem || wxpayConfig.key_pem.length < 100) {
      return res.json({ code: 1, msg: '商户私钥 (PEM) 未填写或内容不完整（至少需要 100 字符）' });
    }
    if (!wxpayConfig.cert_pem || wxpayConfig.cert_pem.length < 100) {
      return res.json({ code: 1, msg: 'API 证书 (PEM) 未填写或内容不完整' });
    }

    const wxPay = new WxPayCore(wxpayConfig);
    await wxPay.queryOrderByOutTradeNo('TEST_CONN_' + Date.now());
    res.json({ code: 0, msg: '✅ 商户连接成功！配置正确。' });
  } catch (e) {
    var errStr = e.message || String(e);
    
    // 404 订单不存在 = 签名验证通过，连接成功
    if (errStr.includes('ORDER_NOT_EXIST') || errStr.includes('订单不存在')) {
      return res.json({ code: 0, msg: '✅ 支付连接测试通过！签名验证成功，配置正确。' });
    }
    
    var detail = '';
    
    // 401 签名错误，给出排查建议
    if (errStr.includes('401') || errStr.includes('SIGN_ERROR') || errStr.includes('PARAM_ERROR')) {
      detail = '\n【签名/验证错误】请逐项检查：\n' +
        '  1. 商户号 (MchID)   是否正确？出错时商户号第一位可能相同但后续不同\n' +
        '  2. 证书序列号        是否从微信商户平台「API证书」页面直接复制？\n' +
        '  3. 商户私钥 (PEM)    是否是下载证书时生成的 apiclient_key.pem？\n' +
        '  4. API v3 密钥       是否在商户平台「API安全」正确设置？\n' +
        '  5. 证书是否过期？     每1年需要更新一次';
    } else if (errStr.includes('403') || errStr.includes('NO_AUTH') || errStr.includes('NOAUTH')) {
      detail = '\n【权限不足】请检查：\n' +
        '  1. 该商户号是否已开通 API v3 接口？\n' +
        '  2. 证书是否已绑定到该商户号？';
    }
    
    console.error('支付连接测试失败 [' + req.params.id + ']:', errStr);
    res.json({ code: 1, msg: '商户连接失败: ' + errStr.split('\n')[0] + detail });
  }
});

// ====== 4.2 统一下单（前端调用） ======

app.post('/api/temple/:templeId/pay/unified-order', templeAuth, async (req, res) => {
  try {
    const templeData = readTemple(req.templeId);
    if (!templeData.payment || !templeData.payment.enabled) {
      return res.json({ code: 1, msg: '该寺庙未启用微信支付' });
    }

    const decrypted = decryptTemplePayment(templeData.payment);
    if (!decrypted || !decrypted.wxpay || !decrypted.wxpay.mch_id) {
      return res.json({ code: 1, msg: '商户配置不完整' });
    }

    const { order_type, biz_ref_id, trade_type, amount, description, openid, channel, user_id, extra } = req.body;
    if (!amount || amount <= 0) {
      return res.json({ code: 1, msg: '金额无效' });
    }

    const wxpayConfig = decrypted.wxpay;

    // 校验渠道配置
    if (trade_type === 'jsapi' || trade_type === 'miniprogram') {
      const ch = channel || 'wechat_mp';
      if (ch === 'miniprogram' && (!wxpayConfig.miniprogram || !wxpayConfig.miniprogram.enabled)) {
        return res.json({ code: 1, msg: '小程序支付未启用，请联系管理员配置' });
      }
      if (ch === 'wechat_mp' && (!wxpayConfig.wechat_mp || !wxpayConfig.wechat_mp.enabled)) {
        return res.json({ code: 1, msg: '公众号支付未启用，请联系管理员配置' });
      }
    } else if (trade_type === 'h5') {
      if (!wxpayConfig.h5 || !wxpayConfig.h5.enabled) {
        return res.json({ code: 1, msg: 'H5 支付未启用，请联系管理员配置' });
      }
    }

    // 根据渠道选择正确的 AppID
    let activeAppid = wxpayConfig.appid || '';
    if (trade_type === 'h5') {
      activeAppid = wxpayConfig.h5?.appid || wxpayConfig.appid || '';
    } else if (trade_type === 'jsapi' || trade_type === 'miniprogram') {
      const ch = channel || 'wechat_mp';
      activeAppid = ch === 'miniprogram'
        ? (wxpayConfig.miniprogram?.appid || wxpayConfig.appid || '')
        : (wxpayConfig.wechat_mp?.appid || wxpayConfig.appid || '');
    } else if (trade_type === 'native') {
      activeAppid = wxpayConfig.wechat_mp?.appid || wxpayConfig.appid || '';
    }

    // 生成订单号
    const orderNo = 'ORD' + Date.now() + crypto.randomBytes(3).toString('hex').toUpperCase();

    // 通知 URL
    const notifyHost = (req.protocol || 'https') + '://' + (req.get('host') || 'siyu.yun78.cn');
    const notifyUrl = notifyHost + '/api/pay/notify/' + req.templeId;

    // 创建支付引擎
    const wxPay = new WxPayCore({
      ...wxpayConfig,
      appid: activeAppid
    });

    // 构建下单参数
    let wxTradeType = 'JSAPI';
    if (trade_type === 'h5') wxTradeType = 'MWEB';
    else if (trade_type === 'native') wxTradeType = 'NATIVE';
    else if (trade_type === 'jsapi') wxTradeType = 'JSAPI';

    const orderParams = {
      description: description || '寺语·功德',
      outTradeNo: orderNo,
      amount,
      payerClientIp: req.ip,
      notifyUrl,
      tradeType: wxTradeType,
    };

    if (trade_type === 'h5') {
      orderParams.sceneInfo = {
        payer_client_ip: req.ip,
        h5_info: {
          type: 'Wap',
          app_name: wxpayConfig.h5?.scene_name || req.templeInfo?.name || '寺语',
          app_url: wxpayConfig.h5?.notify_domain || notifyHost
        }
      };
    } else if (trade_type === 'jsapi' || trade_type === 'miniprogram') {
      if (!openid) return res.json({ code: 1, msg: 'JSAPI/小程序支付需要 openid' });
      orderParams.openid = openid;
    }
    // NATIVE 不需要 openid 或额外参数

    // 调微信统一下单
    let wxResult;
    try {
      wxResult = await wxPay.createOrder(orderParams);
    } catch (wxErr) {
      console.error('微信下单失败:', wxErr.message);
      return res.json({ code: 1, msg: '微信下单失败: ' + wxErr.message });
    }

    // 持久化订单
    const order = {
      id: templeNextId(req.templeId, 'order'),
      order_no: orderNo,
      merchant_order_no: orderNo,
      user_id: user_id || 0,
      order_type: order_type || 'general',
      biz_ref_id: biz_ref_id || 0,
      total_amount: amount,
      status: 'pending',
      trade_type: wxTradeType,
      channel: channel || 'h5',
      mch_id: wxpayConfig.mch_id,
      appid: activeAppid,
      openid: openid || '',
      description: description || '',
      extra: extra || {},
      createtime: Date.now(),
      updatetime: Date.now()
    };
    templeData.orders.push(order);
    writeTemple(req.templeId, templeData);

    // 根据 trade_type 返回
    if (trade_type === 'h5') {
      res.json({ code: 0, data: { order_no: orderNo, mweb_url: wxResult.mweb_url, amount } });
    } else if (trade_type === 'native') {
      res.json({ code: 0, data: { order_no: orderNo, code_url: wxResult.code_url, amount } });
    } else {
      const prepayId = wxResult.prepay_id;
      const packageStr = 'prepay_id=' + prepayId;
      const nonceStr = crypto.randomBytes(16).toString('hex');
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signStr = [activeAppid, timestamp, nonceStr, packageStr].join('\n') + '\n';
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(signStr);
      const paySign = sign.sign(wxPay.keyPem, 'base64');

      res.json({ code: 0, data: {
        order_no: orderNo,
        appId: activeAppid,
        timeStamp: timestamp,
        nonceStr,
        package: packageStr,
        signType: 'RSA',
        paySign
      }});
    }
  } catch (e) {
    console.error('统一下单失败:', e);
    res.json({ code: 1, msg: '下单失败: ' + e.message });
  }
});

// ====== 4.3 查询订单 ======

app.get('/api/temple/:templeId/pay/order/:orderNo', templeAuth, async (req, res) => {
  const templeData = readTemple(req.templeId);
  if (!templeData) return res.json({ code: 1, msg: '数据错误' });
  const order = (templeData.orders || []).find(o => o.order_no === req.params.orderNo);
  if (!order) return res.json({ code: 1, msg: '订单不存在' });

  // 如果订单未支付，主动向微信查询状态
  if (order.status === 'pending' && templeData.payment && templeData.payment.wxpay) {
    try {
      const wxpayConfig = templeData.payment.wxpay;
      const wxPay = new WxPayCore({
        ...wxpayConfig,
        appid: wxpayConfig.wechat_mp?.appid || wxpayConfig.appid || ''
      });
      const wxOrder = await wxPay.queryOrderByOutTradeNo(order.order_no);

      if (wxOrder && wxOrder.trade_state === 'SUCCESS') {
        order.status = 'paid';
        order.transaction_id = wxOrder.transaction_id || '';
        order.pay_time = Date.now();
        writeTemple(req.templeId, templeData);
        console.log('[订单查询] 微信支付成功，更新订单:', order.order_no);
      }
    } catch (e) {
      // 订单不存在或查询失败，保持原状态
    }
  }

  res.json({ code: 0, data: order });
});

// ====== 4.4 退款 ======

app.post('/api/temple/:templeId/pay/refund', templeAdminAuth, async (req, res) => {
  try {
    const templeData = readTemple(req.templeId);
    if (!templeData.payment || !templeData.payment.enabled) {
      return res.json({ code: 1, msg: '该寺庙未启用微信支付' });
    }

    const { order_no, refund_amount, reason } = req.body;
    const order = (templeData.orders || []).find(o => o.order_no === order_no);
    if (!order) return res.json({ code: 1, msg: '订单不存在' });
    if (order.status !== 'paid') return res.json({ code: 1, msg: '订单未支付，无法退款' });
    if (!order.transaction_id) return res.json({ code: 1, msg: '缺少微信订单号，无法退款' });

    const refundAmt = parseInt(refund_amount) || order.total_amount;
    if (refundAmt > order.total_amount) {
      return res.json({ code: 1, msg: '退款金额不能超过订单金额' });
    }

    const decrypted = decryptTemplePayment(templeData.payment);
    const wxPay = new WxPayCore(decrypted.wxpay);

    const refundNo = 'REF' + Date.now() + crypto.randomBytes(3).toString('hex').toUpperCase();

    const refundResult = await wxPay.refund({
      transactionId: order.transaction_id,
      outTradeNo: order.order_no,
      outRefundNo: refundNo,
      refundAmount: refundAmt,
      totalAmount: order.total_amount,
      reason: reason || '用户申请退款'
    });

    if (!templeData.refund_records) templeData.refund_records = [];
    const maxId = templeData.refund_records.length > 0
      ? Math.max(...templeData.refund_records.map(r => r.id)) : 0;
    templeData.refund_records.push({
      id: maxId + 1,
      refund_no: refundNo,
      order_no: order.order_no,
      transaction_id: order.transaction_id,
      total_amount: order.total_amount,
      refund_amount: refundAmt,
      reason: reason || '',
      status: refundResult.status || 'processing',
      refund_id: refundResult.refund_id || '',
      operator: req.templeInfo?.admin_username || '系统',
      createtime: Date.now()
    });

    order.status = refundResult.status === 'SUCCESS' ? 'refunded' : 'refunding';
    order.refund_amount = (order.refund_amount || 0) + refundAmt;
    order.updatetime = Date.now();
    writeTemple(req.templeId, templeData);

    res.json({ code: 0, data: { refund_no: refundNo, status: order.status }, msg: '退款处理成功' });
  } catch (e) {
    console.error('退款失败:', e);
    res.json({ code: 1, msg: '退款失败: ' + e.message });
  }
});

// ====== 4.5 对账 ======

app.post('/api/temple/:templeId/pay/reconciliation/run', templeAdminAuth, async (req, res) => {
  try {
    const dateStr = req.body.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const templeData = readTemple(req.templeId);
    if (!templeData.payment || !templeData.payment.enabled) {
      return res.json({ code: 1, msg: '该寺庙未启用微信支付' });
    }

    const decrypted = decryptTemplePayment(templeData.payment);
    const wxPay = new WxPayCore(decrypted.wxpay);

    const report = await reconcileDay(req.templeId, dateStr, (billDate) => {
      return wxPay.downloadBill(billDate, 'tradebill');
    });

    res.json({ code: 0, data: report, msg: '对账完成' });
  } catch (e) {
    console.error('对账失败:', e);
    res.json({ code: 1, msg: '对账失败: ' + e.message });
  }
});

app.get('/api/temple/:templeId/pay/reconciliation/:date', templeAdminAuth, (req, res) => {
  const templeData = readTemple(req.templeId);
  const reports = (templeData.reconciliation || []).filter(r => r.date === req.params.date);
  res.json({ code: 0, data: reports[0] || null });
});

// ====== 4.6 支付通知回调（统一入口） ======

// 路径参数格式（新）
app.post('/api/pay/notify/:templeId', async (req, res) => {
  req.query = req.query || {};
  req.query.temple_id = req.params.templeId;
  handlePaymentNotify(req, res);
});

// 查询参数格式（旧，兼容）
app.post('/api/pay/notify', async (req, res) => {
  handlePaymentNotify(req, res);
});

function handlePaymentNotify(req, res) {
  const templeId = parseInt(req.params.templeId || req.query.temple_id);
  if (!templeId) {
    return res.status(400).json({ code: 'FAIL', message: '缺少寺庙ID' });
  }

  try {
    const templeData = readTemple(templeId);
    if (!templeData || !templeData.payment || !templeData.payment.wxpay) {
      return res.status(400).json({ code: 'FAIL', message: '寺庙支付配置不存在' });
    }

    const decrypted = decryptTemplePayment(templeData.payment);
    if (!decrypted || !decrypted.wxpay) {
      return res.status(400).json({ code: 'FAIL', message: '配置解密失败' });
    }

    const wxPay = new WxPayCore(decrypted.wxpay);
    const bodyStr = req.rawBody || JSON.stringify(req.body);
    const result = wxPay.handleNotify(req.headers, bodyStr);

    if (result.eventType === 'TRANSACTION.SUCCESS') {
      const payData = result.data;
      const { out_trade_no, transaction_id, trade_state, amount } = payData;

      const order = (templeData.orders || []).find(o => o.order_no === out_trade_no);
      if (!order) {
        return res.status(200).json({ code: 'FAIL', message: '订单不存在，但已接收' });
      }

      // 幂等性
      if (order.status === 'paid') {
        return res.status(200).json({ code: 'SUCCESS', message: '已处理' });
      }

      if (trade_state !== 'SUCCESS') {
        order.status = 'closed';
        order.updatetime = Date.now();
        writeTemple(templeId, templeData);
        return res.status(200).json({ code: 'SUCCESS', message: '已接收非成功状态' });
      }

      const paidAmount = amount.payer_total || amount.total;
      if (paidAmount !== order.total_amount) {
        console.error('金额不匹配! 订单 ' + out_trade_no + ': 应收 ' + order.total_amount + ', 实收 ' + paidAmount);
        order.amount_mismatch = true;
        order.payer_amount = paidAmount;
      }

      order.status = 'paid';
      order.transaction_id = transaction_id;
      order.paid_amount = paidAmount;
      order.paid_at = Date.now();
      order.notify_raw = JSON.stringify(req.body);
      order.notify_time = Date.now();
      order.updatetime = Date.now();

      writeTemple(templeId, templeData);

      // 更新关联业务记录
      updateBizAfterPayment(templeId, order);
    }

    res.status(200).json({ code: 'SUCCESS', message: '成功' });
  } catch (e) {
    console.error('支付回调处理失败 temple=' + templeId + ':', e.message);
    res.status(500).json({ code: 'FAIL', message: '处理失败: ' + e.message });
  }
}

function updateBizAfterPayment(templeId, order) {
  const templeData = readTemple(templeId);
  if (!templeData) return;

  switch (order.order_type) {
    case 'offering':
      const offering = (templeData.offering_records || []).find(r => r.id == order.biz_ref_id);
      if (offering) {
        offering.paid = true;
        offering.paid_at = Date.now();
      }
      break;
    case 'donation':
      const donation = (templeData.donations || []).find(r => r.id == order.biz_ref_id);
      if (donation && !donation._already_added) {
        donation.paid = true;
        donation.paid_at = Date.now();
        const project = (templeData.merit_projects || []).find(p => p.id == donation.project_id);
        if (project) {
          project.current += donation.amount;
        }
        donation._already_added = true;
      }
      break;
    case 'shop':
      const shopOrder = (templeData.orders || []).find(o => o.order_no === order.order_no);
      if (shopOrder) shopOrder.status = 'paid';
      break;
  }

  writeTemple(templeId, templeData);
}

// ====== 4.7 公众号 OAuth 授权 ======

app.get('/api/temple/:templeId/pay/oauth-url', templeAuth, (req, res) => {
  const templeData = readTemple(req.templeId);
  const payment = templeData.payment;
  if (!payment || !payment.wxpay) return res.json({ code: 1, msg: '支付未配置' });

  const decrypted = decryptTemplePayment(payment);
  const mpConfig = decrypted?.wxpay?.wechat_mp;
  if (!mpConfig || !mpConfig.enabled || !mpConfig.appid) {
    return res.json({ code: 1, msg: '公众号支付未配置' });
  }

  const redirect = req.query.redirect || mpConfig.oauth_redirect ||
    (req.protocol + '://' + req.get('host') + '/t/' + req.templeInfo.slug);

  const oauthUrl =
    'https://open.weixin.qq.com/connect/oauth2/authorize' +
    '?appid=' + mpConfig.appid +
    '&redirect_uri=' + encodeURIComponent(redirect) +
    '&response_type=code' +
    '&scope=snsapi_base' +
    '&state=' + req.templeId +
    '#wechat_redirect';

  res.json({ code: 0, data: { oauth_url: oauthUrl } });
});

app.get('/api/temple/:templeId/pay/oauth-callback', templeAuth, async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.json({ code: 1, msg: '缺少 code' });

    const templeData = readTemple(req.templeId);
    const decrypted = decryptTemplePayment(templeData.payment);
    const mpConfig = decrypted?.wxpay?.wechat_mp;
    if (!mpConfig || !mpConfig.appid) {
      return res.json({ code: 1, msg: '公众号支付未配置' });
    }

    let appsecret = mpConfig.appsecret;
    try { appsecret = wxpayCrypto.decrypt(mpConfig.appsecret); } catch (e) {}

    const tokenUrl =
      'https://api.weixin.qq.com/sns/oauth2/access_token' +
      '?appid=' + mpConfig.appid +
      '&secret=' + appsecret +
      '&code=' + code +
      '&grant_type=authorization_code';

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.errcode) {
      return res.json({ code: 1, msg: '获取 openid 失败: ' + (tokenData.errmsg || '未知错误') });
    }

    res.json({ code: 0, data: { openid: tokenData.openid } });
  } catch (e) {
    res.json({ code: 1, msg: 'OAuth 处理失败: ' + e.message });
  }
});

// ====== 4.8 小程序 code 换 openid ======

app.post('/api/temple/:templeId/pay/miniprogram/login', templeAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.json({ code: 1, msg: '缺少 code' });

    const templeData = readTemple(req.templeId);
    const decrypted = decryptTemplePayment(templeData.payment);
    const mpConfig = decrypted?.wxpay?.miniprogram;
    if (!mpConfig || !mpConfig.enabled || !mpConfig.appid) {
      return res.json({ code: 1, msg: '小程序支付未配置' });
    }

    let appsecret = mpConfig.appsecret;
    try { appsecret = wxpayCrypto.decrypt(mpConfig.appsecret); } catch (e) {}

    const wxRes = await fetch(
      'https://api.weixin.qq.com/sns/jscode2session' +
      '?appid=' + mpConfig.appid +
      '&secret=' + appsecret +
      '&js_code=' + code +
      '&grant_type=authorization_code'
    );
    const wxData = await wxRes.json();

    if (wxData.errcode) {
      return res.json({ code: 1, msg: '获取 openid 失败: ' + (wxData.errmsg || '') });
    }

    res.json({ code: 0, data: { openid: wxData.openid /* session_key 不返回前端 */ } });
  } catch (e) {
    res.json({ code: 1, msg: '处理失败: ' + e.message });
  }
});

// ====== 4.9 订单/退款查询（寺庙管理员） ======

// 普通用户查询自己的订单（前端"我的"页面使用）
app.get('/api/temple/:templeId/pay/orders/list', templeAuth, (req, res) => {
  const templeData = readTemple(req.templeId);
  let orders = templeData.orders || [];

  const { status, order_type, user_id } = req.query;
  if (user_id) orders = orders.filter(o => o.user_id == user_id);
  if (status) orders = orders.filter(o => o.status === status);
  if (order_type) orders = orders.filter(o => o.order_type === order_type);

  orders.sort((a, b) => b.createtime - a.createtime);
  res.json({ code: 0, data: orders.slice(0, 50) });
});

// 寺庙管理员查询订单（后台使用）
app.get('/api/temple/:templeId/pay/orders/admin-list', templeAdminAuth, (req, res) => {
  const templeData = readTemple(req.templeId);
  let orders = templeData.orders || [];

  const { status, order_type, start_time, end_time, search } = req.query;
  if (status) orders = orders.filter(o => o.status === status);
  if (order_type) orders = orders.filter(o => o.order_type === order_type);
  if (start_time) orders = orders.filter(o => o.createtime >= parseInt(start_time));
  if (end_time) orders = orders.filter(o => o.createtime <= parseInt(end_time));
  if (search) orders = orders.filter(o =>
    o.order_no.includes(search) || o.description.includes(search)
  );

  orders.sort((a, b) => b.createtime - a.createtime);

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const total = orders.length;
  const paged = orders.slice((page - 1) * limit, page * limit);

  res.json({ code: 0, data: { items: paged, total, page, limit } });
});

app.get('/api/temple/:templeId/pay/refunds/list', templeAdminAuth, (req, res) => {
  const templeData = readTemple(req.templeId);
  let refunds = templeData.refund_records || [];
  refunds.sort((a, b) => b.createtime - a.createtime);

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const total = refunds.length;
  const paged = refunds.slice((page - 1) * limit, page * limit);

  res.json({ code: 0, data: { items: paged, total, page, limit } });
});

// ====== 4.11 会员管理 ======

app.get('/api/platform/members', (req, res) => {
  const p = readPlatform();
  const { temple_id, search, page, limit } = req.query;
  const pg = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  
  let allUsers = [];
  p.temples.forEach(t => {
    if (temple_id && t.id != temple_id) return;
    const td = readTemple(t.id);
    if (!td || !td.users) return;
    td.users.forEach(u => {
      allUsers.push({
        ...u,
        temple_id: t.id,
        temple_name: t.name
      });
    });
  });

  // 搜索过滤
  if (search) {
    const s = search.toLowerCase();
    allUsers = allUsers.filter(u => 
      (u.nickname && u.nickname.toLowerCase().includes(s)) ||
      (u.phone && u.phone.includes(s))
    );
  }

  allUsers.sort((a, b) => b.createtime - a.createtime);
  const total = allUsers.length;
  const items = allUsers.slice((pg - 1) * lim, pg * lim);
  res.json({ code: 0, data: { items, total, page: pg, limit: lim } });
});

app.get('/api/temple/:templeId/member/:userId', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  const user = (data.users || []).find(u => u.id == req.params.userId);
  if (!user) return res.json({ code: 1, msg: '用户不存在' });
  
  const offerings = (data.offering_records || []).filter(r => r.user_phone === user.phone).length;
  const orders = (data.orders || []).filter(o => o.user_id == user.id);
  const merit = user.merit || 0;
  
  res.json({ code: 0, data: {
    ...user,
    offering_count: offerings,
    order_count: orders.length,
    paid_amount: orders.filter(o => o.status === 'paid').reduce((s, o) => s + (o.total_amount || 0), 0),
    merit
  }});
});

// ===== 寺庙会员管理 =====
app.get('/api/temple/:templeId/admin/members', templeAdminAuth, (req, res) => {
  const data = readTemple(req.templeId);
  if (!data) return res.json({ code: 1, msg: '数据错误' });
  
  const { search, page, limit } = req.query;
  const pg = parseInt(page) || 1;
  const lim = parseInt(limit) || 20;
  
  let users = data.users || [];
  if (search) {
    const s = search.toLowerCase();
    users = users.filter(u => 
      (u.nickname && u.nickname.toLowerCase().includes(s)) ||
      (u.phone && u.phone.includes(s))
    );
  }
  
  users.sort((a, b) => b.createtime - a.createtime);
  const total = users.length;
  const items = users.slice((pg - 1) * lim, pg * lim);
  
  // 附加统计
  const enriched = items.map(u => {
    const oCnt = (data.offering_records || []).filter(r => r.user_phone === u.phone).length;
    const orders = (data.orders || []).filter(o => o.user_id == u.id);
    return { ...u, offering_count: oCnt, order_count: orders.length };
  });
  
  res.json({ code: 0, data: { items: enriched, total, page: pg, limit: lim } });
});

// ====== 4.12 总平台支付概览 ======

app.get('/api/platform/pay/overview', (req, res) => {
  const p = readPlatform();
  const overview = p.temples.map(t => {
    const td = readTemple(t.id);
    if (!td) return { id: t.id, name: t.name, payment_enabled: false };
    const orders = td.orders || [];
    const refunds = td.refund_records || [];
    const paidOrders = orders.filter(o => o.status === 'paid');
    return {
      id: t.id,
      name: t.name,
      payment_enabled: td.payment?.enabled || false,
      mch_id: td.payment?.wxpay?.mch_id || '',
      total_orders: orders.length,
      paid_orders: paidOrders.length,
      paid_amount: paidOrders.reduce((s, o) => s + o.total_amount, 0),
      total_refunds: refunds.length,
      refunded_amount: refunds.filter(r => r.status === 'success' || r.status === 'SUCCESS')
        .reduce((s, r) => s + r.refund_amount, 0),
      last_reconciliation: (td.reconciliation || []).slice(-1)[0]?.date || '无'
    };
  });
  res.json({ code: 0, data: overview });
});

// ========== Start Server ==========
initData();
if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));

app.listen(PORT, () => {
  console.log('\n🛕 寺语 · 智慧寺院管理平台已启动');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  平台首页: http://localhost:${PORT}`);
  console.log(`  总管理后台: http://localhost:${PORT}/admin`);
  console.log(`  大觉禅寺: http://localhost:${PORT}/t/dajue`);
  console.log(`  普陀寺:   http://localhost:${PORT}/t/putuo`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  平台管理员: admin / 123456');
  console.log('  寺庙管理员: dajue / 123456 | putuo / 123456');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
