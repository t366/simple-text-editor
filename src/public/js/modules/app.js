// 主应用模块

import { calculateDiff, transformCursor, getNewCursorPosition, insertMarkdownSyntax, throttle, debounce } from './utils.js';
import { initNotifications, showNotification } from './notifications.js';
import { initCursor, updateCursor, removeCursor, refreshCursors } from './cursor.js';
import { initUsers, updateUserList } from './users.js';

let socket = null;
let username = localStorage.getItem('editor-username') || 
              `用户${Math.random().toString(36).slice(2, 6)}`;
let currentUserId = null;
let authToken = null;
let isPreviewMode = false;
let isJoined = false;

// 标签页状态管理
const tabsState = {
    tabs: [
        {
            id: 'tab-1',
            title: '未命名文档',
            content: '',
            isActive: true,
            isDirty: false,
            filePath: null,
            isPreviewMode: false,
            lastEdited: Date.now() // 添加最后编辑时间
        }
    ],
    currentTabId: 'tab-1',
    tabCounter: 1
};

// DOM 元素
const elements = {};

// 自定义确认对话框元素
let confirmDialog = {
    overlay: null,
    dialog: null,
    title: null,
    icon: null,
    message: null,
    confirmBtn: null,
    cancelBtn: null,
    resolveCallback: null
};

// 初始化应用
export function initApp() {
    // 初始化 DOM 引用
    elements.editorContainers = document.getElementById('editorContainers');
    elements.tabsWrapper = document.getElementById('tabsWrapper');
    elements.tabsList = document.getElementById('tabsList');
    elements.newTabBtn = document.getElementById('newTabBtn');
    elements.togglePreviewBtn = document.getElementById('togglePreviewBtn');
    
    elements.connectionStatus = document.getElementById('connectionStatus');
    elements.statusIndicator = document.getElementById('statusIndicator');
    elements.userCount = document.getElementById('userCount');
    elements.usersList = document.getElementById('usersList');
    elements.notificationContainer = document.getElementById('notificationContainer');
    elements.progressContainer = document.getElementById('progressContainer');
    elements.progressBar = document.getElementById('progressBar');
    elements.sidebar = document.getElementById('sidebar');
    
    // 初始化自定义确认对话框元素
    confirmDialog.overlay = document.getElementById('confirmDialogOverlay');
    confirmDialog.dialog = document.getElementById('confirmDialog');
    confirmDialog.title = document.getElementById('confirmDialogTitle');
    confirmDialog.icon = document.getElementById('confirmDialogIcon');
    confirmDialog.message = document.getElementById('confirmDialogMessage');
    confirmDialog.confirmBtn = document.getElementById('confirmDialogConfirm');
    confirmDialog.cancelBtn = document.getElementById('confirmDialogCancel');
    
    // 绑定确认对话框事件
    bindConfirmDialogEvents();
    
    // 初始化子模块
    initNotifications(elements);
    initCursor(elements);
    initUsers(elements);
    
    // 设置用户名
    setupUsername();
    
    // 连接服务器
    connectSocket();
    
    // 设置事件监听器
    setupEventListeners();
    
    // 设置标签页事件监听器
    setupTabsEventListeners();
    
    // 为第一个标签页设置事件监听器
    setupTabEventListeners('tab-1');
    
    // 初始化编辑器引用
    updateEditorReferences();
}

// 绑定确认对话框事件
function bindConfirmDialogEvents() {
    // 确认按钮事件
    confirmDialog.confirmBtn.addEventListener('click', () => {
        confirmDialog.overlay.classList.remove('show');
        restoreFocus();
        if (confirmDialog.resolveCallback) {
            confirmDialog.resolveCallback(true);
            confirmDialog.resolveCallback = null;
        }
    });
    
    // 取消按钮事件
    confirmDialog.cancelBtn.addEventListener('click', () => {
        confirmDialog.overlay.classList.remove('show');
        restoreFocus();
        if (confirmDialog.resolveCallback) {
            confirmDialog.resolveCallback(false);
            confirmDialog.resolveCallback = null;
        }
    });
    
    // 点击遮罩层关闭
    confirmDialog.overlay.addEventListener('click', (e) => {
        if (e.target === confirmDialog.overlay) {
            confirmDialog.overlay.classList.remove('show');
            restoreFocus();
            if (confirmDialog.resolveCallback) {
                confirmDialog.resolveCallback(false);
                confirmDialog.resolveCallback = null;
            }
        }
    });
    
    // ESC键关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && confirmDialog.overlay.classList.contains('show')) {
            confirmDialog.overlay.classList.remove('show');
            restoreFocus();
            if (confirmDialog.resolveCallback) {
                confirmDialog.resolveCallback(false);
                confirmDialog.resolveCallback = null;
            }
        }
    });
}

// 恢复焦点到文本编辑器
function restoreFocus() {
    if (elements.textEditor) {
        elements.textEditor.focus();
    }
}

// 显示自定义确认对话框
function showConfirmDialog(options) {
    return new Promise((resolve) => {
        confirmDialog.title.textContent = options.title || '确认操作';
        confirmDialog.icon.textContent = options.icon || '⚠️';
        confirmDialog.message.textContent = options.message || '确定要执行此操作吗？';
        confirmDialog.confirmBtn.textContent = options.confirmText || '确定';
        confirmDialog.cancelBtn.textContent = options.cancelText || '取消';
        
        // 设置按钮样式
        if (options.confirmClass) {
            confirmDialog.confirmBtn.className = `btn ${options.confirmClass}`;
        } else {
            confirmDialog.confirmBtn.className = 'btn btn-danger';
        }
        
        confirmDialog.resolveCallback = resolve;
        confirmDialog.overlay.classList.add('show');
    });
}

// 设置用户名
function setupUsername() {
    const savedName = localStorage.getItem('editor-username');
    if (!savedName) {
        // 完全避免使用prompt()函数，改用默认用户名
        console.info('使用默认用户名，不提示输入');
        // 直接使用生成的默认用户名，不调用prompt()
        localStorage.setItem('editor-username', username);
    }
}

// 自动重连配置
const reconnectConfig = {
    maxAttempts: 10, // 增加最大尝试次数
    initialRetryInterval: 2000, // 初始重连间隔2秒
    maxRetryInterval: 30000, // 最大重连间隔30秒
    retryCount: 0
};

function connectSocket() {
    const serverUrl = window.location.origin;
    
    console.log('连接到服务器:', serverUrl);
    
    reconnectConfig.retryCount = 0;
    
    socket = io(serverUrl, {
        reconnection: false,
        timeout: 20000,
        transports: ['polling', 'websocket'],
        forceNew: true,
        upgrade: true,
        rememberUpgrade: false
    });
    
    socket.on('connect', () => {
        updateStatus('已连接到服务器', 'success');
        loginAndJoin();
    });
    
    function loginAndJoin() {
        fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: username })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                username = data.username;
                localStorage.setItem('editor-username', username);
                joinRoom();
            } else {
                showNotification({
                    title: '连接失败',
                    message: '登录失败，请重试',
                    type: 'error',
                    duration: 3000
                });
            }
        })
        .catch(() => {
            showNotification({
                title: '连接失败',
                message: '服务器未响应登录请求',
                type: 'error',
                duration: 3000
            });
        });
    }
    
    function joinRoom() {
        socket.emit('join', { username: username });
        isJoined = true;
        
        showNotification({
            title: '连接成功',
            message: '已连接到服务器，开始实时同步',
            type: 'success',
            duration: 3000
        });
    }
    
    socket.on('error', (errorData) => {
        console.error('Socket错误:', errorData);
        if (errorData && errorData.message === '请先登录') {
            isJoined = false;
            loginAndJoin();
        }
    });
    
    socket.on('server-shutdown', (data) => {
        console.log('服务器即将重启:', data);
        updateStatus('服务器即将重启，正在重连...', 'warning');
        showNotification({
            title: '服务器通知',
            message: data.message || '服务器即将重启，正在重连...',
            type: 'warning',
            duration: 8000
        });
        
        handleReconnect();
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket.IO 连接错误:', error);
        updateStatus('连接失败，请检查网络', 'error');
        
        if (reconnectConfig.retryCount === 0) {
            showNotification({
                title: '连接失败',
                message: `无法连接到服务器: ${error.message}`,
                type: 'error',
                duration: 5000
            });
        }
        
        handleReconnect();
    });
    
    // 连接超时事件
    socket.on('connect_timeout', (timeout) => {
        console.error('Socket.IO 连接超时:', timeout);
        
        // 开始自动重连
        handleReconnect();
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Socket.IO 断开连接:', reason);
        
        // 如果是正常断开，不显示重连通知
        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
            updateStatus('连接已断开', 'error');
        } else {
            updateStatus('连接断开，正在重连...', 'error');
            // 只在非手动断开连接时开始重连
            handleReconnect();
        }
        
        isJoined = false;
    });
    
    // 初始文本
    socket.on('initial-text', (text) => {
        // 只在应用启动时更新第一个标签页
        if (elements.textEditor && tabsState.tabs.length === 1) {
            elements.textEditor.value = text;
            adjustTextareaHeight();
            
            // 更新当前标签页内容
            const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
            if (currentTab) {
                currentTab.content = text;
            }
        }
    });
    
    // 标签页同步 - 当新客户端加入时，同步所有标签页状态
    socket.on('tabs-sync', (tabsData) => {
        // 保存当前活动标签页ID（用于恢复焦点）
        const currentActiveTabId = tabsState.currentTabId;
        
        // 完全替换本地标签页状态，不保留任何现有标签页
        tabsState.tabs = [];
        
        // 清除所有DOM中的标签页
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => tab.remove());
        
        // 清除所有DOM中的编辑器容器
        const containers = document.querySelectorAll('.editor-container');
        containers.forEach(container => container.remove());
        
        // 完全重建标签页状态
        tabsData.forEach(tabData => {
            // 创建标签页数据
            const newTab = {
                id: tabData.id,
                title: tabData.title,
                content: tabData.content || '',
                isActive: tabData.isActive || false,
                isDirty: false,
                filePath: null,
                isPreviewMode: tabData.isPreviewMode || false,
                lastEdited: tabData.lastEdited || Date.now() // 确保有lastEdited字段
            };
            
            // 添加到标签页列表
            tabsState.tabs.push(newTab);
            
            // 创建标签页DOM元素
            const tabElement = document.createElement('div');
            tabElement.className = `tab ${newTab.isActive ? 'active' : ''}`;
            tabElement.dataset.tabId = newTab.id;
            tabElement.innerHTML = `
                <span class="tab-title" title="${newTab.title}">${newTab.title}</span>
                <button class="tab-close" title="关闭标签页 (Ctrl+W)">×</button>
            `;
            
            // 在标签列表末尾添加新标签页
            elements.tabsList.appendChild(tabElement);
            
            // 创建编辑器容器
            const editorContainer = document.createElement('div');
            editorContainer.className = `editor-container ${newTab.isActive ? 'active' : ''}`;
            editorContainer.dataset.containerId = newTab.id;
            editorContainer.innerHTML = `
                <textarea 
                    class="text-editor" 
                    placeholder="开始输入...所有更改将实时同步到所有连接的设备"
                    spellcheck="true"
                >${newTab.content || ''}</textarea>
                <div class="preview-panel"></div>
            `;
            
            elements.editorContainers.appendChild(editorContainer);
            
            // 设置新标签页的事件监听器
            setupTabEventListeners(newTab.id);
        });
        
        // 更新tabCounter
        tabsState.tabCounter = Math.max(...tabsState.tabs.map(tab => parseInt(tab.id.split('-')[1] || '1')));
        
        // 找到当前活动标签页
        let activeTab = tabsState.tabs.find(tab => tab.isActive);
        
        if (activeTab) {
            // 如果有活动标签页，保持不变
            tabsState.currentTabId = activeTab.id;
        } else if (tabsState.tabs.length > 0) {
            // 如果没有活动标签页，选择最后编辑的标签页
            const lastEditedTab = tabsState.tabs.sort((a, b) => b.lastEdited - a.lastEdited)[0];
            
            // 更新所有标签页的活动状态
            tabsState.tabs.forEach(tab => {
                tab.isActive = tab.id === lastEditedTab.id;
            });
            
            // 设置当前标签页ID为最后编辑的标签页
            tabsState.currentTabId = lastEditedTab.id;
            activeTab = lastEditedTab;
        }
        
        // 更新DOM中标签页和编辑器容器的活动状态
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tabId === tabsState.currentTabId);
        });
        
        document.querySelectorAll('.editor-container').forEach(container => {
            container.classList.toggle('active', container.dataset.containerId === tabsState.currentTabId);
        });
        
        // 更新编辑器引用
        updateEditorReferences();
        
        // 更新预览模式状态
        updatePreviewMode();
        
        // 调整文本区域高度
        adjustTextareaHeight();
        
        // 显示同步成功通知
        showNotification({
            title: '同步成功',
            message: '已从服务器同步所有标签页内容',
            type: 'success',
            duration: 2000
        });
    });
    
    // 标签页创建事件
    socket.on('tab-create', (tabData) => {
        // 检查标签页是否已存在
        if (tabsState.tabs.find(tab => tab.id === tabData.id)) return;
        
        // 创建标签页数据
        const newTab = {
            id: tabData.id,
            title: tabData.title,
            content: tabData.content,
            isActive: false,
            isDirty: false,
            filePath: null,
            isPreviewMode: false,
            lastEdited: tabData.lastEdited || Date.now() // 确保有lastEdited字段
        };
        
        // 添加到标签页列表
        tabsState.tabs.push(newTab);
        
        // 创建标签页DOM元素
        const tabElement = document.createElement('div');
        tabElement.className = 'tab';
        tabElement.dataset.tabId = newTab.id;
        tabElement.innerHTML = `
            <span class="tab-title" title="${newTab.title}">${newTab.title}</span>
            <button class="tab-close" title="关闭标签页 (Ctrl+W)">×</button>
        `;
        
        // 在标签列表末尾添加新标签页
        elements.tabsList.appendChild(tabElement);
        
        // 创建编辑器容器
        const editorContainer = document.createElement('div');
        editorContainer.className = 'editor-container';
        editorContainer.dataset.containerId = newTab.id;
        editorContainer.innerHTML = `
            <textarea 
                class="text-editor" 
                placeholder="开始输入...所有更改将实时同步到所有连接的设备"
                spellcheck="true"
            ></textarea>
            <div class="preview-panel"></div>
        `;
        
        elements.editorContainers.appendChild(editorContainer);
        
        // 设置新标签页的事件监听器
        setupTabEventListeners(newTab.id);
        
        // 更新tabCounter
        tabsState.tabCounter = Math.max(tabsState.tabCounter, parseInt(tabData.id.split('-')[1]));
    });
    
    // 标签页关闭事件
    socket.on('tab-close', (data) => {
        const { tabId } = data;
        // 检查标签页是否存在
        const tab = tabsState.tabs.find(t => t.id === tabId);
        if (!tab) return;
        
        // 检查是否是当前标签页
        const isCurrentTab = tabsState.currentTabId === tabId;
        
        // 找到要关闭的标签页的索引
        const tabIndex = tabsState.tabs.findIndex(t => t.id === tabId);
        
        // 找到要切换到的标签页
        let newActiveTabId;
        if (tabIndex === tabsState.tabs.length - 1) {
            // 如果是最后一个标签页，切换到前一个
            newActiveTabId = tabsState.tabs[tabIndex - 1].id;
        } else {
            // 否则切换到下一个
            newActiveTabId = tabsState.tabs[tabIndex + 1].id;
        }
        
        // 从状态中移除标签页
        tabsState.tabs = tabsState.tabs.filter(t => t.id !== tabId);
        
        // 从DOM中移除标签页
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabElement) {
            tabElement.remove();
        }
        
        // 从DOM中移除编辑器容器
        const editorContainer = document.querySelector(`[data-container-id="${tabId}"]`);
        if (editorContainer) {
            editorContainer.remove();
        }
        
        // 如果关闭的是当前标签页，切换到新的活动标签页
        if (isCurrentTab) {
            switchTab(newActiveTabId);
        }
    });
    
    // 标签页重命名事件
    socket.on('tab-rename', (data) => {
        const { tabId, newTitle } = data;
        // 找到标签页
        const tab = tabsState.tabs.find(t => t.id === tabId);
        if (!tab) return;
        
        // 更新标签页状态
        tab.title = newTitle;
        
        // 更新DOM
        const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabElement) {
            const titleElement = tabElement.querySelector('.tab-title');
            if (titleElement) {
                titleElement.textContent = newTitle;
                titleElement.title = newTitle;
            }
        }
    });
    
    // 标签页切换事件
    socket.on('tab-switch', (data) => {
        const { newTabId } = data;
        // 检查标签页是否存在
        if (tabsState.tabs.find(tab => tab.id === newTabId)) {
            // 切换到指定标签页，传入fromServer=true避免循环发送事件
            switchTab(newTabId, true);
        }
    });
    
    // 文本更新 - 支持完整文本、传统增量更新和diff-match-patch智能更新
    socket.on('text-update', (data) => {
        if (data.senderId && data.senderId === socket.id) {
            return;
        }
        
        // 确定目标标签页ID
        const targetTabId = data.tabId || tabsState.currentTabId;
        
        // 获取目标标签页
        const targetTab = tabsState.tabs.find(t => t.id === targetTabId);
        if (!targetTab) return;
        
        let newText;
        let newCursorPos;
        let currentPos = 0;
        
        // 获取目标标签页的文本区域
        let textarea;
        if (targetTabId === tabsState.currentTabId) {
            // 如果是当前标签页，使用当前编辑器
            textarea = elements.textEditor;
            if (textarea) {
                currentPos = textarea.selectionStart;
                newCursorPos = textarea.selectionStart;
            }
        } else {
            // 否则找到对应的编辑器容器
            const container = document.querySelector(`[data-container-id="${targetTabId}"]`);
            textarea = container?.querySelector('.text-editor');
            // 如果不是当前标签页，不需要处理光标位置
            newCursorPos = 0;
        }
        
        // 使用编辑器中的实际内容作为当前文本，而不是标签页状态中的内容
        // 这样可以避免本地更新和服务器同步更新之间的冲突
        const currentText = textarea?.value || targetTab.content;
        
        // 从data中提取实际的更新数据
        const updateData = typeof data === 'string' ? data : data.diff || data;
        
        let isStringData = typeof updateData === 'string';
        
        if (isStringData) {
            // 完整文本更新
            newText = updateData;
            // 计算光标新位置
            newCursorPos = getNewCursorPosition(currentPos, currentText, newText);
        } else if (updateData.diffs || data.diffs) {
            // diff-match-patch智能更新
            try {
                // 应用差异补丁
                const dmp = new diff_match_patch();
                const diffs = updateData.diffs || data.diffs;
                const patches = dmp.patch_fromText(diffs);
                const [result, results] = dmp.patch_apply(patches, currentText);
                
                // 检查所有补丁是否成功应用
                const allApplied = results.every(result => result);
                if (allApplied) {
                    newText = result;
                    // 计算光标新位置
                    newCursorPos = getNewCursorPosition(currentPos, currentText, newText);
                } else {
                    // 如果补丁应用失败，使用完整文本更新（如果有）
                    newText = data.fullText || currentText;
                }
            } catch (error) {
                console.error('应用差异补丁失败:', error);
                // 出错时使用当前文本或完整文本（如果提供）
                newText = data.fullText || currentText;
            }
        } else if (updateData.start !== undefined && updateData.end !== undefined) {
            // 传统增量更新
            const { start, end, text } = updateData;
            // 应用增量更新到当前文本
            newText = currentText.substring(0, start) + text + currentText.substring(end);
            // 计算光标新位置
            newCursorPos = transformCursor(currentPos, start, end, text);
        } else {
            // 不支持的更新格式
            return;
        }
        
        // 更新目标标签页的内容
        targetTab.content = newText;
        
        // 如果有活动的文本区域，更新它的内容和光标位置
        if (textarea && textarea.value !== newText) {
            textarea.value = newText;
            
            // 更新预览（如果有必要且是当前标签页）
            if (targetTabId === tabsState.currentTabId && isPreviewMode) {
                updatePreview();
            }
            
            // 恢复光标位置（仅当前标签页）
            if (targetTabId === tabsState.currentTabId) {
                textarea.setSelectionRange(newCursorPos, newCursorPos);
                adjustTextareaHeight();
            }
        }
    });
    
    // 用户列表
    socket.on('user-list', (users) => {
        // 保存当前用户ID
        if (socket.id) {
            currentUserId = socket.id;
        }
        updateUserList(users, currentUserId);
    });
    
    // 用户加入
    socket.on('user-joined', (user) => {
        // 添加空值检查，防止访问undefined的name属性
        if (!user) return;
        
        showNotification({
            title: '新用户加入',
            message: `${user.name || '未知用户'} 加入了编辑`,
            type: 'info',
            duration: 2500
        });
    });
    
    // 用户离开
    socket.on('user-left', (userId) => {
        removeCursor(userId);
    });
    
    // 光标位置
    socket.on('user-cursor', (data) => {
        if (data) {
            if (data.tabId && data.tabId !== tabsState.currentTabId) {
                return;
            }
            const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
            if (currentTab) {
                const currentText = currentTab.content;
                updateCursor(data, currentText);
            }
        }
    });
}

// 处理重连逻辑
function handleReconnect() {
    // 如果已经超过最大重试次数，不再重试
    if (reconnectConfig.retryCount >= reconnectConfig.maxAttempts) {
        updateStatus('连接失败，请刷新页面重试', 'error');
        showNotification({
            title: '连接失败',
            message: '无法连接到服务器，请刷新页面重试',
            type: 'error',
            duration: 5000
        });
        return;
    }
    
    // 增加重试计数
    reconnectConfig.retryCount++;
    
    // 计算重试间隔（指数退避）
    const retryInterval = reconnectConfig.initialRetryInterval * Math.pow(2, reconnectConfig.retryCount - 1);
    
    console.log(`尝试重连... (${reconnectConfig.retryCount}/${reconnectConfig.maxAttempts})`);
    
    // 显示重连状态
    updateStatus(`正在重连... (${reconnectConfig.retryCount}/${reconnectConfig.maxAttempts})`, 'warning');
    
    // 延迟后尝试重连
    setTimeout(() => {
        // 断开旧连接
        if (socket) {
            socket.disconnect();
        }
        
        // 重新连接
        connectSocket();
    }, retryInterval);
}

// 设置事件监听器
function setupEventListeners() {
    // 按钮事件
    // 保存按钮
    document.getElementById('saveBtn')?.addEventListener('click', saveCurrentTab);
    // 清空按钮
    document.getElementById('clearBtn')?.addEventListener('click', clearCurrentTab);
    // 复制按钮
    document.getElementById('copyBtn')?.addEventListener('click', copyCurrentTabText);
    
    // 浮动按钮
    document.querySelectorAll('.floating-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (this.classList.contains('secondary')) {
                saveCurrentTab();
            } else {
                scrollToTop();
            }
        });
    });
    
    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        // 新建标签页 (Ctrl+T)
        if ((e.ctrlKey || e.metaKey) && e.key === 't') {
            e.preventDefault();
            createNewTab();
        }
        
        // 关闭当前标签页 (Ctrl+W)
        if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
            e.preventDefault();
            closeTab(tabsState.currentTabId);
        }
        
        // 切换到下一个标签页 (Ctrl+Tab)
        if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                switchToPreviousTab();
            } else {
                switchToNextTab();
            }
        }
        
        // 保存当前标签页 (Ctrl+S)
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentTab();
        }
        
        // 清空当前标签页 (Ctrl+D)
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            clearCurrentTab();
        }
        
        // 复制当前标签页文本 (Ctrl+C)
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && 
            document.activeElement.id !== 'textEditor') {
            copyCurrentTabText();
        }
        
        // 快速切换到指定标签页 (Ctrl+1-9)
        if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const tabIndex = parseInt(e.key) - 1;
            if (tabIndex < tabsState.tabs.length) {
                switchTab(tabsState.tabs[tabIndex].id);
            }
        }
    });
    
    // 工具栏切换按钮
    const toggleToolbarBtn = document.getElementById('toggleToolbarBtn');
    if (toggleToolbarBtn) {
        toggleToolbarBtn.addEventListener('click', () => {
            const advancedToolbar = document.querySelector('.toolbar-advanced');
            if (advancedToolbar) {
                const isExpanded = advancedToolbar.classList.toggle('expanded');
                toggleToolbarBtn.setAttribute('aria-expanded', isExpanded);
                advancedToolbar.setAttribute('aria-hidden', !isExpanded);
            }
        });
    }

    // Markdown 预览切换
    if (elements.togglePreviewBtn) {
        elements.togglePreviewBtn.addEventListener('click', togglePreview);
    }
    
    // 初始化第一个标签页的事件监听器
    setupTabEventListeners('tab-1');
    
    // 工具栏格式化按钮
    setupToolbarEvents();
}

// 设置工具栏事件
function setupToolbarEvents() {
    const formatButtons = {
        'formatBold': 'bold',
        'formatItalic': 'italic',
        'formatUnderline': 'underline',
        'formatStrikethrough': 'strikethrough',
        'formatH1': 'h1',
        'formatH2': 'h2',
        'formatH3': 'h3',
        'formatUl': 'ul',
        'formatOl': 'ol',
        'formatQuote': 'quote',
        'formatCode': 'code',
        'formatLink': 'link'
    };

    Object.keys(formatButtons).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                // 动态获取当前活动的文本区域
                const activeTextarea = document.querySelector('.editor-container.active .text-editor');
                if (activeTextarea) {
                    insertMarkdownSyntax(activeTextarea, formatButtons[id]);
                }
            });
        }
    });

    // 处理 data-action="time"
    const timeBtn = document.querySelector('button[data-action="time"]');
    if (timeBtn) {
        timeBtn.addEventListener('click', () => {
            // 动态获取当前活动的文本区域
            const activeTextarea = document.querySelector('.editor-container.active .text-editor');
            if (activeTextarea) {
                insertMarkdownSyntax(activeTextarea, 'time');
            }
        });
    }
}



// 更新 Markdown 预览
const debouncedUpdatePreview = debounce(updatePreviewContent, 150);

function updatePreview() {
    if (!isPreviewMode || !elements.previewPanel) return;
    debouncedUpdatePreview();
}

function updatePreviewContent() {
    if (!isPreviewMode || !elements.previewPanel || !elements.textEditor) return;
    
    const text = elements.textEditor.value;
    
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
        const html = marked.parse(text);
        elements.previewPanel.innerHTML = DOMPurify.sanitize(html);
    } else {
        elements.previewPanel.textContent = '预览组件加载失败，请检查网络连接';
    }
}

// 切换Markdown预览
function togglePreview() {
    const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
    if (currentTab) {
        currentTab.isPreviewMode = !currentTab.isPreviewMode;
        isPreviewMode = currentTab.isPreviewMode;
        
        if (elements.editorContainer) {
            elements.editorContainer.classList.toggle('split-mode');
        }
        
        elements.togglePreviewBtn.classList.toggle('active');
        elements.togglePreviewBtn.setAttribute('aria-pressed', isPreviewMode);
        
        if (isPreviewMode) {
            updatePreview();
        }
        
        // 刷新光标位置，因为布局变了
        setTimeout(refreshCursors, 300);
    }
}

// 更新状态
function updateStatus(message, type) {
    if (elements.connectionStatus) {
        elements.connectionStatus.textContent = message;
    }
    
    if (elements.statusIndicator) {
        elements.statusIndicator.className = 'status-indicator';
        if (type === 'success') {
            elements.statusIndicator.classList.add('connected');
        } else if (type === 'error') {
            elements.statusIndicator.classList.add('disconnected');
        }
    }
}

// 调整文本区域高度
function adjustTextareaHeight() {
    const textarea = elements.textEditor;
    if (textarea) {
        // 使用requestAnimationFrame优化高度调整
        requestAnimationFrame(() => {
            textarea.style.height = 'auto';
            const newHeight = Math.min(textarea.scrollHeight, 600);
            // 设置精确的高度，避免不必要的重排
            textarea.style.height = newHeight + 'px';
        });
    }
}

// 工具函数 - 切换到下一个标签页
function switchToNextTab() {
    const currentIndex = tabsState.tabs.findIndex(t => t.id === tabsState.currentTabId);
    const nextIndex = (currentIndex + 1) % tabsState.tabs.length;
    switchTab(tabsState.tabs[nextIndex].id);
}

// 工具函数 - 切换到上一个标签页
function switchToPreviousTab() {
    const currentIndex = tabsState.tabs.findIndex(t => t.id === tabsState.currentTabId);
    const prevIndex = (currentIndex - 1 + tabsState.tabs.length) % tabsState.tabs.length;
    switchTab(tabsState.tabs[prevIndex].id);
}

// 工具函数 - 保存当前标签页
function saveCurrentTab() {
    const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
    if (!currentTab || !elements.textEditor) return;
    
    const text = elements.textEditor.value;
    const activeElement = document.activeElement;
    showProgress(true);
    
    setTimeout(() => {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        const fileName = currentTab.title || `文档_${new Date().toISOString().split('T')[0]}.txt`;
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        
        // 恢复焦点到之前的元素
        if (activeElement && activeElement.focus) {
            activeElement.focus();
        }
        
        // 更新标签页状态
        currentTab.isDirty = false;
        
        showNotification({
            title: '保存成功',
            message: '文档已保存到本地',
            type: 'success',
            duration: 3000
        });
    }, 800);
}

// 工具函数 - 清空当前标签页
async function clearCurrentTab() {
    const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
    if (!currentTab || !elements.textEditor) return;
    
    // 使用自定义确认对话框
    const confirmed = await showConfirmDialog({
        title: '确认清空',
        icon: '⚠️',
        message: '确定要清空当前标签页内容吗？\n\n• 此操作将删除当前标签页的所有内容\n• 操作不可撤销',
        confirmText: '确定清空',
        cancelText: '取消',
        confirmClass: 'btn-danger'
    });
    
    if (confirmed) {
        // 清空文本编辑器
        elements.textEditor.value = '';
        adjustTextareaHeight();
        
        // 更新标签页状态
        currentTab.content = '';
        currentTab.isDirty = true;
        
        // 向服务器发送清空请求
        if (socket && socket.connected) {
            socket.emit('text-update', '');
        }
        
        showNotification({
            title: '内容已清空',
            message: '当前标签页内容已清空',
            type: 'warning',
            duration: 4000 // 延长通知显示时间
        });
    }
}

// 工具函数 - 复制当前标签页文本
async function copyCurrentTabText() {
    if (!elements.textEditor) return;
    
    const text = elements.textEditor.value;
    
    if (!text) {
        showNotification({
            title: '无法复制',
            message: '没有内容可复制',
            type: 'warning',
            duration: 2000
        });
        return;
    }
    
    try {
        await navigator.clipboard.writeText(text);
        showNotification({
            title: '复制成功',
            message: '文本已复制到剪贴板',
            type: 'success',
            duration: 2000
        });
    } catch (err) {
        elements.textEditor.select();
        document.execCommand('copy');
        showNotification({
            title: '复制成功',
            message: '文本已复制到剪贴板',
            type: 'success',
            duration: 2000
        });
    }
}

// 工具函数 - 显示进度
function showProgress(show) {
    if (elements.progressContainer && elements.progressBar) {
        if (show) {
            elements.progressContainer.style.display = 'block';
            elements.progressBar.style.width = '0%';
            
            let progress = 0;
            const interval = setInterval(() => {
                progress += Math.random() * 10;
                elements.progressBar.style.width = progress + '%';
                
                if (progress >= 100) {
                    clearInterval(interval);
                    setTimeout(() => {
                        elements.progressContainer.style.display = 'none';
                    }, 300);
                }
            }, 100);
        } else {
            elements.progressContainer.style.display = 'none';
        }
    }
}

// 工具函数 - 滚动到顶部
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
    showNotification({
        title: '操作成功',
        message: '已滚动到页面顶部',
        type: 'success',
        duration: 2000
    });
}

// 标签页相关功能

// 设置标签页事件监听器
function setupTabsEventListeners() {
    // 新建标签页按钮
    elements.newTabBtn.addEventListener('click', createNewTab);
    
    // 标签页点击事件
    elements.tabsList.addEventListener('click', (e) => {
        const tabElement = e.target.closest('.tab');
        if (tabElement) {
            const tabId = tabElement.dataset.tabId;
            switchTab(tabId);
        }
    });
    
    // 标签页关闭按钮点击事件
    elements.tabsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) {
            e.stopPropagation();
            const tabElement = e.target.closest('.tab');
            const tabId = tabElement.dataset.tabId;
            closeTab(tabId);
        }
    });
    
    // 双击标签页重命名
    elements.tabsList.addEventListener('dblclick', (e) => {
        if (e.target.classList.contains('tab-title')) {
            const tabElement = e.target.closest('.tab');
            const tabId = tabElement.dataset.tabId;
            renameTab(tabId);
        }
    });
}

// 创建新标签页
function createNewTab() {
    tabsState.tabCounter++;
    const newTabId = `tab-${tabsState.tabCounter}`;
    
    // 创建标签页数据
    const newTab = {
        id: newTabId,
        title: '未命名文档',
        content: '',
        isActive: false,
        isDirty: false,
        filePath: null,
        isPreviewMode: false,
        lastEdited: Date.now()
    };
    
    // 添加到标签页列表
    tabsState.tabs.push(newTab);
    
    // 创建标签页DOM元素
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.dataset.tabId = newTabId;
    tabElement.setAttribute('role', 'tab');
    tabElement.setAttribute('aria-selected', 'false');
    tabElement.setAttribute('aria-controls', `panel-${newTabId}`);
    tabElement.setAttribute('tabindex', '-1');
    tabElement.innerHTML = `
        <span class="tab-title" title="未命名文档">未命名文档</span>
        <button class="tab-close" title="关闭标签页 (Ctrl+W)" aria-label="关闭未命名文档标签页">×</button>
    `;
    
    // 在标签列表末尾添加新标签页
    elements.tabsList.appendChild(tabElement);
    
    // 创建编辑器容器
    const editorContainer = document.createElement('div');
    editorContainer.className = 'editor-container';
    editorContainer.dataset.containerId = newTabId;
    editorContainer.setAttribute('role', 'tabpanel');
    editorContainer.setAttribute('id', `panel-${newTabId}`);
    editorContainer.setAttribute('aria-labelledby', `tab-${newTabId}`);
    editorContainer.innerHTML = `
        <label for="editor-${newTabId}" class="sr-only">文档编辑区域</label>
        <textarea 
            class="text-editor" 
            id="editor-${newTabId}"
            placeholder="开始输入...所有更改将实时同步到所有连接的设备"
            spellcheck="true"
            aria-label="文档编辑区域"
            aria-multiline="true"
        ></textarea>
        <div class="preview-panel" aria-label="Markdown预览" aria-live="polite"></div>
    `;
    
    elements.editorContainers.appendChild(editorContainer);
    
    // 切换到新标签页
    switchTab(newTabId);
    
    // 设置新标签页的事件监听器
    setupTabEventListeners(newTabId);
    
    // 向服务器发送新标签页创建事件
    if (socket && socket.connected && isJoined) {
        socket.emit('tab-create', newTab);
    }
    
    showNotification({
        title: '标签页已创建',
        message: '已创建新的标签页',
        type: 'success',
        duration: 2000
    });
}

// 切换标签页
function switchTab(tabId, fromServer = false) {
    // 保存当前标签页的状态
    saveCurrentTabState();
    
    // 更新标签页状态
    tabsState.tabs.forEach(tab => {
        tab.isActive = tab.id === tabId;
    });
    const oldTabId = tabsState.currentTabId;
    tabsState.currentTabId = tabId;
    
    // 更新DOM和ARIA属性
    document.querySelectorAll('.tab').forEach(tab => {
        const isActive = tab.dataset.tabId === tabId;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive);
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    
    document.querySelectorAll('.editor-container').forEach(container => {
        const isActive = container.dataset.containerId === tabId;
        container.classList.toggle('active', isActive);
        container.setAttribute('aria-hidden', !isActive);
    });
    
    // 更新编辑器引用
    updateEditorReferences();
    
    // 更新预览模式状态
    updatePreviewMode();
    
    // 调整文本区域高度
    adjustTextareaHeight();
    
    // 向服务器发送标签页切换事件（仅当不是来自服务器时）
    if (!fromServer && socket && socket.connected && isJoined) {
        socket.emit('tab-switch', { 
            oldTabId: oldTabId, 
            newTabId: tabId 
        });
    }
}

// 关闭标签页
async function closeTab(tabId) {
    // 检查是否是最后一个标签页
    if (tabsState.tabs.length === 1) {
        showNotification({
            title: '无法关闭',
            message: '至少需要保留一个标签页',
            type: 'warning',
            duration: 2000
        });
        return;
    }
    
    // 检查标签页是否有未保存的更改
    const tab = tabsState.tabs.find(t => t.id === tabId);
    if (tab.isDirty) {
        const confirmed = await showConfirmDialog({
            title: '确认关闭',
            icon: '⚠️',
            message: '当前标签页有未保存的更改，确定要关闭吗？',
            confirmText: '确定关闭',
            cancelText: '取消',
            confirmClass: 'btn-danger'
        });
        
        if (!confirmed) {
            return;
        }
    }
    
    // 找到要关闭的标签页的索引
    const tabIndex = tabsState.tabs.findIndex(t => t.id === tabId);
    
    // 找到要切换到的标签页
    let newActiveTabId;
    if (tabIndex === tabsState.tabs.length - 1) {
        // 如果是最后一个标签页，切换到前一个
        newActiveTabId = tabsState.tabs[tabIndex - 1].id;
    } else {
        // 否则切换到下一个
        newActiveTabId = tabsState.tabs[tabIndex + 1].id;
    }
    
    // 向服务器发送标签页关闭事件
    if (socket && socket.connected && isJoined) {
        socket.emit('tab-close', { tabId });
    }
    
    // 从状态中移除标签页
    tabsState.tabs = tabsState.tabs.filter(t => t.id !== tabId);
    
    // 从DOM中移除标签页
    const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement) {
        tabElement.remove();
    }
    
    // 从DOM中移除编辑器容器
    const editorContainer = document.querySelector(`[data-container-id="${tabId}"]`);
    if (editorContainer) {
        editorContainer.remove();
    }
    
    // 切换到新的活动标签页
    switchTab(newActiveTabId);
    
    showNotification({
        title: '标签页已关闭',
        message: '标签页已成功关闭',
        type: 'success',
        duration: 2000
    });
}

// 重命名标签页
function renameTab(tabId) {
    const tab = tabsState.tabs.find(t => t.id === tabId);
    const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    const titleElement = tabElement.querySelector('.tab-title');
    
    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.value = tab.title;
    input.className = 'tab-title-input';
    input.style.width = `${Math.max(titleElement.offsetWidth, 100)}px`;
    input.style.padding = '2px 4px';
    input.style.border = '1px solid var(--primary)';
    input.style.borderRadius = 'var(--radius-sm)';
    input.style.fontSize = '0.875rem';
    input.style.backgroundColor = 'var(--bg-primary)';
    input.style.color = 'var(--text-primary)';
    
    // 替换标题元素
    titleElement.replaceWith(input);
    
    // 聚焦输入框并选中所有文本
    input.focus();
    input.select();
    
    // 处理输入完成
    function handleInputComplete() {
        const newTitle = input.value.trim() || '未命名文档';
        
        // 更新标签页状态
        const oldTitle = tab.title;
        tab.title = newTitle;
        
        // 创建新的标题元素
        const newTitleElement = document.createElement('span');
        newTitleElement.className = 'tab-title';
        newTitleElement.textContent = newTitle;
        newTitleElement.title = newTitle;
        
        // 替换输入框
        input.replaceWith(newTitleElement);
        
        // 向服务器发送标签页重命名事件
        if (socket && socket.connected && isJoined) {
            socket.emit('tab-rename', { 
                tabId: tabId, 
                oldTitle: oldTitle, 
                newTitle: newTitle 
            });
        }
    }
    
    // 点击外部关闭
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !tabElement.contains(e.target)) {
            handleInputComplete();
        }
    }, { once: true });
    
    // 回车键确认
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleInputComplete();
        } else if (e.key === 'Escape') {
            // ESC键取消
            input.replaceWith(titleElement);
        }
    });
}

// 保存当前标签页状态
function saveCurrentTabState() {
    const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
    if (currentTab && elements.textEditor) {
        currentTab.content = elements.textEditor.value;
        currentTab.isPreviewMode = isPreviewMode;
    }
}

// 更新编辑器引用
function updateEditorReferences() {
    const activeContainer = document.querySelector('.editor-container.active');
    if (activeContainer) {
        elements.textEditor = activeContainer.querySelector('.text-editor');
        elements.previewPanel = activeContainer.querySelector('.preview-panel');
        elements.editorContainer = activeContainer;
        
        // 设置初始文本和事件监听器
        const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
        if (currentTab && elements.textEditor) {
            elements.textEditor.value = currentTab.content;
            adjustTextareaHeight();
        }
    }
}

// 更新预览模式状态
function updatePreviewMode() {
    const currentTab = tabsState.tabs.find(t => t.id === tabsState.currentTabId);
    if (currentTab) {
        isPreviewMode = currentTab.isPreviewMode;
        
        if (elements.editorContainer) {
            if (isPreviewMode) {
                elements.editorContainer.classList.add('split-mode');
                elements.togglePreviewBtn.classList.add('active');
                updatePreview();
            } else {
                elements.editorContainer.classList.remove('split-mode');
                elements.togglePreviewBtn.classList.remove('active');
            }
        }
    }
}

// 设置标签页的事件监听器
function setupTabEventListeners(tabId) {
    const container = document.querySelector(`[data-container-id="${tabId}"]`);
    const textarea = container.querySelector('.text-editor');
    
    if (!textarea) return;
    
    let saveTimeout;
    
    const debouncedTextUpdate = debounce(() => {
        const tab = tabsState.tabs.find(t => t.id === tabId);
        if (!tab) return;
        const oldText = tab.content;
        const newText = textarea.value;
        tab.content = newText;
        tab.isDirty = true;
        tab.lastEdited = Date.now();
        updateTabTitle(tabId);
        if (isPreviewMode) {
            updatePreview();
        }
        if (socket && socket.connected && isJoined) {
            const diff = calculateDiff(oldText, newText);
            socket.emit('text-update', {
                tabId: tabId,
                diff: diff,
                fullText: newText
            });
        }
    }, 300);
    
    const throttledCursorUpdate = throttle((cursorPos) => {
        if (socket && socket.connected && isJoined) {
            socket.emit('cursor-update', {
                position: cursorPos,
                tabId: tabId
            });
        }
    }, 100);
    
    const throttledRefreshCursors = throttle(refreshCursors, 50);
    
    textarea.addEventListener('input', () => {
        debouncedTextUpdate();
        adjustTextareaHeight();
    });
    
    textarea.addEventListener('scroll', () => {
        throttledRefreshCursors();
    });
    
    textarea.addEventListener('keyup', (e) => {
        const cursorPos = textarea.selectionStart;
        throttledCursorUpdate(cursorPos);
    });
    
    textarea.addEventListener('click', (e) => {
        const cursorPos = textarea.selectionStart;
        throttledCursorUpdate(cursorPos);
    });
}

// 更新标签页标题显示
function updateTabTitle(tabId) {
    const tab = tabsState.tabs.find(t => t.id === tabId);
    const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab && tabElement) {
        const titleElement = tabElement.querySelector('.tab-title');
        if (titleElement) {
            titleElement.textContent = tab.title;
            titleElement.title = tab.title;
        }
    }
}

// 全局错误处理
function setupGlobalErrorHandling() {
    // 捕获未处理的 JavaScript 错误
    window.addEventListener('error', (event) => {
        console.error('全局错误:', event.error);
        showNotification({
            title: '发生错误',
            message: '页面发生错误，请刷新重试',
            type: 'error',
            duration: 5000
        });
    });
    
    // 捕获未处理的 Promise 拒绝
    window.addEventListener('unhandledrejection', (event) => {
        console.error('未处理的 Promise 拒绝:', event.reason);
        showNotification({
            title: '异步操作错误',
            message: '操作失败，请重试',
            type: 'error',
            duration: 5000
        });
    });
}

// 键盘导航支持 - 标签页
function setupKeyboardNavigation() {
    // 标签页键盘导航
    elements.tabsList.addEventListener('keydown', (e) => {
        const tabs = Array.from(elements.tabsList.querySelectorAll('.tab'));
        const currentIndex = tabs.findIndex(tab => tab.classList.contains('active'));
        
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
                tabs[prevIndex].focus();
                switchTab(tabs[prevIndex].dataset.tabId);
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                const nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
                tabs[nextIndex].focus();
                switchTab(tabs[nextIndex].dataset.tabId);
                break;
            case 'Home':
                e.preventDefault();
                tabs[0].focus();
                switchTab(tabs[0].dataset.tabId);
                break;
            case 'End':
                e.preventDefault();
                tabs[tabs.length - 1].focus();
                switchTab(tabs[tabs.length - 1].dataset.tabId);
                break;
            case 'Delete':
            case 'Backspace':
                if (e.target.classList.contains('tab')) {
                    e.preventDefault();
                    closeTab(e.target.dataset.tabId);
                }
                break;
        }
    });
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupGlobalErrorHandling();
    setupKeyboardNavigation();
});
