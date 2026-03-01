const { validateAndCleanUsername, validateCursorPosition, validateAndCleanTitle, validateTabId, logError, handleSocketError, handleTextUpdateError, handleTabOperationError, logger } = require('../utils');
const { generateJWT, validateJWT, authenticateFromCookie } = require('./auth');
const { tabsState, connectedUsers, connectionStats, saveDataDebounced } = require('./dataStore');
const {
    MAX_TEXT_LENGTH,
    getTargetTabId,
    findTabIndex,
    processFullTextUpdate,
    processSmartUpdate,
    processIncrementalUpdate,
    broadcastTextUpdate
} = require('./textProcessor');

function setupConnectionHandlers(io, socket, log) {
    socket.isAuthenticated = false;
    socket.userToken = null;
    socket.username = null;

    connectionStats.total++;
    connectionStats.active++;
    connectionStats.peak = Math.max(connectionStats.peak, connectionStats.active);

    log.info('新的Socket连接', {
        socketId: socket.id,
        clientIp: socket.clientIp || socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        totalActive: connectionStats.active,
        authenticated: socket.isAuthenticated
    });
}

function setupLoginHandler(socket, log) {
    socket.on('login', (username, callback) => {
        try {
            let validatedUsername = validateAndCleanUsername(username);

            if (!validatedUsername) {
                validatedUsername = `用户${socket.id.substring(0, 4)}`;
            }

            const token = generateJWT(validatedUsername, socket.id, log);

            if (!token) {
                logError('无法生成JWT token，用户登录失败', new Error('JWT_SECRET未配置'), {
                    socketId: socket.id,
                    username: validatedUsername
                });

                if (callback) {
                    callback({ success: false, message: '服务器配置错误' });
                }
                return;
            }

            socket.isAuthenticated = true;
            socket.userToken = token;

            log.info('用户登录成功', {
                socketId: socket.id,
                username: validatedUsername
            });

            if (callback) {
                callback({ success: true, token, username: validatedUsername });
            }
        } catch (error) {
            logError('处理用户登录请求失败', error, { socketId: socket.id, username });
            if (callback) {
                callback({ success: false, message: '登录失败，请重试' });
            }
        }
    });
}

function setupJoinHandler(io, socket, log) {
    socket.on('join', ({ username, token }) => {
        try {
            let validatedUsername = socket.username;

            if (!socket.isAuthenticated) {
                authenticateFromCookie(socket, log);
            }

            if (!socket.isAuthenticated && username) {
                validatedUsername = validateAndCleanUsername(username);
                if (validatedUsername) {
                    socket.isAuthenticated = true;
                    socket.username = validatedUsername;
                    log.info('用户通过用户名加入', {
                        socketId: socket.id,
                        username: validatedUsername
                    });
                }
            }

            if (!socket.isAuthenticated) {
                logError('未认证用户尝试加入', new Error('未认证'), {
                    socketId: socket.id
                }, 'warn');
                handleSocketError(socket, '请先登录');
                return;
            }

            if (!validatedUsername && username) {
                validatedUsername = validateAndCleanUsername(username);
            }

            if (!validatedUsername) {
                validatedUsername = `用户${socket.id.substring(0, 4)}`;
            }

            socket.username = validatedUsername;

            const userInfo = {
                id: socket.id,
                name: validatedUsername,
                device: socket.handshake.headers['user-agent']?.includes('Mobile') ? '📱' : '💻'
            };
            connectedUsers.set(socket.id, userInfo);

            socket.emit('tabs-sync', tabsState.tabs);
            socket.emit('user-list', Array.from(connectedUsers.values()));

            io.emit('user-joined', userInfo);
            io.emit('user-list', Array.from(connectedUsers.values()));

            log.info('用户加入成功', {
                socketId: socket.id,
                username: validatedUsername
            });
        } catch (error) {
            logError('处理用户加入请求失败', error, { socketId: socket.id, username, token });
            handleSocketError(socket, '加入失败，请重试');
        }
    });
}

function checkAuth(socket, eventName, log) {
    if (!socket.isAuthenticated) {
        log.warn('未认证用户尝试发送事件', { socketId: socket.id, event: eventName });
        return false;
    }
    return true;
}

function setupTextUpdateHandler(io, socket, log) {
    socket.on('text-update', async (data) => {
        if (!checkAuth(socket, 'text-update', log)) return;

        try {
            const targetTabId = getTargetTabId(data, tabsState);
            const targetTabIndex = findTabIndex(targetTabId, tabsState);

            if (targetTabIndex === -1) {
                logError('未找到指定的标签页', new Error('标签页不存在'), {
                    socketId: socket.id,
                    tabId: targetTabId
                }, 'warn');
                return;
            }

            let currentText = tabsState.tabs[targetTabIndex].content;
            let updateType = 'full';
            let updatedText = currentText;

            if (typeof data === 'string') {
                updatedText = processFullTextUpdate(data);
            } else if (typeof data === 'object') {
                const updateData = data.diff || data;

                if (updateData.diffs || data.diffs) {
                    const result = processSmartUpdate(updateData.diffs || data.diffs, currentText, socket.id, targetTabId, log);
                    updatedText = result.text;
                    updateType = result.updateType;
                } else if (updateData.start !== undefined && updateData.end !== undefined) {
                    const result = processIncrementalUpdate(updateData, currentText, socket.id, targetTabId, log);
                    updatedText = result.text;
                    updateType = result.updateType;
                } else if (data.fullText) {
                    updatedText = processFullTextUpdate(data.fullText);
                } else {
                    updateType = 'unchanged';
                }
            }

            if (updatedText === currentText || updateType === 'unchanged') {
                return;
            }

            if (updatedText.length > MAX_TEXT_LENGTH) {
                logError('文本长度超过限制，拒绝更新', new Error('文本长度超过限制'), {
                    socketId: socket.id,
                    tabId: targetTabId,
                    length: updatedText.length,
                    limit: MAX_TEXT_LENGTH
                }, 'warn');
                handleSocketError(socket, '文本内容过长，无法保存');
                return;
            }

            tabsState.tabs[targetTabIndex].content = updatedText;
            tabsState.tabs[targetTabIndex].lastEdited = Date.now();

            saveDataDebounced(log);
            broadcastTextUpdate(io, targetTabId, data, updatedText, socket.id, updateType, log);
        } catch (error) {
            handleTextUpdateError(socket, error, {
                dataType: typeof data,
                tabId: getTargetTabId(data, tabsState) || 'unknown'
            });
        }
    });
}

function setupCursorHandler(socket, log) {
    socket.on('cursor-update', (data) => {
        if (!checkAuth(socket, 'cursor-update', log)) return;

        const cursorPos = typeof data === 'object' ? data.position : data;
        const tabId = typeof data === 'object' ? data.tabId : null;

        if (validateCursorPosition(cursorPos)) {
            socket.broadcast.emit('user-cursor', {
                userId: socket.id,
                position: cursorPos,
                tabId: tabId,
                name: connectedUsers.get(socket.id)?.name
            });
        }
    });
}

function setupTabHandlers(io, socket, log) {
    socket.on('tab-create', (tabData) => {
        if (!checkAuth(socket, 'tab-create', log)) return;

        try {
            if (!tabData || typeof tabData !== 'object') {
                logError('无效的标签页数据', new Error('无效的标签页数据'), {
                    socketId: socket.id,
                    tabData
                }, 'warn');
                return;
            }

            if (!validateTabId(tabData.id)) {
                logError('无效的标签页ID格式', new Error('无效的标签页ID'), {
                    socketId: socket.id,
                    tabId: tabData.id
                }, 'warn');
                return;
            }

            tabsState.tabCounter++;

            const newTab = {
                id: tabData.id,
                title: validateAndCleanTitle(tabData.title),
                content: tabData.content || '',
                lastEdited: Date.now()
            };

            tabsState.tabs.push(newTab);
            saveDataDebounced(log);
            io.emit('tab-create', newTab);

            log.info('标签页创建成功', {
                socketId: socket.id,
                tabId: newTab.id,
                title: newTab.title
            });
        } catch (error) {
            handleTabOperationError(socket, error, '创建', { tabData });
        }
    });

    socket.on('tab-close', (data) => {
        if (!checkAuth(socket, 'tab-close', log)) return;

        try {
            const { tabId } = data;
            
            if (!validateTabId(tabId)) {
                logError('无效的标签页ID格式', new Error('无效的标签页ID'), {
                    socketId: socket.id,
                    tabId
                }, 'warn');
                return;
            }
            
            const tabIndex = tabsState.tabs.findIndex(tab => tab.id === tabId);

            if (tabIndex === -1) {
                logError('未找到要关闭的标签页', new Error('未找到标签页'), {
                    socketId: socket.id,
                    tabId
                }, 'warn');
                return;
            }

            if (tabsState.tabs.length <= 1) {
                logError('尝试关闭最后一个标签页，操作被拒绝', new Error('最后一个标签页无法关闭'), {
                    socketId: socket.id,
                    tabId
                }, 'warn');
                return;
            }

            tabsState.tabs.splice(tabIndex, 1);
            saveDataDebounced(log);
            io.emit('tab-close', { tabId });

            log.info('标签页关闭成功', {
                socketId: socket.id,
                tabId
            });
        } catch (error) {
            handleTabOperationError(socket, error, '关闭', { tabId: data.tabId });
        }
    });

    socket.on('tab-rename', (data) => {
        if (!checkAuth(socket, 'tab-rename', log)) return;

        try {
            const { tabId, newTitle } = data;
            
            if (!validateTabId(tabId)) {
                logError('无效的标签页ID格式', new Error('无效的标签页ID'), {
                    socketId: socket.id,
                    tabId
                }, 'warn');
                return;
            }
            
            const tabIndex = tabsState.tabs.findIndex(tab => tab.id === tabId);

            if (tabIndex === -1) {
                logError('未找到要重命名的标签页', new Error('未找到标签页'), {
                    socketId: socket.id,
                    tabId
                }, 'warn');
                return;
            }

            const sanitizedTitle = validateAndCleanTitle(newTitle);
            tabsState.tabs[tabIndex].title = sanitizedTitle;
            tabsState.tabs[tabIndex].lastEdited = Date.now();
            saveDataDebounced(log);
            io.emit('tab-rename', { tabId, newTitle: sanitizedTitle });

            log.info('标签页重命名成功', {
                socketId: socket.id,
                tabId,
                newTitle: sanitizedTitle
            });
        } catch (error) {
            handleTabOperationError(socket, error, '重命名', { tabId: data.tabId, newTitle: data.newTitle });
        }
    });

    socket.on('tab-switch', (data) => {
        if (!checkAuth(socket, 'tab-switch', log)) return;

        try {
            const { newTabId } = data;
            
            if (!validateTabId(newTabId)) {
                logError('无效的标签页ID格式', new Error('无效的标签页ID'), {
                    socketId: socket.id,
                    newTabId
                }, 'warn');
                return;
            }
            
            const tabIndex = tabsState.tabs.findIndex(tab => tab.id === newTabId);

            if (tabIndex === -1) {
                logError('未找到要切换到的标签页', new Error('未找到标签页'), {
                    socketId: socket.id,
                    newTabId
                }, 'warn');
                return;
            }

            socket.broadcast.emit('tab-switch', { newTabId });

            log.info('标签页切换事件广播成功', {
                socketId: socket.id,
                newTabId
            });
        } catch (error) {
            handleTabOperationError(socket, error, '切换', { newTabId: data.newTabId });
        }
    });
}

function setupDisconnectHandler(io, socket, log) {
    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            connectedUsers.delete(socket.id);
            connectionStats.active--;
            io.emit('user-left', socket.id);
            io.emit('user-list', Array.from(connectedUsers.values()));
            log.info('用户断开连接', { userId: socket.id, name: user.name });
        } else {
            connectionStats.active--;
        }

        log.info('Socket连接关闭', { socketId: socket.id, totalActive: connectionStats.active });
    });
}

module.exports = {
    setupConnectionHandlers,
    setupLoginHandler,
    setupJoinHandler,
    setupTextUpdateHandler,
    setupCursorHandler,
    setupTabHandlers,
    setupDisconnectHandler
};
