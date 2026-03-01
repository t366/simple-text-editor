/**
 * 工具函数模块
 * 包含差分计算、颜色生成和图标获取等通用功能
 * @module utils
 */

let dmpInstance = null;

function getDmpInstance() {
    if (!dmpInstance && typeof diff_match_patch !== 'undefined') {
        dmpInstance = new diff_match_patch();
    }
    return dmpInstance;
}

export function throttle(fn, limit) {
    let inThrottle;
    let lastArgs;
    return function executedFunction(...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
                if (lastArgs) {
                    fn.apply(this, lastArgs);
                    lastArgs = null;
                }
            }, limit);
        } else {
            lastArgs = args;
        }
    };
}

export function debounce(fn, delay) {
    let timeoutId;
    return function executedFunction(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * 差分计算函数 - 生成增量更新
 * 用于计算两个文本之间的差异，生成最小化的增量更新数据
 * @param {string} oldText - 原始文本
 * @param {string} newText - 新文本
 * @returns {Object} 增量更新数据
 * @returns {number} returns.start - 差异开始位置
 * @returns {number} returns.end - 差异结束位置
 * @returns {string} returns.text - 差异文本
 */
export function calculateDiff(oldText, newText) {
    const dmp = getDmpInstance();
    
    if (!dmp) {
        let start = 0;
        while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
            start++;
        }
        
        let endOld = oldText.length;
        let endNew = newText.length;
        while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
            endOld--;
            endNew--;
        }
        
        return {
            start: start,
            end: endOld,
            text: newText.substring(start, endNew)
        };
    }
    
    const diffs = dmp.diff_main(oldText, newText);
    dmp.diff_cleanupSemantic(diffs);
    
    // 计算变化范围
    let start = 0;
    let endOld = oldText.length;
    let endNew = newText.length;
    
    // 遍历差异，找到变化的起始和结束位置
    let startSet = false;
    for (let i = 0; i < diffs.length; i++) {
        const [type, text] = diffs[i];
        
        if (type !== 0) { // 0表示相同，-1表示删除，1表示添加
            // 找到第一个差异的位置
            if (!startSet) {
                // 计算差异开始的位置
                let pos = 0;
                for (let j = 0; j < i; j++) {
                    if (diffs[j][0] !== 1) { // 跳过添加的内容（在原文本中的位置）
                        pos += diffs[j][1].length;
                    }
                }
                start = pos;
                startSet = true;
            }
            
            // 计算差异结束的位置（不断更新直到最后一个差异）
            // 计算原始文本中差异结束的位置
            let posOld = 0;
            for (let j = 0; j <= i; j++) {
                if (diffs[j][0] !== 1) { // 跳过添加的内容
                    posOld += diffs[j][1].length;
                }
            }
            endOld = posOld;
            
            // 计算新文本中差异结束的位置
            let posNew = 0;
            for (let j = 0; j <= i; j++) {
                if (diffs[j][0] !== -1) { // 跳过删除的内容
                    posNew += diffs[j][1].length;
                }
            }
            endNew = posNew;
        }
    }
    
    // 生成增量更新数据
    return {
        start: start,
        end: endOld,
        text: newText.substring(start, endNew)
    };
}

/**
 * 计算新的光标位置（基于增量更新）
 * @param {number} cursorPos - 当前光标位置
 * @param {number} start - 变更起始位置
 * @param {number} end - 变更结束位置
 * @param {string} text - 插入的文本
 * @returns {number} 新的光标位置
 */
export function transformCursor(cursorPos, start, end, text) {
    if (cursorPos <= start) {
        // 光标在变更区域之前，位置不变
        return cursorPos;
    } else if (cursorPos >= end) {
        // 光标在变更区域之后，位置加上插入文本长度减去删除文本长度
        return cursorPos + (text.length - (end - start));
    } else {
        // 光标在变更区域内部，移动到变更结束位置
        return start + text.length;
    }
}

/**
 * 计算新的光标位置（基于文本差异）
 * @param {number} cursorPos - 当前光标位置
 * @param {string} oldText - 原始文本
 * @param {string} newText - 新文本
 * @returns {number} 新的光标位置
 */
export function getNewCursorPosition(cursorPos, oldText, newText) {
    const dmp = getDmpInstance();
    
    if (!dmp) {
        if (cursorPos === oldText.length) return newText.length;
        return Math.min(cursorPos, newText.length);
    }

    const diffs = dmp.diff_main(oldText, newText);
    
    let oldIndex = 0;
    let newIndex = 0;
    
    for (const [type, text] of diffs) {
        const length = text.length;
        
        if (type === 0) { // Equality
            if (oldIndex + length > cursorPos) {
                // 光标在这个 equality 块中
                return newIndex + (cursorPos - oldIndex);
            }
            oldIndex += length;
            newIndex += length;
        } else if (type === -1) { // Deletion
            if (oldIndex + length > cursorPos) {
                // 光标在被删除的块中 -> 移动到删除块的开始（即当前的 newIndex）
                return newIndex;
            }
            oldIndex += length;
        } else if (type === 1) { // Insertion
            // 插入内容，oldIndex 不变，newIndex 增加
            newIndex += length;
        }
    }
    
    return newIndex; // 如果光标在最后
}

/**
 * 插入 Markdown 语法
 * @param {HTMLTextAreaElement} textarea - 文本区域元素
 * @param {string} type - 格式类型
 */
export function insertMarkdownSyntax(textarea, type) {
    if (!textarea) return;

    let prefix = '';
    let suffix = '';
    
    switch (type) {
        case 'bold':
            prefix = '**';
            suffix = '**';
            break;
        case 'italic':
            prefix = '*';
            suffix = '*';
            break;
        case 'underline':
            prefix = '<u>';
            suffix = '</u>';
            break;
        case 'strikethrough':
            prefix = '~~';
            suffix = '~~';
            break;
        case 'h1':
            prefix = '# ';
            suffix = '';
            break;
        case 'h2':
            prefix = '## ';
            suffix = '';
            break;
        case 'h3':
            prefix = '### ';
            suffix = '';
            break;
        case 'ul':
            prefix = '- ';
            suffix = '';
            break;
        case 'ol':
            prefix = '1. ';
            suffix = '';
            break;
        case 'quote':
            prefix = '> ';
            suffix = '';
            break;
        case 'code':
            prefix = '```\n';
            suffix = '\n```';
            break;
        case 'link':
            prefix = '[';
            suffix = '](url)';
            break;
        case 'time':
            const now = new Date();
            prefix = now.toLocaleString();
            suffix = '';
            break;
        default:
            return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    
    // 特殊处理多行文本的列表和引用
    if ((type === 'ul' || type === 'ol' || type === 'quote') && selectedText.includes('\n')) {
        const lines = selectedText.split('\n');
        const newLines = lines.map((line, index) => {
             if (type === 'ol') return `${index + 1}. ${line}`;
             return `${prefix}${line}`;
        });
        const newSelectedText = newLines.join('\n');
        
        textarea.value = text.substring(0, start) + newSelectedText + text.substring(end);
        
        // 保持选中状态
        textarea.setSelectionRange(start, start + newSelectedText.length);
    } else if (type === 'link') {
         // 链接特殊处理
         if (selectedText) {
             textarea.value = text.substring(0, start) + `[${selectedText}](url)` + text.substring(end);
             // 选中 url 部分以便用户编辑
             textarea.setSelectionRange(start + selectedText.length + 3, start + selectedText.length + 6);
         } else {
             textarea.value = text.substring(0, start) + `[链接文字](url)` + text.substring(end);
             textarea.setSelectionRange(start + 1, start + 5);
         }
    } else if (type === 'code' && !selectedText.includes('\n') && selectedText.length < 50) {
        // 单行代码使用行内代码块
        textarea.value = text.substring(0, start) + '`' + selectedText + '`' + text.substring(end);
        if (start === end) {
            textarea.setSelectionRange(start + 1, start + 1);
        } else {
            textarea.setSelectionRange(start, end + 2);
        }
    } else {
        // 标准处理
        textarea.value = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
        
        if (start === end) {
            // 没有选中文字，光标放在中间
            const newCursorPos = start + prefix.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
        } else {
            // 保持选中状态，包含格式标记
            textarea.setSelectionRange(start, end + prefix.length + suffix.length);
        }
    }
    
    // 触发 input 事件以通知应用更新
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
}

/**
 * 根据用户ID生成颜色
 * 用于为不同用户分配唯一的颜色标识
 * @param {string} userId - 用户ID
 * @returns {string} 十六进制颜色代码
 */
export function getColorForUser(userId) {
    const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

/**
 * 根据通知类型获取图标
 * 用于显示不同类型通知的图标
 * @param {string} type - 通知类型 (success, error, warning, info)
 * @returns {string} 通知图标
 */
export function getIconForType(type) {
    const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'i'
    };
    return icons[type] || 'i';
}
