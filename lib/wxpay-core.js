// lib/wxpay-core.js
// 微信支付 V3 API 核心封装
// 文档: https://pay.weixin.qq.com/wiki/doc/apiv3/wxpay/pages/api.shtml

const crypto = require('crypto');

const WXAPI_BASE = 'https://api.mch.weixin.qq.com/v3';

class WxPayCore {
  /**
   * @param {Object} config - 解密后的寺庙商户配置
   * @param {string} config.mch_id
   * @param {string} config.appid
   * @param {string} config.api_v3_key    - 32字节API v3密钥（明文）
   * @param {string} config.serial_no     - 商户证书序列号
   * @param {string} config.cert_pem      - 商户API证书（PEM格式明文）
   * @param {string} config.key_pem       - 商户私钥（PEM格式明文）
   */
  constructor(config) {
    this.mchId = config.mch_id;
    this.appid = config.appid;
    this.apiV3Key = config.api_v3_key;
    this.serialNo = config.serial_no;
    this.certPem = config.cert_pem;
    this.keyPem = config.key_pem;
  }

  // ==================== 签名工具 ====================

  /**
   * 生成请求头的 Authorization 签名
   */
  _buildAuthHeader(method, url, body) {
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = body ? JSON.stringify(body) : '';

    const message = [method, url, timestamp, nonceStr, bodyStr].join('\n') + '\n';

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    const signature = sign.sign(this.keyPem, 'base64');

    const token = `mchid="${this.mchId}",nonce_str="${nonceStr}",` +
      `timestamp="${timestamp}",serial_no="${this.serialNo}",signature="${signature}"`;

    return {
      'Authorization': `WECHATPAY2-SHA256-RSA2048 ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'siyu-pay/1.0'
    };
  }

  /**
   * 发送 V3 API 请求
   */
  async _request(method, path, body) {
    const fullPath = '/v3' + path;
    const url = WXAPI_BASE + path;
    const headers = this._buildAuthHeader(method, fullPath, body);

    const options = {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    };

    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    let data = null;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else if (contentType.includes('text/')) {
      data = await response.text();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errMsg = data && data.message ? data.message : `HTTP ${response.status}`;
      throw new Error(`微信支付API错误 [${response.status}]: ${errMsg}`);
    }

    return data;
  }

  // ==================== 统一下单 ====================

  /**
   * 统一下单
   * @param {Object} params
   * @param {string} params.description  - 商品描述
   * @param {string} params.outTradeNo   - 商户订单号
   * @param {number} params.amount       - 总金额（分）
   * @param {string} params.payerClientIp - 用户终端IP
   * @param {string} params.notifyUrl    - 通知地址
   * @param {string} params.tradeType    - JSAPI | MWEB | NATIVE | APP
   * @param {string} [params.openid]     - JSAPI 必传
   * @param {Object} [params.sceneInfo]  - MWEB 必传（h5_info）
   * @returns {Promise<Object>}
   */
  async createOrder(params) {
    const body = {
      appid: this.appid,
      mchid: this.mchId,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: params.notifyUrl,
      amount: {
        total: params.amount,
        currency: 'CNY'
      }
    };

    // JSAPI 场景
    if (params.tradeType === 'JSAPI') {
      if (!params.openid) {
        throw new Error('JSAPI 支付必须提供 openid');
      }
      body.payer = { openid: params.openid };
    }

    // MWEB（H5）场景
    if (params.tradeType === 'MWEB') {
      body.scene_info = params.sceneInfo || {
        payer_client_ip: params.payerClientIp,
        h5_info: {
          type: 'Wap',
          app_name: '寺语',
          app_url: 'https://siyu.com'
        }
      };
    }

    // 根据 trade_type 选择正确的 API 路径
    const tradeTypeMap = { JSAPI: 'jsapi', MWEB: 'h5', NATIVE: 'native', APP: 'app' };
    const apiPath = '/pay/transactions/' + (tradeTypeMap[params.tradeType] || 'jsapi');
    const result = await this._request('POST', apiPath, body);
    return result;
  }

  // ==================== 查询订单 ====================

  /**
   * 通过商户订单号查询
   */
  async queryOrderByOutTradeNo(outTradeNo) {
    return this._request('GET', `/pay/transactions/out-trade-no/${outTradeNo}?mchid=${this.mchId}`);
  }

  // ==================== 关闭订单 ====================

  async closeOrder(outTradeNo) {
    return this._request('POST', `/pay/transactions/out-trade-no/${outTradeNo}/close`, {
      mchid: this.mchId
    });
  }

  // ==================== 申请退款 ====================

  /**
   * @param {Object} params
   * @param {string} params.transactionId - 微信订单号
   * @param {string} params.outTradeNo    - 商户订单号
   * @param {string} params.outRefundNo   - 商户退款单号
   * @param {number} params.refundAmount  - 退款金额（分）
   * @param {number} params.totalAmount   - 原订单金额（分）
   * @param {string} [params.reason]      - 退款原因
   * @param {string} [params.notifyUrl]   - 退款结果回调
   * @returns
   */
  async refund(params) {
    const body = {
      transaction_id: params.transactionId,
      out_trade_no: params.outTradeNo,
      out_refund_no: params.outRefundNo,
      amount: {
        refund: params.refundAmount,
        total: params.totalAmount,
        currency: 'CNY'
      },
      ...(params.reason ? { reason: params.reason } : {}),
      ...(params.notifyUrl ? { notify_url: params.notifyUrl } : {})
    };

    return this._request('POST', '/refund/domestic/refunds', body);
  }

  // ==================== 查询退款 ====================

  async queryRefund(outRefundNo) {
    return this._request('GET', `/refund/domestic/refunds/${outRefundNo}`);
  }

  // ==================== 回调通知验签与解密 ====================

  /**
   * 验证微信回调签名
   */
  verifyNotifySign(wechatpaySignature, wechatpayTimestamp, wechatpayNonce, bodyStr) {
    const message = [wechatpayTimestamp, wechatpayNonce, bodyStr].join('\n') + '\n';
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(message);
    return verify.verify(this.certPem, wechatpaySignature, 'base64');
  }

  /**
   * 解密回调通知中的 resource 对象
   */
  decryptNotifyResource(resource) {
    const { associated_data, nonce, ciphertext, algorithm } = resource;
    if (algorithm !== 'AEAD_AES_256_GCM') {
      throw new Error('不支持的加密算法: ' + algorithm);
    }

    const key = Buffer.from(this.apiV3Key, 'utf8');
    const iv = Buffer.from(nonce, 'utf8');
    const aad = Buffer.from(associated_data || '', 'utf8');
    const cipherBuffer = Buffer.from(ciphertext, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    let decrypted = decipher.update(cipherBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * 一站式处理回调（验签 + 解密）
   * @param {Object} reqHeaders - req.headers
   * @param {string} bodyStr - req.body 的原始字符串
   * @returns {Object} - 解密后的支付结果
   */
  handleNotify(reqHeaders, bodyStr) {
    const wechatpaySignature = reqHeaders['wechatpay-signature'];
    const wechatpayTimestamp = reqHeaders['wechatpay-timestamp'];
    const wechatpayNonce = reqHeaders['wechatpay-nonce'];

    // 验签
    if (!this.verifyNotifySign(wechatpaySignature, wechatpayTimestamp, wechatpayNonce, bodyStr)) {
      throw new Error('回调签名验证失败');
    }

    // 解密
    const body = JSON.parse(bodyStr);
    const eventType = body.event_type;
    const resource = body.resource;
    const decrypted = this.decryptNotifyResource(resource);

    return { eventType, raw: body, data: decrypted };
  }

  // ==================== 下载账单 ====================

  /**
   * 下载交易/资金账单
   * @param {string} billDate - YYYY-MM-DD
   * @param {string} billType - tradebill | fundflowbill
   * @returns {Promise<string>} - CSV 文本
   */
  async downloadBill(billDate, billType = 'tradebill') {
    const data = await this._request(
      'GET',
      `/bill/tradebill?bill_date=${billDate}&bill_type=${billType}`
    );
    // 如果返回 download_url，需要再次请求
    if (typeof data === 'object' && data.download_url) {
      const dlUrl = data.download_url;
      const parsed = new URL(dlUrl);
      const pathAndQuery = parsed.pathname + parsed.search;
      const headers = this._buildAuthHeader('GET', pathAndQuery, null);
      const response = await fetch(dlUrl, { headers });
      return response.text();
    }
    return data;
  }
}

module.exports = WxPayCore;
