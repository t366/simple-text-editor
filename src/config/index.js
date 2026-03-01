require('dotenv').config();
const path = require('path');
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

function generateSecret() {
    return crypto.randomBytes(64).toString('hex');
}

if (isProduction && !process.env.JWT_SECRET) {
    console.error('\n❌ 错误: 生产环境必须设置 JWT_SECRET 环境变量!');
    console.error('请设置环境变量后重新启动服务器。');
    console.error('生成密钥: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"\n');
    process.exit(1);
}

let JWT_SECRET;
if (process.env.JWT_SECRET) {
    JWT_SECRET = process.env.JWT_SECRET;
} else if (isTest) {
    JWT_SECRET = generateSecret();
} else if (!isProduction) {
    JWT_SECRET = generateSecret();
    console.warn('\n⚠️  警告: 未设置 JWT_SECRET 环境变量，已生成临时开发密钥。');
    console.warn('生产环境请务必设置 JWT_SECRET 环境变量!\n');
}

const corsOrigin = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
    : ['http://localhost', 'http://localhost:3000', 'http://127.0.0.1', 'http://127.0.0.1:3000'];

const corsAllowAll = process.env.CORS_ALLOW_ALL === 'true';

if (isProduction && corsOrigin.includes('*') && !corsAllowAll) {
    console.error('\n❌ 错误: 生产环境不允许 CORS_ORIGIN=* !');
    console.error('请设置具体的允许来源，例如: CORS_ORIGIN=https://yourdomain.com\n');
    console.error('或设置 CORS_ALLOW_ALL=true 允许所有来源（仅限内网部署）\n');
    process.exit(1);
}

const rootDir = path.join(__dirname, '..', '..');

module.exports = {
    PORT: parseInt(process.env.PORT) || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    MAX_USERS: parseInt(process.env.MAX_USERS) || 100,
    MAX_TEXT_SIZE: parseInt(process.env.MAX_TEXT_SIZE) || 1048576,
    CORS_ORIGIN: corsOrigin,
    CORS_ALLOW_ALL: corsAllowAll,
    HOST: process.env.HOST || 'localhost',
    DATA_FILE: path.join(rootDir, 'data', 'shared-text.json'),
    LOGS_DIR: path.join(rootDir, 'logs'),
    PUBLIC_DIR: path.join(__dirname, '..', 'public'),
    DEBOUNCE_DELAY: parseInt(process.env.DEBOUNCE_DELAY) || 500,
    JWT_SECRET: JWT_SECRET,
    JWT_EXPIRY: parseInt(process.env.JWT_EXPIRY) || 1800000,
    SOCKET_RATE_LIMIT_POINTS: parseInt(process.env.SOCKET_RATE_LIMIT_POINTS) || 5,
    SOCKET_RATE_LIMIT_DURATION: parseInt(process.env.SOCKET_RATE_LIMIT_DURATION) || 1
};
