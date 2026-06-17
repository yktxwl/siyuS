<p align="center">
  <img src="https://raw.githubusercontent.com/yktxwl/siyuS/main/screenshot.png" alt="寺语S" width="800">
</p>

<h1 align="center">🛕 寺语S · 智慧寺院管理平台</h1>

<p align="center">
  <strong>一方净土，万般自在</strong>
  <br>
  为寺庙提供数字化导览、在线祈福、功德捐赠与智慧大屏的整体解决方案
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Express-4.18-000000?style=flat&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/微信支付-V3-07C160?style=flat&logo=wechat&logoColor=white" alt="微信支付">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
</p>

---

## ✨ 功能特性

### 🙏 信众端（手机 / 触摸屏）

| 模块 | 说明 |
|------|------|
| 🗺️ **寺院导览** | 按区域与殿堂层级展示，关联佛像浏览 |
| 🙏 **在线供奉** | 供灯、供花、供果、供香，多档位金额选择 |
| 📿 **牌位登记** | 往生牌位 / 延生牌位，年限可选，微信支付 |
| 🕊️ **放生护生** | 锦鲤、鸟、龟、泥鳅等在线放生 |
| ❤️ **行善功德** | 寺庙修缮、经书助印、斋僧供众、佛像贴金等，含进度条与功德榜 |
| 🎊 **法会活动** | 法会展示与在线报名，支持人数限制 |
| 🛍️ **文创商城** | 念珠、香品、供具、经书、文创、饰品等分类 |
| 📱 **二维码导览** | 每尊佛像/殿堂生成专属二维码，扫码直达 |

### 🖥️ 智慧大屏

- 自动适配 PC 显示器（横屏），触摸友好
- 导览参拜 → 在线供奉 → 扫码支付完整闭环
- 牌位登记、放生护生、行善功德、法会活动一站式操作
- 支付时屏幕弹出收款二维码，信众手机扫码完成支付
- 🏆 功德榜实时排名

### 🔧 管理后台

- **平台管理**：多寺庙管理、支付配置、管理员、渠道设置
- **寺庙管理**：佛像/功德/法会/商城/公告/会员/订单/素材库 CRUD
- **支付管理**：订单查询、退款、对账
- **素材库**：图片/视频上传与分类，支持 COS 存储

### 💰 微信支付

- 支持 JSAPI / H5 / NATIVE / 小程序四种交易类型
- 统一下单 → 支付回调 → 订单查询 → 退款 → 对账完整闭环
- 商户密钥加密存储

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **npm** ≥ 9

### 1. 克隆项目

```bash
git clone git@github.com:yktxwl/siyuS.git
cd siyuS
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入微信支付商户号、APIv3 密钥等
```

### 4. 启动服务

```bash
npm start
```

服务默认运行在 `http://localhost:3000`

### 5. 访问页面

| 页面 | 地址 | 说明 |
|------|------|------|
| 寺庙前端 | `http://localhost:3000/t/dajue` | 信众访问（默认寺庙：大觉禅寺） |
| 大屏展示 | `http://localhost:3000/screen/dajue` | 寺院触摸屏 |
| 平台管理 | `http://localhost:3000/admin` | 总平台后台 |
| 寺庙管理 | `http://localhost:3000/admin/dajue` | 单寺庙后台 |

> 默认登录账号：`admin` / `dajue`，密码：`123456`

---

## 📁 项目结构

```
寺语S/
├── server.js                 # 主服务入口
├── package.json
├── .env.example              # 环境变量模板
├── admin/                    # 管理后台页面
│   ├── platform.html         # 平台总管理
│   └── temple.html           # 寺庙管理
├── miniprogram/              # 前端页面（信众端）
│   ├── index.html            # 页面入口
│   ├── js/app.js             # 前端逻辑
│   └── css/style.css         # 样式
├── public/                   # 公共页面
│   └── screen.html           # 智慧大屏
├── data/                     # JSON 数据存储
│   ├── platform.json         # 平台配置
│   └── temples/              # 各寺庙数据
├── lib/                      # 支付模块
│   ├── wxpay-core.js         # 微信支付核心
│   ├── wxpay-crypto.js       # 加解密
│   └── wxpay-reconciliation.js # 对账
└── uploads/                  # 素材上传目录
```

---

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + Express |
| 前端 | 原生 HTML/CSS/JavaScript（SPA） |
| 数据 | JSON 文件存储 |
| 支付 | 微信支付 APIv3 |
| 存储 | 本地 + 腾讯云 COS |

---

## 📄 License

MIT © 寺语S

---

<p align="center">
  <sub>Made with 🙏 for temples worldwide</sub>
</p>
