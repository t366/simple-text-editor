const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const { handleFileError, logger } = require('../utils');

const DATA_FILE = config.DATA_FILE;
const DEBOUNCE_DELAY = config.DEBOUNCE_DELAY;
const BACKUP_DIR = path.join(path.dirname(DATA_FILE), 'backups');
const MAX_BACKUPS = 10;
const BACKUP_INTERVAL = 30 * 60 * 1000;

let writeDebounceTimeout = null;
let backupInterval = null;

class SimpleCache {
    constructor(ttl = 60000) {
        this.cache = new Map();
        this.ttl = ttl;
    }
    
    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        return item.value;
    }
    
    set(key, value) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + this.ttl
        });
    }
    
    delete(key) {
        this.cache.delete(key);
    }
    
    clear() {
        this.cache.clear();
    }
}

const dataCache = new SimpleCache(30000);

const tabsState = {
    tabs: [
        {
            id: 'tab-1',
            title: '未命名文档',
            content: "欢迎使用实时文本编辑器！\n\n这里的内容会在所有设备上实时同步。\n\n开始编辑吧！",
            lastEdited: Date.now()
        }
    ],
    tabCounter: 1
};

const connectedUsers = new Map();
const serverStartTime = new Date().toISOString();

const connectionStats = {
    total: 0,
    active: 0,
    peak: 0,
    reconnections: 0
};

async function ensureBackupDir() {
    try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

function getBackupFileName() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    return `backup-${timestamp}.json`;
}

async function createBackup(log) {
    try {
        await ensureBackupDir();
        
        const backupData = {
            tabs: tabsState.tabs,
            tabCounter: tabsState.tabCounter,
            backupAt: new Date().toISOString()
        };
        
        const backupFile = path.join(BACKUP_DIR, getBackupFileName());
        await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
        
        log.info('数据备份创建成功', { backupFile });
        
        await cleanOldBackups(log);
        
        return backupFile;
    } catch (error) {
        log.error('创建备份失败', { error: error.message });
        return null;
    }
}

async function cleanOldBackups(log) {
    try {
        const files = await fs.readdir(BACKUP_DIR);
        const backupFiles = files
            .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(BACKUP_DIR, f),
                time: fs.stat(path.join(BACKUP_DIR, f)).then(s => s.mtime.getTime()).catch(() => 0)
            }));
        
        const filesWithTime = await Promise.all(
            backupFiles.map(async f => ({
                ...f,
                time: await f.time
            }))
        );
        
        filesWithTime.sort((a, b) => b.time - a.time);
        
        const toDelete = filesWithTime.slice(MAX_BACKUPS);
        
        if (toDelete.length === 0) return;
        
        setImmediate(async () => {
            for (const file of toDelete) {
                try {
                    await fs.unlink(file.path);
                    log.info('删除旧备份', { file: file.name });
                } catch (error) {
                    log.warn('删除旧备份失败', { file: file.name, error: error.message });
                }
            }
        });
    } catch (error) {
        log.warn('清理旧备份失败', { error: error.message });
    }
}

async function listBackups(log) {
    try {
        await ensureBackupDir();
        const files = await fs.readdir(BACKUP_DIR);
        const backupFiles = files
            .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
            .sort()
            .reverse();
        
        return backupFiles;
    } catch (error) {
        log.error('列出备份失败', { error: error.message });
        return [];
    }
}

async function restoreBackup(backupFileName, log) {
    try {
        const backupPath = path.join(BACKUP_DIR, backupFileName);
        const data = await fs.readFile(backupPath, 'utf8');
        const backupData = JSON.parse(data);
        
        if (backupData.tabs) {
            tabsState.tabs = backupData.tabs;
            tabsState.tabCounter = backupData.tabCounter || 1;
            log.info('从备份恢复数据成功', { backupFile: backupFileName });
            return true;
        }
        return false;
    } catch (error) {
        log.error('恢复备份失败', { backupFile: backupFileName, error: error.message });
        return false;
    }
}

function startAutoBackup(log) {
    if (backupInterval) {
        clearInterval(backupInterval);
    }
    
    backupInterval = setInterval(async () => {
        await createBackup(log);
    }, BACKUP_INTERVAL);
    
    if (backupInterval.unref) {
        backupInterval.unref();
    }
    
    log.info('自动备份已启动', { interval: `${BACKUP_INTERVAL / 60000}分钟` });
}

function stopAutoBackup() {
    if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
    }
}

async function loadSavedData(log) {
    log.info('开始加载保存的数据...');
    
    const cachedData = dataCache.get('tabsData');
    if (cachedData && cachedData.tabs) {
        tabsState.tabs = cachedData.tabs;
        tabsState.tabCounter = cachedData.tabCounter || 1;
        log.info('从缓存加载标签页数据成功');
        return;
    }
    
    try {
        log.info(`尝试读取数据文件: ${DATA_FILE}`);
        let data;
        try {
            data = await fs.readFile(DATA_FILE, 'utf8');
            log.info('数据文件读取成功');
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                log.info('数据文件不存在，使用默认数据');
                return;
            } else {
                throw readError;
            }
        }

        let savedData;
        try {
            log.info('开始解析JSON数据...');
            savedData = JSON.parse(data);
            log.info('JSON数据解析成功');
        } catch (parseError) {
            log.error('数据文件格式无效，无法解析JSON', {
                filePath: DATA_FILE,
                error: parseError.message
            });
            return;
        }

        if (savedData.tabs) {
            tabsState.tabs = savedData.tabs.map(tab => ({
                id: tab.id,
                title: tab.title,
                content: tab.content,
                lastEdited: tab.lastEdited || Date.now()
            }));
            tabsState.tabCounter = savedData.tabCounter || 1;
            
            dataCache.set('tabsData', savedData);
            
            log.info('成功加载保存的标签页数据');
        } else if (savedData.text) {
            tabsState.tabs = [
                {
                    id: 'tab-1',
                    title: '未命名文档',
                    content: savedData.text,
                    lastEdited: Date.now()
                }
            ];
            tabsState.tabCounter = 1;
            log.info('成功加载保存的文本内容，并转换为标签页格式');
        } else {
            log.warn('数据文件格式无效，缺少tabs或text字段', { filePath: DATA_FILE });
        }
    } catch (error) {
        handleFileError(error, '读取', { filePath: DATA_FILE });
    }
}

async function saveDataDebounced(log) {
    if (writeDebounceTimeout) {
        clearTimeout(writeDebounceTimeout);
    }

    writeDebounceTimeout = setTimeout(async () => {
        try {
            await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

            const saveData = {
                tabs: tabsState.tabs,
                tabCounter: tabsState.tabCounter,
                updatedAt: new Date().toISOString()
            };

            const dataString = JSON.stringify(saveData, null, 2);
            
            dataCache.set('tabsData', saveData);
            
            await fs.writeFile(DATA_FILE, dataString, 'utf8');
            log.info('标签页数据已保存到文件');
        } catch (error) {
            log.error('保存数据失败', {
                error: error.message,
                filePath: DATA_FILE
            });
            handleFileError(error, '保存', { filePath: DATA_FILE });
        }
    }, DEBOUNCE_DELAY);
}

async function flushData(log) {
    if (writeDebounceTimeout) {
        clearTimeout(writeDebounceTimeout);
        writeDebounceTimeout = null;
    }
    try {
        await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

        const saveData = {
            tabs: tabsState.tabs,
            tabCounter: tabsState.tabCounter,
            updatedAt: new Date().toISOString()
        };

        await fs.writeFile(DATA_FILE, JSON.stringify(saveData, null, 2), 'utf8');
        log.info('关闭前标签页数据已保存到文件');
        
        await createBackup(log);
    } catch (error) {
        log.error('强制保存数据失败', {
            error: error.message,
            filePath: DATA_FILE
        });
        handleFileError(error, '保存', { filePath: DATA_FILE });
    }
}

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
    cleanOldBackups,
    BACKUP_DIR
};
