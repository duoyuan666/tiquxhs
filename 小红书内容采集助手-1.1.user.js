// ==UserScript==
// @name         小红书内容采集助手
// @name:en     XiaoHongShu Content Scraper
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  采集小红书笔记的标题、正文内容和互动数据
// @description:en  Scrape content and interaction metrics from XiaoHongShu
// @author       哆元
// @match        https://www.xiaohongshu.com/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 添加样式
    GM_addStyle(`
        .xhs-scraper-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 9999;
            width: 300px;
        }
        .xhs-scraper-btn {
            background: #ff2442;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px 0;
            width: 100%;
            transition: all 0.3s ease;
        }
        .xhs-scraper-btn:hover {
            background: #e61e3c;
        }
        .xhs-scraper-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .xhs-scraper-btn.reset {
            background: #666;
        }
        .xhs-scraper-btn.reset:hover {
            background: #555;
        }
        .xhs-scraper-result {
            margin-top: 10px;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 4px;
            max-height: 200px;
            overflow-y: auto;
            word-break: break-all;
        }
        .xhs-scraper-radio-group {
            display: flex;
            gap: 15px;
            margin: 10px 0;
            font-size: 14px;
        }
        .xhs-scraper-radio-item {
            display: flex;
            align-items: center;
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 4px;
            border: 2px solid #ddd;
            transition: all 0.3s ease;
        }
        .xhs-scraper-radio-item:has(input:checked) {
            background-color: #ff2442;
            color: white;
            border-color: #ff2442;
        }
        .xhs-scraper-radio-item:not(:has(input:checked)):hover {
            border-color: #ff2442;
            color: #ff2442;
        }
        .xhs-scraper-radio-item input {
            display: none;
        }
        .xhs-scraper-count {
            margin-top: 10px;
            font-size: 14px;
            color: #666;
            text-align: center;
        }
    `);

    // 本地存储key
    const STORAGE_KEY = 'xhs_scraped_notes';

    // 获取已保存的笔记
    function getSavedNotes() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    // 保存笔记到本地存储
    function saveNote(note) {
        try {
            const notes = getSavedNotes();
            const currentUrl = window.location.href;
            const existingIndex = notes.findIndex(n => n.url === currentUrl);

            if (existingIndex !== -1) {
                notes[existingIndex] = { ...note, url: currentUrl };
            } else {
                notes.push({ ...note, url: currentUrl });
            }

            localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
            updateNoteCount();
        } catch (e) {
            console.error('保存笔记失败:', e);
        }
    }

    // 创建控制面板
    function createPanel() {
        const panel = document.createElement('div');
        panel.className = 'xhs-scraper-panel';

        // 检查当前是否在笔记页面
        const isNotePage = window.location.href.includes('/explore/') ||
                          window.location.href.includes('/discovery/');

        panel.innerHTML = `
            <h3 style="margin: 0 0 10px 0;">小红书内容采集</h3>
            <div class="xhs-scraper-radio-group">
                <div class="xhs-scraper-radio-item">
                    <input type="radio" id="keepTopics" name="topicsOption" value="keep">
                    <label for="keepTopics">保留话题标签</label>
                </div>
                <div class="xhs-scraper-radio-item">
                    <input type="radio" id="removeTopics" name="topicsOption" value="remove" checked>
                    <label for="removeTopics">移除话题标签</label>
                </div>
            </div>
            <button class="xhs-scraper-btn" id="scrapeBtn" ${!isNotePage ? 'disabled' : ''}>采集内容</button>
            <button class="xhs-scraper-btn" id="copyBtn">复制到剪贴板</button>
            <button class="xhs-scraper-btn" id="exportExcelBtn">导出Excel</button>
            <button class="xhs-scraper-btn reset" id="resetBtn">重置数据</button>
            <div class="xhs-scraper-count" id="noteCount">已采集 0 篇笔记</div>
            <div class="xhs-scraper-result" id="result">
                ${!isNotePage ? '请进入笔记页面以使用采集功能' : ''}
            </div>
        `;

        document.body.appendChild(panel);

        // 只在笔记页面绑定采集事件
        if (isNotePage) {
            const radioButtons = document.querySelectorAll('input[name="topicsOption"]');
            radioButtons.forEach(radio => {
                radio.addEventListener('change', () => {
                    if (window._lastScrapedContent) {
                        scrapeContent();
                    }
                });
            });

            document.getElementById('scrapeBtn').addEventListener('click', scrapeContent);
        }

        // 这些功能在所有页面都可用
        document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
        document.getElementById('exportExcelBtn').addEventListener('click', exportToExcel);
        document.getElementById('resetBtn').addEventListener('click', resetAllData);

        // 初始化笔记计数
        updateNoteCount();
    }

    // 提取话题标签
    function extractTopicTags(element) {
        const topicTags = [];
        element.querySelectorAll('a').forEach(el => {
            if (el.classList.contains('topic') ||
                el.classList.contains('tag-item') ||
                el.id === 'hash-tag' ||
                el.href.includes('/tag/') ||
                el.textContent.startsWith('#')) {
                let tag = el.textContent.trim();
                if (!tag.startsWith('#')) {
                    tag = '#' + tag;
                }
                if (!tag.endsWith('#')) {
                    tag = tag + '#';
                }
                topicTags.push(tag);
            }
        });
        return topicTags;
    }

    // 提取互动数据
    function extractMetrics() {
        try {
            const metrics = {
                likes: 0,
                favorites: 0,
                comments: 0
            };

            // 点赞数 - 使用精确的选择器来获取底部的点赞数
            const likesElem = document.querySelector('span[data-v-e5195060][class="count"][selected-disabled-search]');
            if (likesElem) {
                metrics.likes = parseInt(likesElem.textContent) || 0;
            }

            // 收藏数
            const collectElem = document.querySelector('.collect-wrapper .count');
            if (collectElem) {
                metrics.favorites = parseInt(collectElem.textContent) || 0;
            }

            // 评论数
            const commentElem = document.querySelector('.chat-wrapper .count');
            if (commentElem) {
                metrics.comments = parseInt(commentElem.textContent) || 0;
            }

            return metrics;
        } catch (error) {
            console.error('提取互动数据失败:', error);
            return {
                likes: 0,
                favorites: 0,
                comments: 0
            };
        }
    }

    // 重置所有数据
    function resetAllData() {
        if (confirm('确定要清空所有已采集的笔记吗？')) {
            localStorage.removeItem(STORAGE_KEY);
            window._lastScrapedContent = null;
            document.getElementById('result').innerHTML = '';
            updateNoteCount();
        }
    }

    // 更新笔记计数
    function updateNoteCount() {
        const count = getSavedNotes().length;
        const countDiv = document.getElementById('noteCount');
        if (countDiv) {
            countDiv.textContent = `已采集 ${count} 篇笔记`;
        }
    }

    // 采集内容
    function scrapeContent() {
        const resultDiv = document.getElementById('result');
        const includeTopics = document.querySelector('input[name="topicsOption"]:checked').value === 'keep';

        try {
            const title = document.querySelector('.note-detail .title') ||
                         document.querySelector('.note-content .title') ||
                         document.querySelector('.title') ||
                         document.querySelector('h1');

            const contentElement = document.querySelector('#detail-desc .note-text') ||
                                 document.querySelector('.note-content .content') ||
                                 document.querySelector('.note-detail .content') ||
                                 document.querySelector('.content') ||
                                 document.querySelector('.note-desc');

            if (!title || !contentElement) {
                resultDiv.innerHTML = '未找到内容，请确保在笔记页面使用';
                return;
            }

            let cleanContent = contentElement.cloneNode(true);
            const topicTags = extractTopicTags(cleanContent);

            cleanContent.querySelectorAll('a, button, .interact-item, .location-info, .ip-location').forEach(el => el.remove());

            let contentText = cleanContent.textContent
                .replace(/\s+/g, ' ')
                .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
                .replace(/([。！？，、；：])+/g, '$1')
                .trim();

            if (includeTopics && topicTags.length > 0) {
                contentText += '\n\n' + topicTags.join(' ');
            }

            // 获取互动数据
            const metrics = extractMetrics();

            const result = {
                url: window.location.href,
                title: title.textContent.trim(),
                content: contentText,
                timestamp: new Date().toISOString(),
                ...metrics
            };

            // 保存到本地存储
            saveNote(result);

            // 更新显示结果
            resultDiv.innerHTML = `
                <strong>标题：</strong><br>
                ${result.title}<br><br>
                <strong>正文：</strong><br>
                ${result.content.replace(/\n/g, '<br>')}<br><br>
                <strong>互动数据：</strong><br>
                点赞：${result.likes} | 收藏：${result.favorites} | 评论：${result.comments}
            `;

            window._lastScrapedContent = result;
        } catch (error) {
            resultDiv.innerHTML = '采集失败：' + error.message;
        }
    }

    // 复制到剪贴板
    function copyToClipboard() {
        const notes = getSavedNotes();
        if (notes.length === 0) {
            alert('还没有采集任何笔记！');
            return;
        }

        const textToCopy = notes.map(note =>
            `标题：${note.title}\n\n正文：${note.content}\n\n互动数据：点赞 ${note.likes} | 收藏 ${note.favorites} | 评论 ${note.comments}`
        ).join('\n\n-------------------\n\n');

        GM_setClipboard(textToCopy);
        alert('所有笔记内容已复制到剪贴板！');
    }

    // 导出为Excel
    function exportToExcel() {
        const notes = getSavedNotes();
        if (notes.length === 0) {
            alert('还没有采集任何笔记！');
            return;
        }

        // 按新的顺序创建 CSV 内容
        let csvContent = '链接,标题,正文,点赞数,收藏数,评论数,采集时间\n';
        csvContent += notes.map(note => {
            return [
                `"${note.url}"`,
                `"${note.title.replace(/"/g, '""')}"`,
                `"${note.content.replace(/"/g, '""')}"`,
                note.likes || 0,
                note.favorites || 0,
                note.comments || 0,
                `"${new Date(note.timestamp).toLocaleString()}"`
            ].join(',');
        }).join('\n');

        // 创建并下载文件
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `小红书笔记内容_${new Date().toLocaleDateString()}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // 等待页面加载完成后初始化
    window.addEventListener('load', function() {
        createPanel();
    });
})();