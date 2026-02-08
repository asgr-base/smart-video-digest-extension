/**
 * @file Background service worker for Smart Video Digest
 */
(function () {
  'use strict';

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
    .catch(function (err) {
      console.error('[SVD-BG] Failed to set panel behavior:', err);
    });

  // --- Context Menu ---
  function createContextMenu() {
    chrome.contextMenus.removeAll(function () {
      chrome.commands.getAll(function (commands) {
        var cmd = commands.find(function (c) { return c.name === '_execute_action'; });
        var shortcutLabel = cmd && cmd.shortcut ? '  (' + cmd.shortcut + ')' : '';
        var title = chrome.i18n.getMessage('contextMenuSummarize') ||
          'Summarize this video';
        chrome.contextMenus.create({
          id: 'svd-summarize',
          title: title + shortcutLabel,
          contexts: ['page'],
          documentUrlPatterns: ['https://www.youtube.com/watch*']
        });
      });
    });
  }

  chrome.runtime.onInstalled.addListener(createContextMenu);
  chrome.runtime.onStartup.addListener(createContextMenu);

  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId === 'svd-summarize' && tab) {
      openPanelAndSummarize(tab);
    }
  });

  function openPanelAndSummarize(tab) {
    chrome.sidePanel.open({ tabId: tab.id }).then(function () {
      setTimeout(function () {
        chrome.runtime.sendMessage({ type: 'startSummarize' }).catch(function () {});
      }, 300);
    });
  }

  chrome.action.onClicked.addListener(function (tab) {
    console.log('[SVD-BG] Action clicked, tab:', tab.id);
    openPanelAndSummarize(tab);
  });

  // --- Message routing ---
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'extractTranscript') {
      handleExtractTranscript(sendResponse);
      return true;
    }
  });

  async function handleExtractTranscript(sendResponse) {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs[0];

      if (!tab || !tab.id) {
        sendResponse({ success: false, error: 'noActiveTab' });
        return;
      }

      if (!isYouTubeWatch(tab.url)) {
        sendResponse({ success: false, error: 'notYouTube' });
        return;
      }

      try {
        var response = await chrome.tabs.sendMessage(tab.id, { type: 'extractTranscript' });
        sendResponse(response);
      } catch (err) {
        console.log('[SVD-BG] Content script not ready, injecting:', err.message);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['config.js', 'content.js']
          });
          await new Promise(function (r) { setTimeout(r, 200); });
          var retryResponse = await chrome.tabs.sendMessage(tab.id, { type: 'extractTranscript' });
          sendResponse(retryResponse);
        } catch (injectErr) {
          sendResponse({ success: false, error: 'injectionFailed', message: injectErr.message });
        }
      }
    } catch (err) {
      sendResponse({ success: false, error: 'backgroundError', message: err.message });
    }
  }

  function isYouTubeWatch(url) {
    if (!url) return false;
    return url.startsWith('https://www.youtube.com/watch');
  }
})();
