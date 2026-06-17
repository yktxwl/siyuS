// lib/wxpay-reconciliation.js
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TEMPLES_DIR = path.join(DATA_DIR, 'temples');

function readTemple(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(TEMPLES_DIR, id + '.json'), 'utf-8'));
  } catch (e) { return null; }
}

function writeTemple(id, data) {
  fs.writeFileSync(path.join(TEMPLES_DIR, id + '.json'), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 解析微信交易账单 CSV
 */
function parseWxBillCsv(csvText) {
  const lines = csvText.split('\n');
  const transactions = [];
  let inData = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('`')) continue;
    if (trimmed.startsWith('微信支付') || trimmed.startsWith('交易时间')) {
      inData = true;
      continue;
    }
    if (!inData) continue;
    if (trimmed.startsWith('总交易单数') || trimmed.startsWith('订单总金额')) break;

    const fields = trimmed.split(',');
    if (fields.length < 15) continue;

    transactions.push({
      trans_time: fields[0],
      appid: fields[1],
      mch_id: fields[2],
      transaction_id: fields[5],
      out_trade_no: fields[6],
      openid: fields[7],
      trade_type: fields[8],
      trade_status: fields[9],
      total_amount: parseInt(fields[12]) || 0,
      coupon_amount: parseInt(fields[13]) || 0,
      refund_id: fields[14],
      out_refund_no: fields[15],
      refund_amount: parseInt(fields[16]) || 0,
      goods_name: fields[21],
      order_amount: parseInt(fields[24]) || 0,
    });
  }

  return transactions;
}

/**
 * 执行日终对账
 * @param {number} templeId
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Function} downloadFn - async (billDate) => csvText
 */
async function reconcileDay(templeId, dateStr, downloadFn) {
  const templeData = readTemple(templeId);
  if (!templeData) throw new Error('寺庙数据不存在');

  // 1. 下载并解析微信账单
  const csvText = await downloadFn(dateStr);
  const wxTransactions = parseWxBillCsv(csvText);

  // 2. 获取平台该日订单
  const dayStart = new Date(dateStr + 'T00:00:00+08:00').getTime();
  const dayEnd = new Date(dateStr + 'T23:59:59+08:00').getTime();
  const localOrders = (templeData.orders || []).filter(o =>
    o.createtime >= dayStart && o.createtime <= dayEnd
  );

  // 3. 逐笔核对
  const matched = [];
  const unmatchedLocal = [];
  const unmatchedWx = [];
  const diffAmount = [];

  const wxMap = new Map();
  wxTransactions.forEach(wx => {
    if (wx.out_trade_no) {
      wxMap.set(wx.out_trade_no, wx);
      wxMap.set(wx.out_trade_no.replace(/^wx/, ''), wx);
    }
  });

  const localMap = new Map();
  localOrders.forEach(order => localMap.set(order.order_no, order));

  for (const order of localOrders) {
    if (order.total_amount <= 0) continue;

    if (order.status !== 'paid') {
      unmatchedLocal.push({ order_no: order.order_no, amount: order.total_amount, reason: '平台已记录但未支付' });
      continue;
    }

    const wx = wxMap.get(order.order_no);
    if (wx) {
      if (wx.total_amount === order.total_amount) {
        matched.push({ order_no: order.order_no, local_amount: order.total_amount, wx_amount: wx.total_amount });
      } else {
        diffAmount.push({
          order_no: order.order_no,
          local_amount: order.total_amount,
          wx_amount: wx.total_amount,
          diff: order.total_amount - wx.total_amount,
          reason: '金额不一致'
        });
      }
    } else {
      unmatchedLocal.push({ order_no: order.order_no, amount: order.total_amount, reason: '平台有记录但微信账单中不存在' });
    }
  }

  for (const wx of wxTransactions) {
    if (!wx.out_trade_no) continue;
    if (!localMap.has(wx.out_trade_no)) {
      unmatchedWx.push({ order_no: wx.out_trade_no, amount: wx.total_amount, reason: '微信账单存在但平台无记录' });
    }
  }

  // 4. 生成报告
  const report = {
    date: dateStr,
    temple_id: templeId,
    generated_at: Date.now(),
    summary: {
      wx_total_count: wxTransactions.length,
      local_paid_count: localOrders.filter(o => o.status === 'paid').length,
      matched_count: matched.length,
      unmatched_local_count: unmatchedLocal.length,
      unmatched_wx_count: unmatchedWx.length,
      amount_diff_count: diffAmount.length,
      wx_total_amount: wxTransactions.reduce((s, t) => s + t.total_amount, 0),
      local_paid_amount: localOrders.filter(o => o.status === 'paid').reduce((s, o) => s + o.total_amount, 0),
      status: 'balanced'
    },
    details: {
      matched: matched.slice(0, 500),
      unmatched_local: unmatchedLocal,
      unmatched_wx: unmatchedWx,
      amount_diff: diffAmount
    }
  };

  if (unmatchedLocal.length > 0 || unmatchedWx.length > 0 || diffAmount.length > 0) {
    report.summary.status = 'imbalanced';
  }

  // 5. 持久化对账报告
  if (!templeData.reconciliation) templeData.reconciliation = [];
  const existingIdx = templeData.reconciliation.findIndex(r => r.date === dateStr);
  if (existingIdx >= 0) {
    templeData.reconciliation[existingIdx] = report;
  } else {
    templeData.reconciliation.push(report);
  }
  templeData.reconciliation.sort((a, b) => (a.date || '').localeCompare(b.date));
  if (templeData.reconciliation.length > 90) {
    templeData.reconciliation = templeData.reconciliation.slice(-90);
  }
  writeTemple(templeId, templeData);

  return report;
}

module.exports = { reconcileDay, parseWxBillCsv };
