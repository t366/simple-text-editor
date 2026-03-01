const { tabsState, connectedUsers, serverStartTime, connectionStats, loadSavedData, saveDataDebounced, flushData, createBackup, listBackups, restoreBackup, startAutoBackup, stopAutoBackup, BACKUP_DIR } = require('./dataStore');
const { generateJWT, validateJWT, authenticateFromCookie } = require('./auth');
const { setupConnectionHandlers, setupLoginHandler, setupJoinHandler, setupTextUpdateHandler, setupCursorHandler, setupTabHandlers, setupDisconnectHandler } = require('./eventHandlers');

module.exports = {
    tabsState,
    connectedUsers,
    serverStartTime,
    connectionStats,
    loadSavedData,
    saveDataDebounced,
    flushData,
    createBackup,
    listBackups,
    restoreBackup,
    startAutoBackup,
    stopAutoBackup,
    BACKUP_DIR,
    generateJWT,
    validateJWT,
    authenticateFromCookie,
    setupConnectionHandlers,
    setupLoginHandler,
    setupJoinHandler,
    setupTextUpdateHandler,
    setupCursorHandler,
    setupTabHandlers,
    setupDisconnectHandler
};
