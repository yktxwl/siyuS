// lib/wxpay-crypto.js
// 功能：AES-256-GCM 加密/解密商户敏感密钥
// 主密钥从环境变量 MERCHANT_MASTER_KEY 读取（32字节HEX字符串）

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV_VAR = 'MERCHANT_MASTER_KEY';
const KEY_LENGTH = 32; // 256 bits

// ====== 主密钥管理 ======

let _masterKey = null;

function ensureMasterKey() {
  if (_masterKey) return _masterKey;
  const hexKey = process.env[KEY_ENV_VAR];
  if (!hexKey) {
    throw new Error(
      `环境变量 ${KEY_ENV_VAR} 未设置。\n` +
      `请设置一个 64 位十六进制字符串作为主密钥。\n` +
      `示例: export ${KEY_ENV_VAR}=$(openssl rand -hex 32)`
    );
  }
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${KEY_ENV_VAR} 必须是 64 位十六进制（32字节）`);
  }
  _masterKey = key;
  return _masterKey;
}

// ====== 加密 ======

/**
 * 使用 AES-256-GCM 加密
 * @param {string} plaintext - 明文
 * @returns {string} - base64( iv(12) + authTag(16) + ciphertext )
 */
function encrypt(plaintext) {
  const key = ensureMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 拼装: iv + authTag + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

// ====== 解密 ======

/**
 * 解密
 * @param {string} encryptedBase64 - base64( iv(12) + authTag(16) + ciphertext )
 * @returns {string} - 明文
 */
function decrypt(encryptedBase64) {
  const key = ensureMasterKey();
  const combined = Buffer.from(encryptedBase64, 'base64');
  const iv = combined.slice(0, 12);
  const authTag = combined.slice(12, 28);
  const ciphertext = combined.slice(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

// ====== 掩码工具（用于前端显示） ======

function maskSecret(value) {
  if (!value || value.length <= 8) return '••••••••';
  return '••••••••' + value.slice(-4);
}

module.exports = { encrypt, decrypt, maskSecret, ensureMasterKey };
