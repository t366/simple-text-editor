const winston = require('winston');
const expressWinston = require('express-winston');
const winstonDailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');
const config = require('../config');

fs.mkdirSync(config.LOGS_DIR, { recursive: true });

const rotateOptions = {
    frequency: 'daily',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    zippedArchive: true,
    dirname: config.LOGS_DIR
};

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { 
        service: 'real-time-editor',
        environment: process.env.NODE_ENV || 'development'
    },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({
                    format: 'HH:mm:ss'
                }),
                winston.format.printf(info => {
                    const { timestamp, level, message, ...meta } = info;
                    const customMeta = Object.fromEntries(
                        Object.entries(meta).filter(([key]) => 
                            !['service', 'environment'].includes(key)
                        )
                    );
                    const metaStr = process.env.NODE_ENV === 'development' && Object.keys(customMeta).length > 0 
                        ? ` ${JSON.stringify(customMeta)}` 
                        : '';
                    return `${timestamp} ${level}: ${message}${metaStr}`;
                })
            )
        }),
        new winstonDailyRotateFile({
            filename: 'error-%DATE%.log',
            level: 'error',
            ...rotateOptions
        }),
        new winstonDailyRotateFile({
            filename: 'combined-%DATE%.log',
            ...rotateOptions
        })
    ]
});

const expressLogger = expressWinston.logger({
    winstonInstance: logger,
    meta: true,
    msg: '{{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
    expressFormat: false,
    colorize: true,
    ignoreRoute: function (req, res) { 
        return /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/.test(req.url);
    },
    dynamicMeta: function(req, res) {
        if (process.env.NODE_ENV === 'development') {
            return {
                clientIp: req.ip,
                userAgent: req.get('User-Agent'),
                requestId: req.headers['x-request-id']
            };
        }
        return {};
    }
});

const expressErrorLogger = expressWinston.errorLogger({
    winstonInstance: logger,
    dynamicMeta: function(req, res, err) {
        return {
            clientIp: req.ip,
            userAgent: req.get('User-Agent'),
            requestId: req.headers['x-request-id'],
            requestUrl: req.url,
            requestMethod: req.method
        };
    }
});

module.exports = {
    logger,
    expressLogger,
    expressErrorLogger
};
