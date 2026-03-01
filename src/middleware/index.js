const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const config = require('../config');
const { logger, expressLogger, expressErrorLogger, logError } = require('../utils');

const corsOptions = {
    origin: function (origin, callback) {
        if (config.CORS_ALLOW_ALL) {
            callback(null, true);
            return;
        }
        const allowedOrigins = config.CORS_ORIGIN;
        if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed))) {
            callback(null, true);
        } else {
            logger.warn('CORS 阻止来自未授权来源的请求', { origin });
            callback(new Error('未授权的来源'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    optionsSuccessStatus: 200,
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-CSRF-Token', 'x-csrf-token']
};

const socketCorsOptions = config.CORS_ALLOW_ALL 
    ? {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true
    }
    : {
        origin: (origin, callback) => {
            if (!origin || config.CORS_ORIGIN.some(allowed => origin.startsWith(allowed))) {
                callback(null, true);
            } else {
                logger.warn('Socket.IO CORS 阻止来自未授权来源的连接', { origin });
                callback(new Error('未授权的来源'));
            }
        },
        methods: ['GET', 'POST'],
        credentials: true
    };

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        error: '请求过于频繁，请稍后再试',
        retryAfter: 15 * 60
    },
    standardHeaders: true,
    legacyHeaders: false
});

const helmetConfig = {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    frameguard: {
        action: 'deny'
    },
    hsts: false,
    noSniff: true,
    originAgentCluster: false,
    permittedCrossDomainPolicies: {
        permittedPolicies: 'none'
    },
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
    },
    xssFilter: true
};

const {
    generateToken,
    doubleCsrfProtection
} = doubleCsrf({
    getSecret: () => config.JWT_SECRET,
    cookieName: 'x-csrf-token',
    cookieOptions: {
        sameSite: 'lax',
        path: '/',
        secure: false,
        httpOnly: true,
        maxAge: 86400000
    },
    size: 64,
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
});

const csrfProtection = (req, res, next) => {
    const skipPaths = ['/api/auth/login', '/api/auth/logout'];
    if (skipPaths.includes(req.path)) {
        return next();
    }
    return doubleCsrfProtection(req, res, next);
};

function setupMiddleware(app) {
    app.set('etag', false);
    app.set('trust proxy', 1);

    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    app.use(helmet(helmetConfig));
    app.use(cors(corsOptions));
    app.use(cookieParser());
    app.use(compression());
    app.use('/api/', limiter);
    app.use(expressLogger);

    app.use((req, res, next) => {
        if (req.url === '/' || req.url.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
        next();
    });

    app.use(express.static(config.PUBLIC_DIR, {
        etag: false,
        lastModified: false,
        setHeaders: (res, filePath) => {
            res.removeHeader('X-Powered-By');
            
            if (filePath.endsWith('.html')) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            } else if (filePath.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=86400');
            } else if (filePath.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=86400');
            }
        }
    }));

    app.use(csrfProtection);
}

function setupErrorHandling(app) {
    app.use(expressErrorLogger);

    app.use((req, res) => {
        res.status(404).json({
            error: '未找到请求的资源'
        });
    });

    app.use((err, req, res, next) => {
        const isProduction = config.NODE_ENV === 'production';
        
        if (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf')) {
            logError('CSRF令牌验证失败', err, {
                path: req.path,
                method: req.method,
                ip: req.ip
            }, 'warn');
            
            return res.status(403).json({
                error: '安全验证失败，请刷新页面重试'
            });
        }
        
        if (err.message === '未授权的来源') {
            logError('CORS验证失败', err, {
                path: req.path,
                origin: req.headers.origin
            }, 'warn');
            
            return res.status(403).json({
                error: '未授权的来源'
            });
        }
        
        logError('未处理的错误', err, {
            path: req.path,
            method: req.method,
            body: isProduction ? undefined : req.body,
            query: isProduction ? undefined : req.query
        });
        
        const errorResponse = {
            error: '服务器内部错误',
            requestId: req.headers['x-request-id'] || Date.now().toString(36)
        };
        
        if (!isProduction) {
            errorResponse.message = err.message;
            errorResponse.path = req.path;
        }
        
        res.status(500).json(errorResponse);
    });
}

module.exports = {
    cors: cors(corsOptions),
    helmet: helmet(helmetConfig),
    compression: compression(),
    limiter,
    cookieParser: cookieParser(),
    csrfProtection,
    generateCsrfToken: generateToken,
    corsOptions,
    socketCorsOptions,
    setupMiddleware,
    setupErrorHandling
};
