const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const moment = require('moment');

const config = require('./config');
const { logger } = require('./utils');
const middleware = require('./middleware');
const setupRoutes = require('./routes');
const setupSocketIO = require('./socketManager');

const app = express();
const server = http.createServer(app);

middleware.setupMiddleware(app);

logger.info('初始化 Socket.IO...');
let io;
let socketStats;

try {
  io = socketIo(server, {
    cors: middleware.socketCorsOptions,
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    connectTimeout: 45000,
    allowEIO3: true,
    serveClient: false
  });
  logger.info('Socket.IO 初始化成功');

  logger.info('设置 Socket.IO 事件处理...');
  try {
    socketStats = setupSocketIO(io, logger);
    logger.info('Socket.IO 事件处理设置成功');
  } catch (error) {
    logger.error('Socket.IO 事件处理设置失败', { error: error.message, stack: error.stack });
    process.exit(1);
  }
} catch (error) {
  logger.error('Socket.IO 初始化失败', { error: error.message, stack: error.stack });
  process.exit(1);
}

logger.info('设置路由...');
try {
  setupRoutes(app, socketStats);
  logger.info('路由设置成功');
} catch (error) {
  logger.error('路由设置失败', { error: error.message, stack: error.stack });
  process.exit(1);
}

middleware.setupErrorHandling(app);

function getLocalIP() {
  const interfaces = require('os').networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function gracefulShutdown(signal) {
  logger.info(`收到${signal}信号，正在优雅关闭服务器...`);
  
  const shutdownTimeout = setTimeout(() => {
    logger.error('服务器关闭超时，强制退出');
    process.exitCode = 1;
    process.exit();
  }, 10000);
  
  const performShutdown = () => {
    try {
      io.emit('server-shutdown', {
        message: '服务器即将维护，请保存您的工作',
        restartIn: 60
      });
      
      server.close((err) => {
        clearTimeout(shutdownTimeout);
        
        if (err) {
          logger.error('关闭服务器时发生错误', { error: err.message });
          process.exitCode = 1;
        } else {
          logger.info('HTTP服务器已关闭');
        }
        
        io.close(() => {
          logger.info('Socket.IO服务器已关闭');
          logger.info('服务器已完全关闭');
          process.exit();
        });
      });
    } catch (error) {
      clearTimeout(shutdownTimeout);
      logger.error('优雅关闭过程中发生错误', { error: error.message });
      process.exitCode = 1;
      process.exit();
    }
  };

  if (socketStats && typeof socketStats.flushData === 'function') {
    socketStats.flushData().then(() => {
      logger.info('已在关闭前保存当前文档内容');
      performShutdown();
    }).catch((error) => {
      logger.error('关闭前保存文档内容失败', { error: error.message });
      performShutdown();
    });
  } else {
    performShutdown();
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常', { error: error.message, stack: error.stack });
  gracefulShutdown('uncaught-exception');
});

process.on('unhandledRejection', (reason, promise) => {
  const errorInfo = reason instanceof Error 
    ? { error: reason.message, stack: reason.stack }
    : { error: String(reason) };
  logger.error('未处理的 Promise 拒绝', errorInfo);
  gracefulShutdown('unhandled-rejection');
});

if (require.main === module) {
  server.listen(config.PORT, () => {
    logger.info('实时文本编辑器服务器已启动', {
      port: config.PORT,
      environment: config.NODE_ENV,
      maxUsers: config.MAX_USERS,
      startTime: socketStats.getStats().serverStartTime
    });
    
    console.log(`
   🚀 实时文本编辑器服务器已启动!
   
   环境: ${config.NODE_ENV}
   端口: ${config.PORT}
   地址: http://localhost:${config.PORT}
   网络地址: http://${getLocalIP()}:${config.PORT}
   
   健康检查: http://localhost:${config.PORT}/health
   统计信息: http://localhost:${config.PORT}/stats
   清除缓存: http://localhost:${config.PORT}/clear-cache
   
   最大用户数: ${config.MAX_USERS}
   启动时间: ${moment(socketStats.getStats().serverStartTime).format('YYYY-MM-DD HH:mm:ss')}
  `);
  });
}

module.exports = { app, server, io };
