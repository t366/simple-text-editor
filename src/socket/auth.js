const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const config = require('../config');

function generateJWT(username, socketId, log) {
    if (!config.JWT_SECRET) {
        log.error('JWT_SECRET未配置，无法生成token');
        return null;
    }

    return jwt.sign(
        { username, socketId, timestamp: Date.now() },
        config.JWT_SECRET,
        { expiresIn: config.JWT_EXPIRY / 1000 }
    );
}

function validateJWT(token, log) {
    if (!token) {
        log.warn('Token为空', { token });
        return false;
    }

    if (!config.JWT_SECRET) {
        log.error('JWT_SECRET未配置，无法验证token');
        return false;
    }

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        log.info('Token验证成功', { decoded });
        return decoded;
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            log.warn('Token已过期', { token });
        } else if (error.name === 'JsonWebTokenError') {
            log.warn('Token无效', { token, error: error.message });
        } else {
            log.error('Token验证失败', { token, error: error.message });
        }
        return false;
    }
}

function authenticateFromCookie(socket, log) {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader) return false;

    try {
        const cookies = cookie.parse(cookieHeader);
        const token = cookies.auth_token;

        if (token) {
            const decoded = validateJWT(token, log);
            if (decoded) {
                socket.isAuthenticated = true;
                socket.userToken = token;
                socket.username = decoded.username;
                log.info('通过 Cookie 自动认证成功', {
                    socketId: socket.id,
                    username: decoded.username
                });
                return true;
            }
        }
    } catch (cookieError) {
        log.warn('解析 Cookie 失败', {
            socketId: socket.id,
            error: cookieError.message
        });
    }
    return false;
}

module.exports = {
    generateJWT,
    validateJWT,
    authenticateFromCookie
};
