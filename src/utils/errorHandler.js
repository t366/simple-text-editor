const { logger } = require('./logger');

function logError(message, error, context = {}, level = 'error') {
  const logData = {
    message,
    error: error.message,
    stack: error.stack,
    ...context
  };

  switch (level) {
    case 'warn':
      logger.warn(message, logData);
      break;
    case 'info':
      logger.info(message, logData);
      break;
    default:
      logger.error(message, logData);
  }
}

function handleFileError(error, operation, context = {}) {
  let message;
  let isExpected = false;

  switch (error.code) {
    case 'ENOENT':
      message = `文件不存在，${operation}操作失败`;
      isExpected = true;
      break;
    case 'EACCES':
      message = `权限不足，${operation}操作失败`;
      break;
    case 'EPERM':
      message = `权限被拒绝，${operation}操作失败`;
      break;
    case 'EISDIR':
      message = `目标是目录，${operation}操作失败`;
      break;
    case 'ENOSPC':
      message = `磁盘空间不足，${operation}操作失败`;
      break;
    default:
      if (error.message && error.message.includes('Unexpected token')) {
        message = `JSON解析错误，${operation}操作失败`;
        isExpected = true;
      } else {
        message = `${operation}操作失败`;
      }
  }

  logError(message, error, context, isExpected ? 'warn' : 'error');
  return isExpected;
}

function generateErrorResponse(message, options = {}) {
  return {
    success: false,
    message,
    errorId: Date.now(),
    ...options
  };
}

function handleSocketError(socket, message, options = {}) {
  try {
    const errorResponse = generateErrorResponse(message, options);
    socket.emit('error', errorResponse);
    logError('向客户端发送错误通知', new Error(message), { socketId: socket.id, errorResponse });
  } catch (emitError) {
    logError('向客户端发送错误通知失败', emitError, { socketId: socket.id, originalMessage: message });
  }
}

function handleTextUpdateError(socket, error, context = {}) {
  logError('处理文本更新时发生错误', error, { socketId: socket.id, ...context });
  handleSocketError(socket, '处理文本更新时发生错误，请重试');
}

function handleTabOperationError(socket, error, operation, context = {}) {
  logError(`处理标签页${operation}时发生错误`, error, { socketId: socket.id, ...context });
  handleSocketError(socket, `处理标签页${operation}时发生错误，请重试`);
}

module.exports = {
  logError,
  handleFileError,
  generateErrorResponse,
  handleSocketError,
  handleTextUpdateError,
  handleTabOperationError
};
