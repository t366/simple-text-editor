# 简记 · 实时协作编辑器

一个功能强大的实时协作文本编辑器，支持多人同时编辑、多标签页管理、Markdown 预览和数据持久化。

## ✨ 特性

- **实时协作**：基于 Socket.IO，支持多人同时在线编辑同一文档
- **增量同步**：使用 diff-match-patch 算法，仅传输变更内容，高效且节省带宽
- **协作光标**：实时显示其他用户的光标位置和名称，支持自动换行和精确定位
- **多标签页**：支持创建、切换、关闭、重命名多个文档标签页
- **Markdown 预览**：内置 Markdown 实时预览功能，支持左右分栏显示
- **数据持久化**：文档内容自动保存到服务器本地文件，支持自动备份
- **响应式设计**：完美适配桌面端和移动端设备，支持暗色模式
- **安全防护**：JWT 认证、CSRF 保护、XSS 防护、速率限制、输入验证

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 运行服务器

**开发模式：**

```bash
npm run dev
```

**生产模式：**

```bash
npm start
```

服务器默认运行在 `http://localhost:3000`。

### 3. 环境变量配置

创建 `.env` 文件（可选）：

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=1800000
CORS_ORIGIN=https://yourdomain.com
MAX_USERS=100
MAX_TEXT_SIZE=1048576
```

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 后端框架 | Node.js, Express |
| 实时通信 | Socket.IO |
| 认证授权 | JWT (jsonwebtoken) |
| 安全防护 | Helmet, CSRF-CSRF, validator, sanitize-html |
| 速率限制 | rate-limiter-flexible, express-rate-limit |
| 日志系统 | Winston, winston-daily-rotate-file |
| 前端 | 原生 JavaScript (ES Modules), CSS3 Variables |
| 差分算法 | diff-match-patch (Google) |
| Markdown | marked, DOMPurify |
| 测试 | Jest, Supertest |

## 🐳 Docker 部署

### 使用 Docker Compose（推荐）

```bash
docker-compose up -d
```

服务将在 `http://localhost:3300` 启动。

### 手动构建镜像

```bash
docker build -t real-time-editor .
docker run -d -p 3000:3000 \
  -e JWT_SECRET=your-secret-key \
  -v $(pwd)/data:/app/data \
  real-time-editor
```

### Docker 镜像特点

- 基于 Alpine Linux，镜像体积约 70-80MB
- 多阶段构建，仅包含运行时必需文件
- 内置 tini 进程管理，支持优雅关闭
- 内存限制 256MB

## 📁 目录结构

```
src/
├── config/                 # 配置管理
│   └── index.js            # 环境变量和配置项
├── middleware/             # Express 中间件
│   └── index.js            # CORS、Helmet、速率限制、CSRF
├── routes/                 # Express 路由
│   └── index.js            # API 路由定义
├── socket/                 # Socket.IO 模块
│   ├── auth.js             # JWT 认证逻辑
│   ├── dataStore.js        # 数据存储和持久化
│   ├── eventHandlers.js    # Socket 事件处理
│   ├── index.js            # 模块导出
│   └── textProcessor.js    # 文本处理工具
├── utils/                  # 工具函数
│   ├── errorHandler.js     # 统一错误处理
│   ├── logger.js           # Winston 日志配置
│   ├── validators.js       # 输入验证和清理
│   └── index.js            # 模块导出
├── public/                 # 静态资源
│   ├── index.html          # 主 HTML 文件
│   ├── css/
│   │   └── style.css       # 样式文件
│   └── js/
│       ├── libs/           # 第三方库（本地化）
│       │   ├── socket.io.min.js
│       │   ├── diff-match-patch.js
│       │   ├── marked.min.js
│       │   └── purify.min.js
│       └── modules/        # 前端模块
│           ├── app.js      # 主应用逻辑
│           ├── cursor.js   # 光标管理
│           ├── notifications.js  # 通知系统
│           ├── users.js    # 用户列表
│           └── utils.js    # 工具函数
├── server.js               # 服务器入口文件
└── socketManager.js        # Socket.IO 管理

data/                       # 数据存储目录（自动创建）
├── shared-text.json        # 文档数据
└── backups/                # 自动备份目录

logs/                       # 日志文件目录（自动创建）
├── combined-YYYY-MM-DD.log
└── error-YYYY-MM-DD.log

tests/                      # 测试用例
└── server.test.js
```

## 📡 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查 |
| GET | /stats | 服务器统计信息 |
| GET | /metrics | 性能指标 |
| GET | /api/auth/token | 获取 CSRF 令牌 |
| POST | /api/auth/login | 用户登录 |

## 🔌 Socket.IO 事件

### 客户端发送

| 事件 | 说明 |
|------|------|
| login | 用户登录 |
| join | 加入文档房间 |
| text-update | 文本更新 |
| cursor-update | 光标位置更新 |
| tab-switch | 切换标签页 |
| tab-create | 创建新标签页 |
| tab-close | 关闭标签页 |
| tab-rename | 重命名标签页 |

### 服务器推送

| 事件 | 说明 |
|------|------|
| text-update | 文本更新广播 |
| cursor-update | 光标更新广播 |
| user-list | 用户列表更新 |
| tab-list | 标签页列表更新 |
| rate-limit-exceeded | 速率限制触发 |

## 🔒 安全特性

- **JWT 认证**：基于 Token 的用户认证，支持过期时间
- **CSRF 保护**：双重令牌机制防止跨站请求伪造
- **XSS 防护**：前端 DOMPurify + 后端 sanitize-html
- **速率限制**：连接限制、消息限制、API 限制
- **输入验证**：用户名、标题、文本内容验证和清理
- **安全头**：Helmet 中间件设置 HTTP 安全头
- **CORS 配置**：支持白名单配置

## 📝 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+S | 保存到本地文件 |
| Ctrl+D | 清空文档内容 |
| Ctrl+T | 新建标签页 |
| Ctrl+W | 关闭当前标签页 |
| Ctrl+B | 粗体格式 |
| Ctrl+I | 斜体格式 |
| Ctrl+U | 下划线格式 |

## 🧪 测试

```bash
npm test
```

## 📄 许可证

MIT License
