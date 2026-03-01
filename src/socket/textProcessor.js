const DiffMatchPatch = require('diff-match-patch');
const { validateText, sanitizeText, logError } = require('../utils');

const dmp = new DiffMatchPatch();
const MAX_TEXT_LENGTH = 1024 * 1024;

function getTargetTabId(data, tabsState) {
    return data.tabId || tabsState.tabs[0]?.id || 'tab-1';
}

function findTabIndex(tabId, tabsState) {
    return tabsState.tabs.findIndex(tab => tab.id === tabId);
}

function processFullTextUpdate(text) {
    return validateText(text) ? sanitizeText(text) : text;
}

function processSmartUpdate(diffs, currentText, socketId, tabId, log) {
    try {
        const patches = dmp.patch_fromText(diffs);
        const [newText, results] = dmp.patch_apply(patches, currentText);

        const allApplied = results.every(result => result);
        if (allApplied && validateText(newText)) {
            return { text: sanitizeText(newText), updateType: 'smart' };
        } else {
            logError('差异补丁应用失败或结果无效', new Error('补丁应用失败'), {
                socketId,
                allApplied,
                textValid: validateText(newText),
                tabId
            }, 'warn');
            return { text: currentText, updateType: 'unchanged' };
        }
    } catch (error) {
        logError('应用差异补丁失败', error, { socketId, diffs, tabId });
        throw error;
    }
}

function processIncrementalUpdate(updateData, currentText, socketId, tabId, log) {
    const { start, end, text } = updateData;

    if (typeof start !== 'number' || typeof end !== 'number' || typeof text !== 'string') {
        logError('增量更新格式错误 - 缺少必要参数或参数类型无效', new Error('增量更新格式错误'), {
            socketId,
            hasStart: typeof start === 'number',
            hasEnd: typeof end === 'number',
            hasText: typeof text === 'string',
            tabId
        }, 'warn');
        return { text: currentText, updateType: 'unchanged' };
    }

    if (validateText(text)) {
        if (start >= 0 && end >= start && end <= currentText.length) {
            try {
                const sanitizedText = sanitizeText(text);
                const updatedText = currentText.substring(0, start) + sanitizedText + currentText.substring(end);

                log.info('增量更新处理成功', {
                    socketId,
                    tabId,
                    start,
                    end,
                    textLength: text.length,
                    currentTextLength: currentText.length
                });

                return { text: updatedText, updateType: 'incremental' };
            } catch (subError) {
                logError('处理增量更新失败', subError, {
                    socketId,
                    tabId,
                    start,
                    end
                });
                return { text: currentText, updateType: 'unchanged' };
            }
        } else {
            logError('增量更新参数无效 - start和end超出有效范围', new Error('增量更新范围无效'), {
                socketId,
                tabId,
                start,
                end,
                currentTextLength: currentText.length
            }, 'warn');
            return { text: currentText, updateType: 'unchanged' };
        }
    } else {
        logError('增量更新文本无效', new Error('增量更新文本无效'), {
            socketId,
            tabId,
            textLength: text.length
        }, 'warn');
        return { text: currentText, updateType: 'unchanged' };
    }
}

function broadcastTextUpdate(io, tabId, data, updatedText, senderSocketId, updateType, log) {
    try {
        let broadcastData;
        
        if (updateType === 'incremental' && data.diff && typeof data.diff === 'object') {
            broadcastData = {
                tabId,
                diff: data.diff,
                fullText: updatedText,
                senderId: senderSocketId
            };
        } else if (updateType === 'smart' && (data.diffs || (data.diff && data.diff.diffs))) {
            broadcastData = {
                tabId,
                diffs: data.diffs || data.diff.diffs,
                fullText: updatedText,
                senderId: senderSocketId
            };
        } else {
            broadcastData = {
                tabId,
                fullText: updatedText,
                senderId: senderSocketId
            };
        }

        io.except(senderSocketId).emit('text-update', broadcastData);

        log.info('文本更新处理完成', {
            socketId: senderSocketId,
            tabId,
            updateType,
            textLength: updatedText.length
        });
    } catch (emitError) {
        logError('广播文本更新失败', emitError, {
            socketId: senderSocketId,
            tabId
        });
    }
}

module.exports = {
    MAX_TEXT_LENGTH,
    getTargetTabId,
    findTabIndex,
    processFullTextUpdate,
    processSmartUpdate,
    processIncrementalUpdate,
    broadcastTextUpdate
};
