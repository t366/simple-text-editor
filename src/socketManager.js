const { RateLimiterMemory } = require('rate-limiter-flexible');
const config = require('./config');
const { logger } = require('./utils');
const {
    tabsState,
    connectedUsers,
    serverStartTime,
    connectionStats,
    loadSavedData,
    flushData,
    startAutoBackup,
    authenticateFromCookie,
    setupConnectionHandlers,
    setupLoginHandler,
    setupJoinHandler,
    setupTextUpdateHandler,
    setupCursorHandler,
    setupTabHandlers,
    setupDisconnectHandler
} = require('./socket');

const socketRateLimiter = new RateLimiterMemory({
    points: config.SOCKET_RATE_LIMIT_POINTS,
    duration: config.SOCKET_RATE_LIMIT_DURATION,
});

const messageRateLimiter = new RateLimiterMemory({
    points: 30,
    duration: 1,
});

const connectionTracker = new Map();
const MAX_CONNECTIONS_PER_IP = 10;

function getClientIp(socket) {
    return socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() 
        || socket.handshake.address 
        || 'unknown';
}

async function checkRateLimit(socket, limiter, key = null) {
    const clientIp = key || getClientIp(socket);
    try {
        await limiter.consume(clientIp);
        return true;
    } catch (rejRes) {
        const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
        socket.emit('rate-limit-exceeded', {
            message: '请求过于频繁，请稍后再试',
            retryAfter: secs
        });
        return false;
    }
}

function decrementConnectionCount(socket) {
    const clientIp = socket.clientIp || getClientIp(socket);
    const currentCount = connectionTracker.get(clientIp) || 0;
    if (currentCount > 1) {
        connectionTracker.set(clientIp, currentCount - 1);
    } else {
        connectionTracker.delete(clientIp);
    }
}

function setupSocketIO(io, log) {
    const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

    if (!isTestEnvironment) {
        (async () => {
            try {
                await loadSavedData(log);
                log.info('初始数据加载完成');
                startAutoBackup(log);
            } catch (error) {
                log.error('加载初始数据失败', { error: error.message, stack: error.stack });
            }
        })();
    }

    io.use(async (socket, next) => {
        const clientIp = getClientIp(socket);
        
        const currentCount = connectionTracker.get(clientIp) || 0;
        if (currentCount >= MAX_CONNECTIONS_PER_IP) {
            log.warn('连接数超过限制，拒绝连接', { 
                clientIp, 
                currentCount,
                maxAllowed: MAX_CONNECTIONS_PER_IP 
            });
            return next(new Error('连接数超过限制'));
        }

        if (!isTestEnvironment) {
            const allowed = await checkRateLimit(socket, socketRateLimiter, clientIp);
            if (!allowed) {
                log.warn('Socket.IO速率限制触发', { clientIp });
                return next(new Error('请求过于频繁'));
            }
        }

        connectionTracker.set(clientIp, currentCount + 1);
        socket.clientIp = clientIp;
        
        next();
    });

    io.on('connection', (socket) => {
        setupConnectionHandlers(io, socket, log);
        authenticateFromCookie(socket, log);

        setupLoginHandler(socket, log);
        setupJoinHandler(io, socket, log);
        setupTextUpdateHandler(io, socket, log);
        setupCursorHandler(socket, log);
        setupTabHandlers(io, socket, log);
        
        socket.on('disconnect', () => {
            decrementConnectionCount(socket);
        });
        
        setupDisconnectHandler(io, socket, log);
    });

    return {
        getStats: () => ({
            totalUsers: connectedUsers.size,
            activeRooms: 1,
            serverStartTime,
            totalConnections: connectionStats.total,
            environment: process.env.NODE_ENV,
            activeIps: connectionTracker.size
        }),
        flushData: () => flushData(log)
    };
}

module.exports = setupSocketIO;
