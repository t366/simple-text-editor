const { logger, expressLogger, expressErrorLogger } = require('./logger');
const { logError, handleFileError, generateErrorResponse, handleSocketError, handleTextUpdateError, handleTabOperationError } = require('./errorHandler');
const { validateText, validateCursorPosition, validateAndCleanUsername, validateAndCleanTitle, validateTabId, sanitizeText, MAX_TITLE_LENGTH } = require('./validators');

module.exports = {
    logger,
    expressLogger,
    expressErrorLogger,
    logError,
    handleFileError,
    generateErrorResponse,
    handleSocketError,
    handleTextUpdateError,
    handleTabOperationError,
    validateText,
    validateCursorPosition,
    validateAndCleanUsername,
    validateAndCleanTitle,
    validateTabId,
    sanitizeText,
    MAX_TITLE_LENGTH
};
