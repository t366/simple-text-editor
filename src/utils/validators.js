const validator = require('validator');
const sanitizeHtml = require('sanitize-html');
const config = require('../config');

const MAX_TITLE_LENGTH = 100;

function validateText(text) {
    if (typeof text !== 'string') {
        return false;
    }
    return text.length <= config.MAX_TEXT_SIZE;
}

function validateCursorPosition(pos) {
    return Number.isFinite(pos) && pos >= 0 && Number.isInteger(pos);
}

function validateAndCleanUsername(username) {
    let validatedUsername = username;
    
    if (username && typeof username === 'string') {
        validatedUsername = validator.escape(username.trim());
        if (validatedUsername.length > 50) {
            validatedUsername = validatedUsername.substring(0, 50);
        }
        if (validatedUsername.length === 0) {
            validatedUsername = null;
        }
    } else {
        validatedUsername = null;
    }
    
    return validatedUsername;
}

function validateAndCleanTitle(title) {
    if (!title || typeof title !== 'string') {
        return '未命名文档';
    }
    
    let cleanedTitle = title.trim();
    
    cleanedTitle = sanitizeHtml(cleanedTitle, {
        allowedTags: [],
        allowedAttributes: {},
        textFilter: function(text) {
            return text;
        }
    });
    
    cleanedTitle = validator.escape(cleanedTitle);
    
    cleanedTitle = cleanedTitle
        .replace(/<[^>]*>/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '')
        .replace(/data:/gi, '');
    
    if (cleanedTitle.length > MAX_TITLE_LENGTH) {
        cleanedTitle = cleanedTitle.substring(0, MAX_TITLE_LENGTH);
    }
    
    if (cleanedTitle.length === 0) {
        cleanedTitle = '未命名文档';
    }
    
    return cleanedTitle;
}

function validateTabId(tabId) {
    if (!tabId || typeof tabId !== 'string') {
        return false;
    }
    
    return /^tab-[a-zA-Z0-9_-]+$/.test(tabId);
}

function sanitizeText(text) {
    return sanitizeHtml(text, {
        allowedTags: [],
        allowedAttributes: {},
        textFilter: function(text) {
            return text;
        }
    });
}

module.exports = {
    validateText,
    validateCursorPosition,
    validateAndCleanUsername,
    validateAndCleanTitle,
    validateTabId,
    sanitizeText,
    MAX_TITLE_LENGTH
};
