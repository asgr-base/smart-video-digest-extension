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

  // --- Extract player data from page's MAIN world ---
  async function extractPlayerData(tabId) {
    try {
      var results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: function () {
          try {
            var p = window.ytInitialPlayerResponse;
            if (!p) {
              // Fallback: try ytplayer.config.args.raw_player_response
              try {
                if (window.ytplayer && window.ytplayer.config &&
                    window.ytplayer.config.args &&
                    window.ytplayer.config.args.raw_player_response) {
                  p = window.ytplayer.config.args.raw_player_response;
                }
              } catch (e) {}
            }
            if (!p) return null;

            var chaptersData = null;
            try {
              var d = window.ytInitialData;
              if (d) {
                var po = d.playerOverlays;
                if (po && po.playerOverlayRenderer &&
                    po.playerOverlayRenderer.decoratedPlayerBarRenderer) {
                  var dpb = po.playerOverlayRenderer.decoratedPlayerBarRenderer
                    .decoratedPlayerBarRenderer;
                  if (dpb && dpb.playerBar &&
                      dpb.playerBar.multiMarkersPlayerBarRenderer) {
                    chaptersData = dpb.playerBar.multiMarkersPlayerBarRenderer.markersMap;
                  }
                }
              }
            } catch (e) {}

            return {
              captions: p.captions || null,
              videoDetails: p.videoDetails || null,
              chaptersData: chaptersData
            };
          } catch (e) {
            return null;
          }
        }
      });

      return results && results[0] ? results[0].result : null;
    } catch (err) {
      console.warn('[SVD-BG] executeScript MAIN world failed:', err.message);
      return null;
    }
  }

  // --- Message routing ---
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'extractTranscript') {
      handleExtractTranscript(message, sendResponse);
      return true;
    }
  });

  async function handleExtractTranscript(message, sendResponse) {
    try {
      var tab;
      if (message.tabId) {
        try {
          tab = await chrome.tabs.get(message.tabId);
        } catch (e) {
          // Tab may have been closed, fall back to active tab
          var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tab = tabs[0];
        }
      } else {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs[0];
      }

      if (!tab || !tab.id) {
        sendResponse({ success: false, error: 'noActiveTab' });
        return;
      }

      if (!isYouTubeWatch(tab.url)) {
        sendResponse({ success: false, error: 'notYouTube' });
        return;
      }

      // Step 1: Extract player data from page's MAIN world
      var playerData = await extractPlayerData(tab.id);
      console.log('[SVD-BG] MAIN world result:', playerData ? 'OK' : 'null',
        playerData ? 'captions=' + !!playerData.captions : '',
        playerData && playerData.videoDetails ? 'video=' + playerData.videoDetails.videoId : '');

      // Verify MAIN world data matches the tab's current video (may be stale after SPA navigation)
      try {
        var tabUrl = new URL(tab.url);
        var urlVideoId = tabUrl.searchParams.get('v');
        if (playerData && playerData.videoDetails &&
            playerData.videoDetails.videoId && urlVideoId &&
            playerData.videoDetails.videoId !== urlVideoId) {
          console.log('[SVD-BG] MAIN world data stale (got', playerData.videoDetails.videoId,
            'expected', urlVideoId + '), discarding');
          playerData = null;
        }
      } catch (e) { /* ignore URL parse error */ }

      // Step 2: Send player data to content script for transcript fetch
      var msg = { type: 'extractTranscript', playerData: playerData };

      var csResponse;
      try {
        csResponse = await chrome.tabs.sendMessage(tab.id, msg);
      } catch (err) {
        console.log('[SVD-BG] Content script not ready, injecting:', err.message);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['config.js', 'content.js']
          });
          await new Promise(function (r) { setTimeout(r, 500); });
          csResponse = await chrome.tabs.sendMessage(tab.id, msg);
        } catch (injectErr) {
          sendResponse({ success: false, error: 'injectionFailed', message: injectErr.message });
          return;
        }
      }
      console.log('[SVD-BG] Content script response:', JSON.stringify(csResponse).substring(0, 200));
      sendResponse(csResponse);
    } catch (err) {
      sendResponse({ success: false, error: 'backgroundError', message: err.message });
    }
  }

  function isYouTubeWatch(url) {
    if (!url) return false;
    return url.startsWith('https://www.youtube.com/watch');
  }
})();
