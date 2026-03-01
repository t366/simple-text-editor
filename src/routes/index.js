const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { validateAndCleanUsername, logger } = require('../utils');
const { generateCsrfToken } = require('../middleware');

const alertStatus = {
    highMemory: false,
    highConnections: false,
    slowResponse: false
};

const memoryHistory = [];
const MAX_MEMORY_HISTORY = 100;
const MEMORY_CHECK_INTERVAL = 30000;
const MEMORY_PRESSURE_THRESHOLD = 0.75;
const MEMORY_ALERT_COOLDOWN = 5 * 60 * 1000;

let lastMemoryAlertTime = 0;

function getMemoryPressureLevel() {
    const memory = process.memoryUsage();
    const heapUsageRatio = memory.heapUsed / memory.heapTotal;
    return heapUsageRatio;
}

function cleanupMemoryHistory() {
    if (memoryHistory.length > MAX_MEMORY_HISTORY / 2) {
        memoryHistory.splice(0, Math.floor(memoryHistory.length / 2));
    }
}

const memoryCheckTimer = setInterval(() => {
    const memory = process.memoryUsage();
    const memorySample = {
        timestamp: Date.now(),
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external
    };
    
    memoryHistory.push(memorySample);
    
    if (memoryHistory.length > MAX_MEMORY_HISTORY) {
        memoryHistory.shift();
    }
    
    const pressureLevel = getMemoryPressureLevel();
    const now = Date.now();
    
    if (pressureLevel > MEMORY_PRESSURE_THRESHOLD && 
        now - lastMemoryAlertTime > MEMORY_ALERT_COOLDOWN) {
        logger.warn('内存压力较高，清理历史记录', { 
            heapUsageRatio: pressureLevel.toFixed(2),
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024)
        });
        lastMemoryAlertTime = now;
        cleanupMemoryHistory();
        if (global.gc) {
            global.gc();
        }
    }
}, MEMORY_CHECK_INTERVAL);

if (memoryCheckTimer.unref) {
    memoryCheckTimer.unref();
}

function setupRoutes(app, socketStats) {
    app.get('/', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        
        res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
    });
    
    app.get('/health', (req, res) => {
        const uptime = process.uptime();
        const memory = process.memoryUsage();
        const users = socketStats.getStats().totalUsers;
        
        let status = 'healthy';
        let alerts = [];
        
        const memoryUsagePercent = (memory.rss / (1024 * 1024 * 1024)) * 100;
        if (memoryUsagePercent > 80) {
            status = 'warning';
            alerts.push('High memory usage');
            alertStatus.highMemory = true;
        } else {
            alertStatus.highMemory = false;
        }
        
        const maxUsers = parseInt(process.env.MAX_USERS) || 100;
        if (users > maxUsers * 0.8) {
            status = 'warning';
            alerts.push('High number of connections');
            alertStatus.highConnections = true;
        } else {
            alertStatus.highConnections = false;
        }
        
        res.status(200).json({
            status,
            timestamp: new Date().toISOString(),
            uptime,
            memory: {
                rss: memory.rss,
                heapTotal: memory.heapTotal,
                heapUsed: memory.heapUsed,
                external: memory.external,
                usagePercent: memoryUsagePercent
            },
            users,
            alerts,
            environment: process.env.NODE_ENV
        });
    });
    
    app.get('/stats', (req, res) => {
        const stats = socketStats.getStats();
        const memory = process.memoryUsage();
        const cpu = process.cpuUsage();
        
        let memoryTrend = 0;
        if (memoryHistory.length > 10) {
            const recentSamples = memoryHistory.slice(-10);
            const firstSample = recentSamples[0].heapUsed;
            const lastSample = recentSamples[recentSamples.length - 1].heapUsed;
            
            memoryTrend = ((lastSample - firstSample) / firstSample) * 100;
        }
        
        res.status(200).json({
            ...stats,
            system: {
                memory: {
                    rss: memory.rss,
                    heapTotal: memory.heapTotal,
                    heapUsed: memory.heapUsed,
                    external: memory.external,
                    trend: memoryTrend,
                    history: memoryHistory
                },
                cpu: {
                    user: cpu.user,
                    system: cpu.system
                },
                uptime: process.uptime(),
                platform: process.platform,
                nodeVersion: process.version
            },
            alerts: {
                highMemory: alertStatus.highMemory,
                highConnections: alertStatus.highConnections,
                slowResponse: alertStatus.slowResponse
            }
        });
    });
    
    app.get('/metrics', (req, res) => {
        const memory = process.memoryUsage();
        const stats = socketStats.getStats();
        
        let metrics = `
# HELP editor_connections_active Active connections
# TYPE editor_connections_active gauge
editor_connections_active ${stats.totalUsers}

# HELP editor_connections_total Total connections
# TYPE editor_connections_total counter
editor_connections_total ${stats.totalConnections}

# HELP editor_memory_usage_bytes Memory usage in bytes
# TYPE editor_memory_usage_bytes gauge
editor_memory_usage_bytes{type="rss"} ${memory.rss}
editor_memory_usage_bytes{type="heapTotal"} ${memory.heapTotal}
editor_memory_usage_bytes{type="heapUsed"} ${memory.heapUsed}
editor_memory_usage_bytes{type="external"} ${memory.external}

# HELP editor_server_uptime_seconds Server uptime in seconds
# TYPE editor_server_uptime_seconds gauge
editor_server_uptime_seconds ${process.uptime()}
        `.trim();
        
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(metrics);
    });
    
    app.get('/clear-cache', (req, res) => {
        res.setHeader('Clear-Site-Data', '"cache"');
        res.status(200).send('缓存清除请求已发送');
    });
    
    app.get('/alerts', (req, res) => {
        res.status(200).json({
            status: Object.values(alertStatus).some(Boolean) ? 'warning' : 'ok',
            alerts: alertStatus,
            timestamp: new Date().toISOString()
        });
    });
    
    app.get('/csrf-token', (req, res) => {
        const csrfToken = generateCsrfToken(req, res);
        res.status(200).json({
            csrfToken
        });
    });
    
    app.post('/api/auth/login', (req, res) => {
        try {
            const { username } = req.body;
            
            let validatedUsername = validateAndCleanUsername(username);
            if (!validatedUsername) {
                validatedUsername = `用户${Date.now().toString(36)}`;
            }
            
            const token = jwt.sign(
                { username: validatedUsername, timestamp: Date.now() },
                config.JWT_SECRET,
                { expiresIn: config.JWT_EXPIRY / 1000 }
            );
            
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: config.JWT_EXPIRY,
                path: '/'
            });
            
            logger.info('用户登录成功', { username: validatedUsername });
            
            res.status(200).json({
                success: true,
                username: validatedUsername,
                expiresIn: config.JWT_EXPIRY
            });
        } catch (error) {
            logger.error('登录失败', { error: error.message });
            res.status(500).json({
                success: false,
                message: '登录失败，请重试'
            });
        }
    });
    
    app.post('/api/auth/logout', (req, res) => {
        res.clearCookie('auth_token', {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/'
        });
        
        res.status(200).json({
            success: true,
            message: '已成功登出'
        });
    });
    
    app.get('/api/auth/verify', (req, res) => {
        const token = req.cookies.auth_token;
        
        if (!token) {
            return res.status(401).json({
                success: false,
                authenticated: false,
                message: '未找到认证令牌'
            });
        }
        
        try {
            const decoded = jwt.verify(token, config.JWT_SECRET);
            res.status(200).json({
                success: true,
                authenticated: true,
                username: decoded.username,
                expiresIn: decoded.exp * 1000 - Date.now()
            });
        } catch (error) {
            res.status(401).json({
                success: false,
                authenticated: false,
                message: '令牌无效或已过期'
            });
        }
    });
}

module.exports = setupRoutes;
