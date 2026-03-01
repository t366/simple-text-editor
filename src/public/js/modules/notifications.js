// 通知系统模块

import { getIconForType } from './utils.js';

let notificationId = 0;
let elements = {};

// 初始化通知模块
export function initNotifications(domElements) {
    elements = domElements;
    
    // 使用事件委托处理关闭按钮点击
    if (elements.notificationContainer) {
        elements.notificationContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('notification-close')) {
                const notification = e.target.closest('.notification');
                if (notification) {
                    removeNotification(notification.id);
                }
            }
        });
    }
}

// 显示通知
export function showNotification(options) {
    const {
        title = '提示',
        message,
        type = 'info',
        duration = 5000,
        icon = getIconForType(type),
        showClose = true
    } = options;
    
    // 使用正确的元素 ID: notificationContainer
    const system = elements.notificationContainer;
    if (!system) {
        console.error('无法找到通知容器');
        return;
    }
    
    const id = `notification-${++notificationId}`;
    
    const notification = document.createElement('div');
    notification.id = id;
    notification.className = `notification ${type}`;
    notification.setAttribute('role', 'alert');
    
    const timeString = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    notification.innerHTML = `
        <div class="notification-icon" aria-hidden="true">${icon}</div>
        <div class="notification-content">
            <div class="notification-title">
                <span>${escapeHtml(title)}</span>
                <span class="notification-time">${timeString}</span>
            </div>
            <div class="notification-message">${escapeHtml(message)}</div>
        </div>
        ${showClose ? '<button class="notification-close" aria-label="关闭通知">×</button>' : ''}
    `;
    
    system.appendChild(notification);
    
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });
    
    if (duration > 0) {
        setTimeout(() => {
            if (document.getElementById(id)) {
                removeNotification(id);
            }
        }, duration);
    }
    
    return id;
}

// 移除通知
export function removeNotification(id) {
    const notification = document.getElementById(id);
    if (notification) {
        notification.classList.add('hide');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 400);
    }
}

// HTML 转义函数，防止 XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
