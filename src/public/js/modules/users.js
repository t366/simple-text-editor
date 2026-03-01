// 用户管理模块

import { getColorForUser } from './utils.js';

let elements = {};

// 初始化用户模块
export function initUsers(domElements) {
    elements = domElements;
}

// 更新用户列表
export function updateUserList(users, currentUserId) {
    if (!elements.usersList || !elements.userCount) return;
    
    // 更新用户数量
    elements.userCount.textContent = users.length;
    
    // 使用文档片段批量更新DOM，减少重绘和回流
    const fragment = document.createDocumentFragment();
    
    // 分离当前用户和其他用户
    const currentUser = users.find(user => user && user.id === currentUserId);
    const otherUsers = users.filter(user => user && user.id !== currentUserId);
    
    // 合并用户列表，当前用户在第一个位置
    const sortedUsers = currentUser ? [currentUser, ...otherUsers] : otherUsers;
    
    sortedUsers.forEach(user => {
        // 添加严格的空值和类型检查
        if (!user || typeof user !== 'object') return;
        
        const li = document.createElement('li');
        li.className = 'user-item';
        
        // 为当前用户添加特殊样式
        if (currentUserId && user.id === currentUserId) {
            li.classList.add('current-user');
        }
        
        // 创建DOM元素，避免使用innerHTML
        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.style.backgroundColor = getColorForUser(user.id || 'default');
        avatar.textContent = (user.name || '未知用户').charAt(0);
        
        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';
        
        const userName = document.createElement('div');
        userName.className = 'user-name';
        userName.textContent = user.name || '未知用户';
        
        const userDevice = document.createElement('div');
        userDevice.className = 'user-device';
        userDevice.textContent = user.device || '未知设备';
        
        userInfo.appendChild(userName);
        userInfo.appendChild(userDevice);
        
        li.appendChild(avatar);
        li.appendChild(userInfo);
        
        fragment.appendChild(li);
    });
    
    // 清空列表并添加新元素（一次DOM操作）
    elements.usersList.innerHTML = '';
    elements.usersList.appendChild(fragment);
}
