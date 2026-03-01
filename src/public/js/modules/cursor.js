// 光标管理模块 - 使用 Mirror Div 方案实现精确光标定位

import { getColorForUser } from './utils.js';

let otherCursors = {};
let elements = {};

// 存储最后一次的光标数据和文本
let lastCursorData = {};
let lastText = '';
let mirrorDiv = null;

// 初始化光标模块
export function initCursor(domElements) {
    elements = domElements;
    
    // 页面卸载时清理资源
    window.addEventListener('beforeunload', cleanup);
}

// 清理资源
export function cleanup() {
    // 移除所有光标元素
    Object.values(otherCursors).forEach(cursor => {
        if (cursor && cursor.parentNode) {
            cursor.parentNode.removeChild(cursor);
        }
    });
    otherCursors = {};
    lastCursorData = {};
    lastText = '';
    
    // 移除 Mirror Div
    if (mirrorDiv && mirrorDiv.parentNode) {
        mirrorDiv.parentNode.removeChild(mirrorDiv);
        mirrorDiv = null;
    }
}

// 更新光标
export function updateCursor(data, currentText) {
    const textarea = elements.textEditor;
    if (!textarea) return;
    
    // 添加空值检查
    if (!data || typeof data.position !== 'number') return;
    
    // 保存最新的数据
    if (data.userId) {
        lastCursorData[data.userId] = data;
    }
    lastText = currentText;
    
    renderCursor(data, currentText);
}

// 刷新所有光标（用于滚动或窗口调整大小）
export function refreshCursors() {
    const textarea = elements.textEditor;
    if (!textarea) return;
    
    // 重新同步 Mirror Div 的尺寸
    if (mirrorDiv) {
        const computedStyle = window.getComputedStyle(textarea);
        mirrorDiv.style.width = computedStyle.width;
    }
    
    Object.values(lastCursorData).forEach(data => {
        renderCursor(data, lastText);
    });
}

// 创建或获取 Mirror Div
function getMirrorDiv(textarea) {
    if (mirrorDiv) return mirrorDiv;

    mirrorDiv = document.createElement('div');
    document.body.appendChild(mirrorDiv);
    
    const computedStyle = window.getComputedStyle(textarea);
    
    // 复制关键样式
    const properties = [
        'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
        'textAlign', 'textTransform', 'textIndent', 'textDecoration',
        'letterSpacing', 'wordSpacing',
        'tabSize', 'MozTabSize'
    ];

    properties.forEach(prop => {
        mirrorDiv.style[prop] = computedStyle[prop];
    });
    
    // 确保 Mirror Div 不可见但可测量
    mirrorDiv.style.position = 'absolute';
    mirrorDiv.style.top = '0px';
    mirrorDiv.style.left = '-9999px'; // 移出可视区域
    mirrorDiv.style.visibility = 'hidden';
    mirrorDiv.style.whiteSpace = 'pre-wrap'; // 关键：保持换行行为
    mirrorDiv.style.wordWrap = 'break-word'; // 关键：保持断行行为

    return mirrorDiv;
}

// 内部渲染函数
function renderCursor(data, currentText) {
    const textarea = elements.textEditor;
    if (!textarea) return;
    
    const cursorId = 'cursor-' + (data.userId || 'unknown');
    
    // 获取编辑器容器
    const editorBody = textarea.closest('.editor-body');
    if (!editorBody) return;
    
    // 创建或获取光标元素
    let cursorMarker = document.getElementById(cursorId);
    if (!cursorMarker) {
        cursorMarker = document.createElement('div');
        cursorMarker.id = cursorId;
        cursorMarker.className = 'cursor-marker';
        editorBody.appendChild(cursorMarker);
        otherCursors[data.userId || 'unknown'] = cursorMarker;
    }
    
    // 准备 Mirror Div
    const mirror = getMirrorDiv(textarea);
    
    // 确保宽度同步 (处理窗口缩放)
    mirror.style.width = window.getComputedStyle(textarea).width;
    
    // 截取光标前的文本
    const textBeforeCursor = currentText.substring(0, data.position);
    // 截取光标后的文本 (为了正确处理行高，虽然对于坐标计算不是必须的，但有助于保持布局一致)
    const textAfterCursor = currentText.substring(data.position);
    
    // 创建标记元素
    const span = document.createElement('span');
    span.textContent = '|'; // 使用一个字符来撑开高度
    
    // 清空 Mirror Div 并重组内容
    mirror.textContent = textBeforeCursor;
    mirror.appendChild(span);
    mirror.appendChild(document.createTextNode(textAfterCursor));
    
    // 计算相对坐标
    // 注意：Mirror Div 的坐标系是相对于 viewport 的，我们需要相对于 textarea 内容区域的坐标
    // span.offsetLeft 和 span.offsetTop 是相对于 offsetParent (即 mirrorDiv) 的
    
    const spanTop = span.offsetTop;
    const spanLeft = span.offsetLeft;
    
    // 获取 Textarea 的内边距和边框
    const computedStyle = window.getComputedStyle(textarea);
    const paddingTop = parseInt(computedStyle.paddingTop);
    const paddingLeft = parseInt(computedStyle.paddingLeft);
    const borderTop = parseInt(computedStyle.borderTopWidth);
    const borderLeft = parseInt(computedStyle.borderLeftWidth);
    
    // 计算最终坐标
    // Mirror Div 已经包含了 padding 和 border 的影响（因为复制了样式），span.offsetTop 是相对于内容区域左上角的
    // 但 Mirror Div 的 box-sizing 可能是 border-box。
    // 如果是 border-box，width 包含 padding/border。
    // 简单起见，我们直接使用 span 的 offsetTop，这通常是相对于父容器的 content box 或 padding box。
    
    // 修正：由于 Mirror Div 复制了 padding，span 的 offsetTop 实际上是包含 padding 的距离
    // 我们需要再次确认。
    // 在 Mirror Div 中，文本是从 content box 开始渲染的。
    // span.offsetTop 是相对于 mirrorDiv 的边框左上角（如果 position 不是 static）或者包含块。
    // 我们的 mirrorDiv position 是 absolute。
    
    // 实际上，直接复制样式后，Mirror Div 的布局结构与 Textarea 内容区一致。
    // span 的位置就是光标在文档流中的位置。
    
    const scrollTop = textarea.scrollTop;
    
    // 坐标计算：
    // spanTop 是相对于 Mirror Div 顶部的距离
    // 我们需要加上 textarea 相对于 editorBody 的偏移（通常是 0，因为 editorBody 是相对定位容器）
    // 还需要减去 scrollTop
    
    // 还要加上 Textarea 自身的偏移（如果有）
    const textareaRect = textarea.getBoundingClientRect();
    const containerRect = editorBody.getBoundingClientRect();
    
    // 计算 textarea 在 container 中的相对位置
    const offsetInContainerTop = textareaRect.top - containerRect.top;
    const offsetInContainerLeft = textareaRect.left - containerRect.left;
    
    // 最终位置
    const top = spanTop + offsetInContainerTop - scrollTop;
    const left = spanLeft + offsetInContainerLeft;
    
    // 边界检查
    const textareaHeight = textarea.clientHeight;
    // 获取行高作为缓冲
    let lineHeight = parseFloat(computedStyle.lineHeight);
    if (isNaN(lineHeight)) lineHeight = parseFloat(computedStyle.fontSize) * 1.2;
    
    if (top < offsetInContainerTop - lineHeight || top > offsetInContainerTop + textareaHeight) {
        cursorMarker.style.display = 'none';
    } else {
        cursorMarker.style.display = 'block';
    }
    
    // 更新样式
    cursorMarker.style.height = lineHeight + 'px';
    cursorMarker.style.transform = `translate(${left}px, ${top}px)`;
    cursorMarker.style.backgroundColor = getColorForUser(data.userId || 'unknown');
    
    // 更新标签
    let label = cursorMarker.querySelector('.cursor-label');
    if (!label) {
        label = document.createElement('div');
        label.className = 'cursor-label';
        cursorMarker.appendChild(label);
    }
    label.textContent = data.name || '未知用户';
    label.style.backgroundColor = getColorForUser(data.userId || 'unknown');
}

// 移除光标
export function removeCursor(userId) {
    const cursorId = 'cursor-' + userId;
    const cursorEl = document.getElementById(cursorId);
    if (cursorEl) {
        cursorEl.remove();
    }
    delete otherCursors[userId];
    delete lastCursorData[userId];
}
