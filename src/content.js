/**
 * @file Content script for YouTube transcript and chapter extraction
 */
(function () {
  'use strict';

  var config = globalThis.SVD_CONFIG;

  // --- Get video ID from current URL ---
  function getVideoIdFromURL() {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get('v') || '';
    } catch (e) {
      return '';
    }
  }

  // --- Fallback 1: fetch page HTML and parse player data ---
  async function fetchPlayerDataFromHTML() {
    try {
      var resp = await fetch(window.location.href);
      var html = await resp.text();

      var playerData = extractJSONVar(html, 'ytInitialPlayerResponse');
      if (!playerData) {
        console.warn('[SVD] Could not extract ytInitialPlayerResponse from HTML');
        return null;
      }

      var chaptersData = null;
      var initialData = extractJSONVar(html, 'ytInitialData');
      if (initialData) {
        try {
          var po = initialData.playerOverlays;
          if (po && po.playerOverlayRenderer &&
              po.playerOverlayRenderer.decoratedPlayerBarRenderer) {
            var dpb = po.playerOverlayRenderer.decoratedPlayerBarRenderer
              .decoratedPlayerBarRenderer;
            if (dpb && dpb.playerBar &&
                dpb.playerBar.multiMarkersPlayerBarRenderer) {
              chaptersData = dpb.playerBar.multiMarkersPlayerBarRenderer.markersMap;
            }
          }
        } catch (e) { /* ignore */ }
      }

      console.log('[SVD] HTML fallback: captions=', !!playerData.captions);
      return {
        captions: playerData.captions || null,
        videoDetails: playerData.videoDetails || null,
        chaptersData: chaptersData
      };
    } catch (e) {
      console.warn('[SVD] fetchPlayerDataFromHTML failed:', e.message);
      return null;
    }
  }

  // --- Fallback 2: YouTube innertube player API ---
  async function fetchPlayerDataFromAPI(videoId) {
    try {
      var response = await fetch('/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: videoId,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20260101.00.00',
              hl: document.documentElement.lang || 'en'
            }
          }
        })
      });
      if (!response.ok) {
        console.warn('[SVD] innertube API returned', response.status);
        return null;
      }
      var data = await response.json();
      console.log('[SVD] innertube API: captions=', !!data.captions,
        'tracks=', data.captions && data.captions.playerCaptionsTracklistRenderer
          ? data.captions.playerCaptionsTracklistRenderer.captionTracks.length : 0);
      return {
        captions: data.captions || null,
        videoDetails: data.videoDetails || null,
        chaptersData: null
      };
    } catch (e) {
      console.warn('[SVD] fetchPlayerDataFromAPI failed:', e.message);
      return null;
    }
  }

  // --- Extract JSON variable from HTML string ---
  function extractJSONVar(html, varName) {
    var patterns = ['var ' + varName + ' = ', varName + ' = '];
    for (var p = 0; p < patterns.length; p++) {
      var idx = html.indexOf(patterns[p]);
      if (idx === -1) continue;
      idx += patterns[p].length;

      // Method 1: find "};" terminator and try JSON.parse
      var semiIdx = idx;
      while (true) {
        semiIdx = html.indexOf('};', semiIdx);
        if (semiIdx === -1) break;
        try {
          return JSON.parse(html.substring(idx, semiIdx + 1));
        } catch (e) {
          semiIdx++;
        }
      }

      // Method 2: bracket matching fallback
      var result = bracketMatchJSON(html, idx);
      if (result) return result;
    }
    return null;
  }

  function bracketMatchJSON(html, startIdx) {
    var depth = 0;
    var inString = false;
    var escapeNext = false;

    for (var i = startIdx; i < html.length; i++) {
      var ch = html.charAt(i);
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === '\\' && inString) { escapeNext = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.substring(startIdx, i + 1));
          } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  // --- Extract caption tracks and fetch transcript ---
  async function fetchTranscript(playerData) {
    if (!playerData || !playerData.captions) {
      console.warn('[SVD] No captions in player data');
      return null;
    }

    var trackList = playerData.captions.playerCaptionsTracklistRenderer;
    if (!trackList || !trackList.captionTracks || trackList.captionTracks.length === 0) {
      console.warn('[SVD] No caption tracks found');
      return null;
    }

    // Prefer manual captions over auto-generated
    var tracks = trackList.captionTracks;
    var selectedTrack = tracks.find(function (t) { return t.kind !== 'asr'; }) || tracks[0];

    var url = selectedTrack.baseUrl;
    if (!url) {
      console.warn('[SVD] Caption track has no baseUrl');
      return null;
    }

    console.log('[SVD] Caption URL:', url.substring(0, 100) + '...');
    console.log('[SVD] Track:', selectedTrack.languageCode, selectedTrack.kind || 'manual');

    // Try json3 format first, then srv1 XML, then default XML
    var segments = await fetchCaptionsJSON3(url);
    if (!segments) {
      segments = await fetchCaptionsXML(url, 'srv1');
    }
    if (!segments) {
      segments = await fetchCaptionsXML(url, null);
    }
    if (!segments || segments.length === 0) {
      console.warn('[SVD] All caption fetch methods failed');
      return null;
    }

    console.log('[SVD] Got', segments.length, 'caption segments');
    return {
      segments: segments,
      language: selectedTrack.languageCode || '',
      isAutoGenerated: selectedTrack.kind === 'asr',
      trackName: selectedTrack.name ? (selectedTrack.name.simpleText || '') : ''
    };
  }

  // --- Fetch captions in json3 format ---
  async function fetchCaptionsJSON3(baseUrl) {
    try {
      var separator = baseUrl.indexOf('?') >= 0 ? '&' : '?';
      var response = await fetch(baseUrl + separator + 'fmt=json3');
      if (!response.ok) {
        console.warn('[SVD] json3 fetch status:', response.status);
        return null;
      }

      var text = await response.text();
      if (!text || text.length < 10) {
        console.warn('[SVD] json3 response empty or too short');
        return null;
      }

      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn('[SVD] json3 parse failed, first 200 chars:', text.substring(0, 200));
        return null;
      }

      if (!data || !data.events) {
        console.warn('[SVD] json3 data has no events');
        return null;
      }

      var segments = [];
      for (var i = 0; i < data.events.length; i++) {
        var event = data.events[i];
        if (!event.segs) continue;

        var captionText = '';
        for (var j = 0; j < event.segs.length; j++) {
          captionText += event.segs[j].utf8 || '';
        }
        captionText = captionText.replace(/\n/g, ' ').trim();
        if (!captionText) continue;

        segments.push({
          startMs: event.tStartMs || 0,
          durationMs: event.dDurationMs || 0,
          text: captionText
        });
      }
      return segments.length > 0 ? segments : null;
    } catch (e) {
      console.warn('[SVD] json3 caption fetch error:', e.message);
      return null;
    }
  }

  // --- Fetch captions in XML format ---
  async function fetchCaptionsXML(baseUrl, fmt) {
    try {
      var url = baseUrl;
      if (fmt) {
        var separator = baseUrl.indexOf('?') >= 0 ? '&' : '?';
        url = baseUrl + separator + 'fmt=' + fmt;
      }

      var response = await fetch(url);
      if (!response.ok) {
        console.warn('[SVD] XML fetch status:', response.status, 'fmt=' + (fmt || 'default'));
        return null;
      }

      var text = await response.text();
      if (!text || text.length < 10) {
        console.warn('[SVD] XML response empty');
        return null;
      }

      var parser = new DOMParser();
      var doc = parser.parseFromString(text, 'text/xml');

      // Try <text> elements (srv1 / legacy format)
      var segments = parseXMLTextNodes(doc);
      if (segments) return segments;

      // Try <p> elements (srv3 format)
      segments = parseXMLPNodes(doc);
      if (segments) return segments;

      console.warn('[SVD] XML has no recognized caption elements, first 300 chars:', text.substring(0, 300));
      return null;
    } catch (e) {
      console.warn('[SVD] XML caption fetch error:', e.message);
      return null;
    }
  }

  // Parse <text start="0" dur="3.5">caption</text> (srv1 format)
  function parseXMLTextNodes(doc) {
    var nodes = doc.querySelectorAll('text');
    if (!nodes || nodes.length === 0) return null;

    var segments = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var startSec = parseFloat(node.getAttribute('start') || '0');
      var durSec = parseFloat(node.getAttribute('dur') || '0');
      var caption = decodeHTMLEntities(node.textContent || '');
      caption = caption.replace(/\n/g, ' ').trim();
      if (!caption) continue;

      segments.push({
        startMs: Math.round(startSec * 1000),
        durationMs: Math.round(durSec * 1000),
        text: caption
      });
    }
    return segments.length > 0 ? segments : null;
  }

  // Parse <p t="0" d="3500"><s>caption</s></p> (srv3 format)
  function parseXMLPNodes(doc) {
    var nodes = doc.querySelectorAll('p');
    if (!nodes || nodes.length === 0) return null;

    var segments = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var tMs = parseInt(node.getAttribute('t') || '0', 10);
      var dMs = parseInt(node.getAttribute('d') || '0', 10);
      var caption = decodeHTMLEntities(node.textContent || '');
      caption = caption.replace(/\n/g, ' ').trim();
      if (!caption) continue;

      segments.push({
        startMs: tMs,
        durationMs: dMs,
        text: caption
      });
    }
    return segments.length > 0 ? segments : null;
  }

  // Decode common HTML entities without innerHTML
  function decodeHTMLEntities(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');
  }

  // --- Extract chapters from video ---
  function extractChapters(playerData) {
    var chapters = [];

    // Try from ytInitialData markers (most reliable)
    if (playerData && playerData.chaptersData) {
      try {
        var markersMap = playerData.chaptersData;
        for (var i = 0; i < markersMap.length; i++) {
          var entry = markersMap[i];
          if (entry.value && entry.value.chapters) {
            var chapterList = entry.value.chapters;
            for (var j = 0; j < chapterList.length; j++) {
              var ch = chapterList[j].chapterRenderer;
              if (ch) {
                chapters.push({
                  title: ch.title ? (ch.title.simpleText || '') : '',
                  startMs: ch.timeRangeStartMillis || 0
                });
              }
            }
            break;
          }
        }
      } catch (e) { /* ignore */ }
    }

    // Fallback: parse description for timestamps
    if (chapters.length === 0) {
      chapters = parseDescriptionChapters();
    }

    return chapters;
  }

  // --- Parse chapters from video description timestamps ---
  function parseDescriptionChapters() {
    var chapters = [];
    var descEl = document.querySelector(
      '#description-inner, ' +
      '#description ytd-text-inline-expander, ' +
      'ytd-text-inline-expander#description-inline-expander'
    );
    if (!descEl) return chapters;

    var descText = descEl.innerText || '';
    var lines = descText.split('\n');
    var timestampRegex = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)/;

    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].trim().match(timestampRegex);
      if (match) {
        var hours = match[1] ? parseInt(match[1], 10) : 0;
        var minutes = parseInt(match[2], 10);
        var seconds = parseInt(match[3], 10);
        var startMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
        chapters.push({
          title: match[4].trim(),
          startMs: startMs
        });
      }
    }

    return chapters;
  }

  // --- Split transcript segments by chapter boundaries ---
  function splitByChapters(segments, chapters, videoDurationMs) {
    if (chapters.length === 0) {
      return createTimeChunks(segments, videoDurationMs);
    }

    var result = [];
    for (var i = 0; i < chapters.length; i++) {
      var startMs = chapters[i].startMs;
      var endMs = (i + 1 < chapters.length) ? chapters[i + 1].startMs : (videoDurationMs || Infinity);

      var chapterText = '';
      for (var j = 0; j < segments.length; j++) {
        var seg = segments[j];
        if (seg.startMs >= startMs && seg.startMs < endMs) {
          chapterText += (chapterText ? ' ' : '') + seg.text;
        }
      }

      result.push({
        title: chapters[i].title,
        startMs: startMs,
        endMs: endMs,
        text: chapterText.trim()
      });
    }

    return result;
  }

  // --- Create time-based chunks when no chapters exist ---
  function createTimeChunks(segments, videoDurationMs) {
    var chunkDuration = config.DEFAULT_CHAPTER_DURATION_MS;
    var totalDuration = videoDurationMs ||
      (segments.length > 0 ? segments[segments.length - 1].startMs + 10000 : 0);
    var numChunks = Math.max(1, Math.ceil(totalDuration / chunkDuration));
    var chunks = [];

    for (var i = 0; i < numChunks; i++) {
      var startMs = i * chunkDuration;
      var endMs = Math.min((i + 1) * chunkDuration, totalDuration);

      var chunkText = '';
      for (var j = 0; j < segments.length; j++) {
        if (segments[j].startMs >= startMs && segments[j].startMs < endMs) {
          chunkText += (chunkText ? ' ' : '') + segments[j].text;
        }
      }

      if (chunkText.trim()) {
        chunks.push({
          title: null,
          startMs: startMs,
          endMs: endMs,
          text: chunkText.trim()
        });
      }
    }

    return chunks;
  }

  // --- Get video metadata ---
  function getVideoMetadata(playerData) {
    var details = playerData && playerData.videoDetails ? playerData.videoDetails : {};
    return {
      title: details.title || document.title.replace(/ - YouTube$/, ''),
      author: details.author || '',
      lengthSeconds: parseInt(details.lengthSeconds, 10) || 0,
      videoId: details.videoId || ''
    };
  }

  // --- Format milliseconds to timestamp string ---
  function formatTimestamp(ms) {
    var totalSeconds = Math.floor(ms / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    if (hours > 0) {
      return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  // --- Main extraction handler ---
  async function handleExtractTranscript(playerData) {
    try {
      console.log('[SVD] handleExtractTranscript: playerData from BG=', !!playerData,
        playerData ? 'captions=' + !!playerData.captions : '');

      // Use player data from background (MAIN world), fallback to HTML parsing
      if (!playerData || !playerData.captions) {
        console.log('[SVD] Trying HTML fallback...');
        var htmlData = await fetchPlayerDataFromHTML();
        if (htmlData) {
          playerData = htmlData;
        }
      }

      // If still no captions, try innertube player API
      if (!playerData || !playerData.captions) {
        var videoId = getVideoIdFromURL();
        if (videoId) {
          console.log('[SVD] Trying innertube API for video:', videoId);
          var apiData = await fetchPlayerDataFromAPI(videoId);
          if (apiData) {
            var existingChapters = playerData ? playerData.chaptersData : null;
            playerData = apiData;
            if (existingChapters) {
              playerData.chaptersData = existingChapters;
            }
          }
        }
      }

      if (!playerData) {
        return { success: false, error: 'noPlayerData' };
      }

      var metadata = getVideoMetadata(playerData);
      var transcript = await fetchTranscript(playerData);
      if (!transcript || transcript.segments.length === 0) {
        return { success: false, error: 'noSubtitles', metadata: metadata };
      }

      var chapters = extractChapters(playerData);
      var videoDurationMs = metadata.lengthSeconds * 1000;
      var chapterSegments = splitByChapters(transcript.segments, chapters, videoDurationMs);

      // Build full transcript text
      var fullText = transcript.segments.map(function (s) { return s.text; }).join(' ');

      return {
        success: true,
        data: {
          metadata: metadata,
          transcript: {
            fullText: fullText,
            language: transcript.language,
            isAutoGenerated: transcript.isAutoGenerated,
            charCount: fullText.length
          },
          chapters: chapterSegments.map(function (ch) {
            return {
              title: ch.title,
              startMs: ch.startMs,
              endMs: ch.endMs,
              text: ch.text,
              startLabel: formatTimestamp(ch.startMs),
              endLabel: formatTimestamp(ch.endMs)
            };
          }),
          hasChapters: chapters.length > 0
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'extractionFailed',
        message: err.message
      };
    }
  }

  // --- Message listener ---
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === config.MESSAGES.EXTRACT_TRANSCRIPT) {
      handleExtractTranscript(message.playerData || null).then(sendResponse);
      return true;
    }
    if (message.type === 'seekVideo') {
      var video = document.querySelector('video');
      if (video) {
        video.currentTime = message.seconds;
      }
      sendResponse({ success: true });
      return true;
    }
  });

  // --- YouTube SPA navigation detection ---
  document.addEventListener('yt-navigate-finish', function () {
    chrome.runtime.sendMessage({
      type: 'ytNavigate',
      url: window.location.href
    }).catch(function () {});
  });
})();
