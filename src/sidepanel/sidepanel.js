/**
 * @file Side panel logic for Smart Video Digest
 */
(function () {
  'use strict';

  var config = globalThis.SVD_CONFIG;

  // --- State ---
  var currentSettings = Object.assign({}, config.DEFAULT_SETTINGS);
  var extractedVideoData = null;
  var isSummarizing = false;
  var currentTabId = null;
  var tabCache = {}; // { tabId: { videoData, tldr, keyPoints, chapterSummaries } }

  // --- DOM References ---
  var el = {
    summarizeBtn: document.getElementById('summarizeBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    langSelect: document.getElementById('langSelect'),
    statusBanner: document.getElementById('statusBanner'),
    videoInfo: document.getElementById('videoInfo'),
    videoTitle: document.getElementById('videoTitle'),
    videoMeta: document.getElementById('videoMeta'),
    copyVideoInfoBtn: document.getElementById('copyVideoInfoBtn'),
    resultsArea: document.getElementById('resultsArea'),
    tldrSection: document.getElementById('tldrSection'),
    tldrContent: document.getElementById('tldrContent'),
    keyPointsSection: document.getElementById('keyPointsSection'),
    keyPointsContent: document.getElementById('keyPointsContent'),
    chaptersSection: document.getElementById('chaptersSection'),
    chaptersContent: document.getElementById('chaptersContent'),
    customPromptInput: document.getElementById('customPromptInput'),
    customPromptBtn: document.getElementById('customPromptBtn'),
    customPromptDetails: document.getElementById('customPromptDetails'),
    chatHistory: document.getElementById('chatHistory'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toast: document.getElementById('toast'),
    shortcutHint: document.getElementById('shortcutHint'),
    quizSection: document.getElementById('quizSection'),
    generateQuizBtn: document.getElementById('generateQuizBtn'),
    quizContent: document.getElementById('quizContent'),
    speechSpeedBtn: document.getElementById('speechSpeedBtn'),
    voiceSelect: document.getElementById('voiceSelect'),
    downloadMdBtn: document.getElementById('downloadMdBtn')
  };

  var SPEECH_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  var speechSpeedIndex = 2; // default 1x
  var savedVoiceURI = '';

  // --- Initialization ---
  async function init() {
    await loadSettings();
    applyI18n();
    await checkApiAvailability();
    bindEvents();
    showShortcutHint();

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      currentTabId = tabs[0].id;
      var accessible = await updateTabAccessibility(tabs[0].id);
      if (!accessible) return;
    }

    // Auto-summarize on panel first open
    if (!el.summarizeBtn.disabled) {
      handleSummarize();
    }
  }

  function showShortcutHint() {
    chrome.commands.getAll(function (commands) {
      var cmd = commands.find(function (c) { return c.name === '_execute_action'; });
      if (cmd && cmd.shortcut) {
        var label = chrome.i18n.getMessage('shortcutHint') || 'Shortcut:';
        clearElement(el.shortcutHint);
        el.shortcutHint.appendChild(document.createTextNode(label + ' '));
        var kbd = document.createElement('kbd');
        kbd.textContent = cmd.shortcut;
        el.shortcutHint.appendChild(kbd);
      }
    });
  }

  // --- Settings ---
  async function loadSettings() {
    try {
      var data = await chrome.storage.sync.get(config.STORAGE_KEY);
      if (data[config.STORAGE_KEY]) {
        currentSettings = Object.assign({}, config.DEFAULT_SETTINGS, data[config.STORAGE_KEY]);
      }
    } catch (err) {
      console.warn('Failed to load settings:', err);
    }
    el.langSelect.value = currentSettings.outputLanguage;

    if (currentSettings.speechSpeed) {
      var idx = SPEECH_SPEEDS.indexOf(currentSettings.speechSpeed);
      if (idx >= 0) speechSpeedIndex = idx;
    }
    updateSpeedButton();

    if (currentSettings.voiceURI) {
      savedVoiceURI = currentSettings.voiceURI;
    }
    populateVoiceList();
  }

  function updateSpeedButton() {
    var speed = SPEECH_SPEEDS[speechSpeedIndex];
    el.speechSpeedBtn.textContent = speed === 1 ? '1x' : speed + 'x';
  }

  function cycleSpeechSpeed() {
    speechSpeedIndex = (speechSpeedIndex + 1) % SPEECH_SPEEDS.length;
    updateSpeedButton();
    saveSetting('speechSpeed', SPEECH_SPEEDS[speechSpeedIndex]);
  }

  function populateVoiceList() {
    var voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;

    var lang = getOutputLanguage(extractedVideoData ? extractedVideoData.transcript.language : null);
    var langMap = { ja: 'ja', en: 'en', es: 'es' };
    var filterLang = langMap[lang] || 'en';

    var matchingVoices = voices.filter(function (v) {
      return v.lang.startsWith(filterLang);
    });

    clearElement(el.voiceSelect);

    var defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = chrome.i18n.getMessage('voiceDefault') || 'Default';
    el.voiceSelect.appendChild(defaultOpt);

    for (var i = 0; i < matchingVoices.length; i++) {
      var v = matchingVoices[i];
      var opt = document.createElement('option');
      opt.value = v.voiceURI;
      var name = v.name.replace(/\s*\(.*\)$/, '');
      opt.textContent = name;
      if (v.voiceURI === savedVoiceURI) {
        opt.selected = true;
      }
      el.voiceSelect.appendChild(opt);
    }
  }

  async function saveSetting(key, value) {
    currentSettings[key] = value;
    var storageData = {};
    storageData[config.STORAGE_KEY] = currentSettings;
    try {
      await chrome.storage.sync.set(storageData);
    } catch (err) {
      console.warn('Failed to save setting:', err);
    }
  }

  // --- i18n ---
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (elem) {
      var key = elem.getAttribute('data-i18n');
      var msg = chrome.i18n.getMessage(key);
      if (msg) elem.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (elem) {
      var key = elem.getAttribute('data-i18n-placeholder');
      var msg = chrome.i18n.getMessage(key);
      if (msg) elem.placeholder = msg;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (elem) {
      var key = elem.getAttribute('data-i18n-title');
      var msg = chrome.i18n.getMessage(key);
      if (msg) elem.title = msg;
    });
  }

  // --- API Availability ---
  async function checkApiAvailability() {
    if (!('Summarizer' in self)) {
      showStatus('error', chrome.i18n.getMessage('summarizerNotSupported') ||
        'Summarizer API is not supported. Please use Chrome 138 or later.');
      el.summarizeBtn.disabled = true;
      return;
    }

    try {
      var availability = await Summarizer.availability({
        outputLanguage: currentSettings.outputLanguage === 'auto' ? 'en' : currentSettings.outputLanguage
      });
      if (availability === 'unavailable') {
        showStatus('error', chrome.i18n.getMessage('summarizerUnavailable') ||
          'AI model is not available. Please check chrome://flags.');
        el.summarizeBtn.disabled = true;
        return;
      }
      if (availability === 'downloadable') {
        showStatus('info', chrome.i18n.getMessage('modelDownloading') ||
          'AI model will be downloaded on first use.');
      }
    } catch (err) {
      showStatus('warning', 'Could not check API availability: ' + err.message);
    }

    if (!('LanguageModel' in self)) {
      el.customPromptInput.disabled = true;
      el.customPromptBtn.disabled = true;
      el.generateQuizBtn.disabled = true;
    }
  }

  // --- Transcript Extraction ---
  function extractTranscript() {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { type: config.MESSAGES.EXTRACT_TRANSCRIPT, tabId: currentTabId },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.success) {
            var errMsg = response ? (response.error + (response.message ? ': ' + response.message : '')) : 'extractionFailed';
            reject(new Error(errMsg));
            return;
          }
          resolve(response.data);
        }
      );
    });
  }

  // Ensure video data is extracted (lazy extraction for quiz/custom prompt)
  async function ensureVideoData() {
    if (extractedVideoData) return extractedVideoData;
    try {
      extractedVideoData = await extractTranscript();
      if (extractedVideoData && extractedVideoData.transcript) {
        showVideoInfo(extractedVideoData);
        return extractedVideoData;
      }
      extractedVideoData = null;
    } catch (e) {
      console.warn('[SVD] ensureVideoData extraction failed:', e.message);
      extractedVideoData = null;
    }
    return null;
  }

  // --- Determine output language ---
  function getOutputLanguage(transcriptLang) {
    var selected = el.langSelect.value;
    if (selected !== 'auto') return selected;
    if (transcriptLang) {
      var base = transcriptLang.split('-')[0].toLowerCase();
      if (base === 'ja' || base === 'en' || base === 'es') return base;
    }
    return 'en';
  }

  // --- Summarize Button State ---
  function markSummarized() {
    el.summarizeBtn.disabled = true;
    var span = el.summarizeBtn.querySelector('span[data-i18n]');
    if (span) {
      span.textContent = chrome.i18n.getMessage('summarizedButton') || 'Summarized';
    }
    el.downloadMdBtn.disabled = false;
  }

  function resetSummarizeBtn() {
    el.summarizeBtn.disabled = false;
    var span = el.summarizeBtn.querySelector('span[data-i18n]');
    if (span) {
      span.textContent = chrome.i18n.getMessage('summarizeButton') || 'Summarize this video';
    }
  }

  // --- URL Accessibility ---
  function isYouTubeWatch(url) {
    if (!url) return false;
    return url.startsWith('https://www.youtube.com/watch');
  }

  async function updateTabAccessibility(tabId) {
    try {
      var tab = await chrome.tabs.get(tabId);
      if (!isYouTubeWatch(tab.url)) {
        el.summarizeBtn.disabled = true;
        showStatus('info', chrome.i18n.getMessage('notYouTube') ||
          'Open a YouTube video to summarize it.');
        return false;
      }
    } catch (err) {
      el.summarizeBtn.disabled = true;
      return false;
    }
    resetSummarizeBtn();
    hideStatus();
    return true;
  }

  // --- Tab Cache ---
  function saveToCache(tabId, videoData, tldrText, keyPointsText, chapterSummaries) {
    tabCache[tabId] = {
      videoData: videoData,
      tldr: tldrText || null,
      keyPoints: keyPointsText || null,
      chapterSummaries: chapterSummaries || null
    };
  }

  function restoreFromCache(tabId) {
    var cached = tabCache[tabId];
    if (!cached) return false;

    extractedVideoData = cached.videoData;
    showVideoInfo(cached.videoData);
    el.resultsArea.classList.remove('svd-hidden');
    el.tldrSection.classList.remove('svd-hidden');
    el.keyPointsSection.classList.remove('svd-hidden');

    if (cached.tldr) {
      renderMarkdownSafe(cached.tldr, el.tldrContent);
    }
    if (cached.keyPoints) {
      renderKeyPointsWithImportance(cached.keyPoints, el.keyPointsContent);
    }
    if (cached.chapterSummaries && cached.videoData.chapters) {
      el.chaptersSection.classList.remove('svd-hidden');
      renderChapters(cached.videoData.chapters, cached.chapterSummaries);
    }

    if (cached.quizHtml) {
      el.quizContent.innerHTML = cached.quizHtml;
      rebindQuizCards();
    } else {
      clearElement(el.quizContent);
    }

    if (cached.chatHtml) {
      el.chatHistory.innerHTML = cached.chatHtml;
    } else {
      clearElement(el.chatHistory);
    }

    markSummarized();
    return true;
  }

  function showFreshState() {
    extractedVideoData = null;
    stopReadAloud();
    clearResults();
    el.videoInfo.classList.add('svd-hidden');
    clearElement(el.chatHistory);
    clearElement(el.quizContent);
  }

  function saveCurrentTabQuizChat(tabId) {
    if (!tabId) return;
    var hasQuiz = el.quizContent.childNodes.length > 0;
    var hasChat = el.chatHistory.childNodes.length > 0;
    if (!hasQuiz && !hasChat) return;

    if (!tabCache[tabId]) {
      tabCache[tabId] = {
        videoData: extractedVideoData,
        tldr: el.tldrContent.getAttribute('data-raw-text') || null,
        keyPoints: el.keyPointsContent.getAttribute('data-raw-text') || null,
        chapterSummaries: null
      };
    }
    tabCache[tabId].quizHtml = hasQuiz ? el.quizContent.innerHTML : null;
    tabCache[tabId].chatHtml = hasChat ? el.chatHistory.innerHTML : null;
  }

  function rebindQuizCards() {
    var cards = el.quizContent.querySelectorAll('.svd-quiz-card');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var qDiv = card.querySelector('.svd-quiz-question');
        var aDiv = card.querySelector('.svd-quiz-answer');
        if (qDiv && aDiv) {
          qDiv.addEventListener('click', function () {
            aDiv.classList.toggle('svd-revealed');
          });
        }
      })(cards[i]);
    }
  }

  async function switchToTab(tabId) {
    if (tabId === currentTabId) return;
    saveCurrentTabQuizChat(currentTabId);
    currentTabId = tabId;

    // Always update UI when switching tabs, even during summarization.
    // The in-progress summarize will check currentTabId and skip rendering
    // if the tab has changed.
    var accessible = await updateTabAccessibility(tabId);
    if (!accessible) {
      showFreshState();
      return;
    }

    if (isSummarizing) {
      // Show fresh state for the new tab; the in-flight summarization
      // for the old tab will save to cache when it completes.
      showFreshState();
      resetSummarizeBtn();
      return;
    }

    if (!restoreFromCache(tabId)) {
      showFreshState();
      if (currentSettings.autoSummarize && !el.summarizeBtn.disabled) {
        handleSummarize();
      }
    }
  }

  // --- Hierarchical Summarization Pipeline ---
  async function handleSummarize() {
    if (isSummarizing) return;
    isSummarizing = true;
    stopReadAloud();
    showLoading(true, chrome.i18n.getMessage('extractingTranscript') || 'Extracting transcript...');
    clearResults();

    var tabId = currentTabId;

    try {
      extractedVideoData = await extractTranscript();
      if (!extractedVideoData || !extractedVideoData.transcript) {
        throw new Error('noSubtitles');
      }
      showVideoInfo(extractedVideoData);

      var outputLang = getOutputLanguage(extractedVideoData.transcript.language);
      var chapters = extractedVideoData.chapters;
      var sharedContext = 'Video: ' + extractedVideoData.metadata.title;

      // Phase 1: Summarize each chapter
      showLoading(true, chrome.i18n.getMessage('summarizingChapters') || 'Summarizing chapters...');
      var chapterSummaries = [];

      for (var i = 0; i < chapters.length; i++) {
        var chapter = chapters[i];
        if (!chapter.text || chapter.text.length < config.TEXT_LIMITS.MIN_CHARS) {
          chapterSummaries.push('');
          continue;
        }

        var label = chapter.title || (chapter.startLabel + ' \u2013 ' + chapter.endLabel);
        showLoading(true,
          (chrome.i18n.getMessage('summarizingChapter') || 'Summarizing') +
          ' (' + (i + 1) + '/' + chapters.length + '): ' + label);

        var summary = await summarizeChapterText(chapter.text, sharedContext, outputLang);
        chapterSummaries.push(summary || '');
      }

      // If tab changed during chapter summarization, save to cache and abort rendering
      if (currentTabId !== tabId) {
        saveToCache(tabId, extractedVideoData, null, null, chapterSummaries);
        return;
      }

      // Render chapters with summaries
      if (chapters.length > 0) {
        el.chaptersSection.classList.remove('svd-hidden');
        renderChapters(chapters, chapterSummaries);
      }

      // Phase 2: Combine chapter summaries for overall summary
      var combinedText = '';
      for (var j = 0; j < chapterSummaries.length; j++) {
        if (chapterSummaries[j]) {
          var chLabel = chapters[j].title || ('Part ' + (j + 1));
          combinedText += chLabel + ': ' + chapterSummaries[j] + '\n';
        }
      }
      // Fallback: if no chapter summaries, use raw transcript
      if (!combinedText.trim()) {
        combinedText = extractedVideoData.transcript.fullText;
      }

      // Phase 3: Generate TL;DR and Key Points from combined summaries
      if (currentTabId !== tabId) {
        saveToCache(tabId, extractedVideoData, null, null, chapterSummaries);
        return;
      }
      showLoading(false);
      el.resultsArea.classList.remove('svd-hidden');
      el.tldrSection.classList.remove('svd-hidden');
      el.keyPointsSection.classList.remove('svd-hidden');
      el.summarizeBtn.disabled = true;

      var results = { tldr: null, keyPoints: null };

      // TL;DR via Summarizer API
      showSectionLoading(el.tldrContent);
      results.tldr = await runSummarizer({
        type: 'tldr',
        format: 'markdown',
        length: currentSettings.summaryLength,
        expectedInputLanguages: ['en', 'ja', 'es'],
        outputLanguage: outputLang,
        sharedContext: sharedContext,
        monitor: function (m) {
          m.addEventListener('downloadprogress', function (e) {
            var pct = Math.round((e.loaded / e.total) * 100);
            el.loadingText.textContent = 'Downloading model: ' + pct + '%';
          });
        }
      }, combinedText, el.tldrContent);

      // Key Points via Prompt API (with importance tags)
      showSectionLoading(el.keyPointsContent);
      if ('LanguageModel' in self) {
        var kpText = combinedText.length > config.TEXT_LIMITS.PROMPT_API_MAX_CHARS
          ? combinedText.substring(0, config.TEXT_LIMITS.PROMPT_API_MAX_CHARS) + config.TEXT_LIMITS.TRUNCATION_SUFFIX
          : combinedText;
        var kpLangEN = outputLang !== 'auto'
          ? (config.LANGUAGE_NAMES_FOR_PROMPT[outputLang] || 'English')
          : 'the same language as the content';
        var kpPrompt = 'Summarize the following video content as key points (3-7 bullet points).' +
          '\nEach bullet MUST start with an importance tag: [HIGH], [MEDIUM], or [LOW].' +
          '\nFormat: - [HIGH] Most important point here' +
          '\nWrite your response in ' + kpLangEN + '.\n\n' +
          sharedContext +
          '\n\nContent:\n' + kpText;
        try {
          results.keyPoints = await runPromptApi(
            'You are a summarization assistant. Always write in ' + kpLangEN + '.', kpPrompt, el.keyPointsContent, outputLang
          );
          results.keyPoints = repairImportanceTags(results.keyPoints);
          renderKeyPointsWithImportance(results.keyPoints, el.keyPointsContent);
        } catch (err) {
          console.warn('Prompt API key points failed, falling back to Summarizer:', err);
          results.keyPoints = await runSummarizer({
            type: 'key-points',
            format: 'markdown',
            length: currentSettings.summaryLength,
            expectedInputLanguages: ['en', 'ja', 'es'],
            outputLanguage: outputLang,
            sharedContext: sharedContext
          }, combinedText, el.keyPointsContent);
        }
      } else {
        results.keyPoints = await runSummarizer({
          type: 'key-points',
          format: 'markdown',
          length: currentSettings.summaryLength,
          expectedInputLanguages: ['en', 'ja', 'es'],
          outputLanguage: outputLang,
          sharedContext: sharedContext
        }, combinedText, el.keyPointsContent);
      }

      // Cache results
      if (tabId) {
        saveToCache(tabId, extractedVideoData, results.tldr, results.keyPoints, chapterSummaries);
      }

      // Only mark as summarized if still on the same tab
      if (currentTabId === tabId) {
        markSummarized();
      }

    } catch (err) {
      showStatus('error', getErrorMessage(err));
    } finally {
      showLoading(false);
      isSummarizing = false;
    }
  }

  // Summarize a single chapter's text using Summarizer API
  async function summarizeChapterText(text, sharedContext, outputLang) {
    var createOptions = {
      type: 'tldr',
      format: 'plain-text',
      length: 'short',
      expectedInputLanguages: ['en', 'ja', 'es'],
      outputLanguage: outputLang,
      sharedContext: sharedContext
    };

    var attempts = [text];
    if (text.length > config.TEXT_LIMITS.CHUNK_SIZE) {
      attempts.push(text.substring(0, config.TEXT_LIMITS.CHUNK_SIZE) + config.TEXT_LIMITS.TRUNCATION_SUFFIX);
    }

    for (var i = 0; i < attempts.length; i++) {
      var summarizer = await Summarizer.create(createOptions);
      try {
        var summary = await summarizer.summarize(attempts[i]);
        return summary || '';
      } catch (err) {
        if (/too large/i.test(err.message || '') && i < attempts.length - 1) {
          continue;
        }
        console.warn('[SVD] Chapter summarization failed:', err.message);
        return '';
      } finally {
        summarizer.destroy();
      }
    }
    return '';
  }

  // --- Summarizer API ---
  async function runSummarizer(options, text, targetElement) {
    var attempts = [text];
    if (text.length > 6000) {
      attempts.push(text.substring(0, Math.floor(text.length / 2)) + config.TEXT_LIMITS.TRUNCATION_SUFFIX);
    }
    if (text.length > 3000) {
      attempts.push(text.substring(0, Math.floor(text.length / 4)) + config.TEXT_LIMITS.TRUNCATION_SUFFIX);
    }

    for (var i = 0; i < attempts.length; i++) {
      var summarizer = await Summarizer.create(options);
      try {
        var summary = await summarizer.summarize(attempts[i]);
        if (summary) {
          renderMarkdownSafe(summary, targetElement);
          return summary;
        } else {
          targetElement.textContent = '(No summary generated)';
          return null;
        }
      } catch (err) {
        if (/too large/i.test(err.message || '') && i < attempts.length - 1) {
          continue;
        }
        targetElement.textContent = 'Error: ' + err.message;
        return null;
      } finally {
        summarizer.destroy();
      }
    }
    targetElement.textContent = '(No summary generated)';
    return null;
  }

  // --- Prompt API ---
  async function runPromptApi(systemPrompt, prompt, targetElement, outputLanguage) {
    var lang = outputLanguage || 'en';
    var session = await LanguageModel.create({
      systemPrompt: systemPrompt,
      expectedInputs: [{ type: 'text' }],
      expectedOutputs: [{ type: 'text', languages: [lang] }],
      outputLanguage: lang
    });
    var fullText = '';
    try {
      var stream = session.promptStreaming(prompt);
      var isCumulative = null;
      for await (var chunk of stream) {
        if (isCumulative === null && fullText.length > 0) {
          isCumulative = chunk.startsWith(fullText);
        }
        if (isCumulative) {
          fullText = chunk;
        } else {
          fullText += chunk;
        }
        renderMarkdownSafe(fullText, targetElement);
      }
    } finally {
      session.destroy();
    }
    return fullText;
  }

  // --- Chapter Rendering ---
  function renderChapters(chapters, summaries) {
    clearElement(el.chaptersContent);

    for (var i = 0; i < chapters.length; i++) {
      var chapter = chapters[i];
      var summary = summaries[i] || '';

      var item = document.createElement('div');
      item.className = 'svd-chapter-item';

      var header = document.createElement('div');
      header.className = 'svd-chapter-header';

      var timestamp = document.createElement('span');
      timestamp.className = 'svd-chapter-timestamp';
      timestamp.textContent = chapter.startLabel;

      // Make timestamp clickable to seek video
      if (chapter.startMs !== undefined) {
        timestamp.setAttribute('data-start-ms', String(chapter.startMs));
        timestamp.addEventListener('click', function (e) {
          e.stopPropagation();
          var ms = parseInt(this.getAttribute('data-start-ms'), 10);
          seekVideo(ms);
        });
      }

      var title = document.createElement('span');
      title.className = 'svd-chapter-title';
      title.textContent = chapter.title ||
        (chrome.i18n.getMessage('partLabel') || 'Part') + ' ' + (i + 1);

      header.appendChild(timestamp);
      header.appendChild(title);

      if (summary) {
        var toggle = document.createElement('span');
        toggle.className = 'svd-chapter-toggle';
        toggle.textContent = '\u25B6';
        header.appendChild(toggle);
      }

      item.appendChild(header);

      if (summary) {
        var summaryDiv = document.createElement('div');
        summaryDiv.className = 'svd-chapter-summary';
        summaryDiv.textContent = summary;
        item.appendChild(summaryDiv);

        // Toggle accordion
        (function (h, s) {
          h.addEventListener('click', function () {
            var isOpen = s.classList.contains('svd-chapter-expanded');
            s.classList.toggle('svd-chapter-expanded');
            var toggleEl = h.querySelector('.svd-chapter-toggle');
            if (toggleEl) {
              toggleEl.textContent = isOpen ? '\u25B6' : '\u25BC';
            }
          });
        })(header, summaryDiv);
      }

      el.chaptersContent.appendChild(item);
    }
  }

  function seekVideo(startMs) {
    var seconds = Math.floor(startMs / 1000);
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'seekVideo',
          seconds: seconds
        }).catch(function () {
          // Fallback: update URL with timestamp
          var url = tabs[0].url;
          if (url) {
            var base = url.split('&t=')[0].split('#')[0];
            chrome.tabs.update(tabs[0].id, { url: base + '&t=' + seconds + 's' });
          }
        });
      }
    });
  }

  // --- Key Points with Importance ---
  function repairImportanceTags(text) {
    return text
      .replace(/\[(?:\u9ad8|\u9ad8\u3044|\u30cf\u30a4|\u91cd\u8981|\u91cd\u8981\u5ea6\u9ad8|High)\]/gi, '[HIGH]')
      .replace(/\[(?:\u4e2d|\u4e2d\u7a0b\u5ea6|\u30df\u30c7\u30a3\u30a2\u30e0|\u6a19\u6e96|\u91cd\u8981\u5ea6\u4e2d|Medium)\]/gi, '[MEDIUM]')
      .replace(/\[(?:\u4f4e|\u4f4e\u3044|\u30ed\u30fc|\u91cd\u8981\u5ea6\u4f4e|Low)\]/gi, '[LOW]')
      .replace(/\[(?:ALTO|ALTA)\]/gi, '[HIGH]')
      .replace(/\[(?:MEDIO|MEDIA)\]/gi, '[MEDIUM]')
      .replace(/\[(?:BAJO|BAJA)\]/gi, '[LOW]');
  }

  function renderKeyPointsWithImportance(text, container) {
    container.setAttribute('data-raw-text', text);
    clearElement(container);
    var normalized = text.replace(/\s+-\s+\*{0,2}\[(HIGH|MEDIUM|LOW)\]\*{0,2}/gi, '\n- [$1]');
    var lines = normalized.split('\n');
    var ul = document.createElement('ul');

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed) continue;

      var listMatch = trimmed.match(/^[-*]\s+(.+)/);
      var content;
      if (listMatch) {
        content = listMatch[1];
      } else if (/^\*{0,2}\s*\[(HIGH|MEDIUM|LOW)\]/i.test(trimmed)) {
        content = trimmed;
      } else {
        continue;
      }

      var importance = null;
      var importanceMatch = content.match(/^(\*{0,2})\s*\[(HIGH|MEDIUM|LOW)\]\s*(\*{0,2})\s*/i);
      if (importanceMatch) {
        importance = importanceMatch[2].toLowerCase();
        content = content.substring(importanceMatch[0].length);
        if (importanceMatch[1] === '**' && importanceMatch[3] === '') {
          var closeIdx = content.indexOf('**');
          if (closeIdx >= 0) {
            content = '**' + content.substring(0, closeIdx) + '**' + content.substring(closeIdx + 2);
          }
        }
      }

      var li = document.createElement('li');
      if (importance) {
        li.setAttribute('data-importance', importance);
        var badge = document.createElement('span');
        badge.className = 'svd-importance-badge svd-' + importance;
        var labels = { high: 'HIGH', medium: 'MED', low: 'LOW' };
        badge.textContent = labels[importance] || importance.toUpperCase();
        li.appendChild(badge);
      }
      appendInlineFormatted(li, content);
      ul.appendChild(li);
    }

    if (ul.childNodes.length > 0) {
      container.appendChild(ul);
    } else {
      renderMarkdownSafe(text, container);
    }
  }

  // --- Quiz Generation ---
  async function handleGenerateQuiz() {
    if (!('LanguageModel' in self)) return;

    el.generateQuizBtn.disabled = true;
    clearElement(el.quizContent);
    showSectionLoading(el.quizContent);

    var videoData = await ensureVideoData();
    if (!videoData) {
      clearElement(el.quizContent);
      el.quizContent.textContent = chrome.i18n.getMessage('noSubtitles') || 'No subtitles available.';
      el.generateQuizBtn.disabled = false;
      return;
    }

    var transcriptLang = videoData.transcript.language || null;
    var resolvedLang = getOutputLanguage(transcriptLang);
    var quizLangEN = (el.langSelect.value !== 'auto') ?
      (config.LANGUAGE_NAMES_FOR_PROMPT[resolvedLang] || 'English') : 'the same language as the text';

    try {
      var session = await LanguageModel.create({
        systemPrompt: 'You are a quiz generator that always writes in ' + quizLangEN + '.',
        expectedInputs: [{ type: 'text' }],
        expectedOutputs: [{ type: 'text', languages: [resolvedLang] }],
        outputLanguage: resolvedLang
      });
      try {
        var textForQuiz = videoData.transcript.fullText.substring(0, 5000);
        var prompt = 'Generate exactly 3 comprehension questions with short answers in ' + quizLangEN + '.\n' +
          'Format each Q&A pair on its own line like this:\n' +
          'Q1: [question]\nA1: [answer]\n' +
          'Q2: [question]\nA2: [answer]\n' +
          'Q3: [question]\nA3: [answer]\n\n' +
          'Video title: ' + videoData.metadata.title + '\n\n' +
          'Transcript:\n' + textForQuiz;

        var result = await session.prompt(prompt);
        if (result) {
          renderQuiz(result);
        }
      } finally {
        session.destroy();
      }
    } catch (err) {
      clearElement(el.quizContent);
      el.quizContent.textContent = 'Quiz generation failed: ' + err.message;
    } finally {
      el.generateQuizBtn.disabled = false;
    }
  }

  function renderQuiz(quizText) {
    clearElement(el.quizContent);
    var lines = quizText.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var questions = [];
    var currentQ = null;

    for (var i = 0; i < lines.length; i++) {
      var qMatch = lines[i].match(/^Q\d+[:\uff1a]\s*(.+)/i);
      var aMatch = lines[i].match(/^A\d+[:\uff1a]\s*(.+)/i);

      if (qMatch) {
        currentQ = { question: qMatch[1], answer: null };
        questions.push(currentQ);
      } else if (aMatch && currentQ) {
        currentQ.answer = aMatch[1];
        currentQ = null;
      }
    }

    if (questions.length === 0) {
      el.quizContent.textContent = 'Could not parse quiz format.';
      return;
    }

    var answerLabel = chrome.i18n.getMessage('quizAnswerLabel') || 'Answer';
    var tapHint = chrome.i18n.getMessage('quizTapToReveal') || 'Tap to reveal answer';

    for (var j = 0; j < questions.length; j++) {
      var card = document.createElement('div');
      card.className = 'svd-quiz-card';

      var questionDiv = document.createElement('div');
      questionDiv.className = 'svd-quiz-question';
      questionDiv.title = tapHint;

      var numberSpan = document.createElement('span');
      numberSpan.className = 'svd-quiz-number';
      numberSpan.textContent = String(j + 1);
      questionDiv.appendChild(numberSpan);

      var qText = document.createElement('span');
      qText.textContent = questions[j].question;
      questionDiv.appendChild(qText);

      var answerDiv = document.createElement('div');
      answerDiv.className = 'svd-quiz-answer';

      var aLabel = document.createElement('div');
      aLabel.className = 'svd-quiz-answer-label';
      aLabel.textContent = answerLabel;
      answerDiv.appendChild(aLabel);

      var aText = document.createElement('div');
      aText.textContent = questions[j].answer || '\u2014';
      answerDiv.appendChild(aText);

      (function (qDiv, aDiv) {
        qDiv.addEventListener('click', function () {
          aDiv.classList.toggle('svd-revealed');
        });
      })(questionDiv, answerDiv);

      card.appendChild(questionDiv);
      card.appendChild(answerDiv);
      el.quizContent.appendChild(card);
    }
  }

  // --- Custom Prompt (Chat UI) ---
  async function handleCustomPrompt() {
    var promptText = el.customPromptInput.value.trim();
    if (!promptText) return;

    var userBubble = document.createElement('div');
    userBubble.className = 'svd-chat-bubble svd-user';
    userBubble.textContent = promptText;
    el.chatHistory.appendChild(userBubble);

    el.customPromptInput.value = '';
    el.customPromptBtn.disabled = true;

    var assistantBubble = document.createElement('div');
    assistantBubble.className = 'svd-chat-bubble svd-assistant';
    var responseContent = document.createElement('div');
    responseContent.className = 'svd-content';
    assistantBubble.appendChild(responseContent);
    el.chatHistory.appendChild(assistantBubble);
    showSectionLoading(responseContent);

    el.chatHistory.scrollTop = el.chatHistory.scrollHeight;

    try {
      if (!('LanguageModel' in self)) {
        responseContent.textContent = 'LanguageModel API is not available.';
        return;
      }

      var videoData = await ensureVideoData();
      if (!videoData) {
        responseContent.textContent = chrome.i18n.getMessage('noSubtitles') || 'No subtitles available.';
        return;
      }

      var transcriptLang = videoData.transcript.language || null;
      var outputLang = getOutputLanguage(transcriptLang);
      var systemPrompt = 'You are a helpful assistant. Answer based on the provided YouTube video transcript.';

      var contextParts = [];
      contextParts.push('Video: ' + videoData.metadata.title);

      var tldrText = el.tldrContent.getAttribute('data-raw-text');
      var kpText = el.keyPointsContent.getAttribute('data-raw-text');
      if (tldrText) contextParts.push('Summary: ' + tldrText);
      if (kpText) contextParts.push('Key points: ' + kpText);

      var transcript = videoData.transcript.fullText;
      var maxChars = config.TEXT_LIMITS.PROMPT_API_MAX_CHARS;
      if (transcript.length > maxChars) {
        transcript = transcript.substring(0, maxChars) + config.TEXT_LIMITS.TRUNCATION_SUFFIX;
      }
      contextParts.push('Transcript:\n' + transcript);

      var fullPrompt = contextParts.join('\n\n') + '\n\nQuestion: ' + promptText;

      await runPromptApi(systemPrompt, fullPrompt, responseContent, outputLang);
    } catch (err) {
      responseContent.textContent = getErrorMessage(err);
    } finally {
      el.customPromptBtn.disabled = false;
      el.chatHistory.scrollTop = el.chatHistory.scrollHeight;
    }
  }

  // --- Safe Markdown Rendering ---
  function renderMarkdownSafe(text, container) {
    container.setAttribute('data-raw-text', text);
    clearElement(container);
    var lines = text.split('\n');
    var currentList = null;

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed) {
        if (currentList) {
          container.appendChild(currentList);
          currentList = null;
        }
        continue;
      }

      var listMatch = trimmed.match(/^[-*]\s+(.+)/);
      if (listMatch) {
        if (!currentList) {
          currentList = document.createElement('ul');
        }
        var li = document.createElement('li');
        appendInlineFormatted(li, listMatch[1]);
        currentList.appendChild(li);
        continue;
      }

      if (currentList) {
        container.appendChild(currentList);
        currentList = null;
      }

      var p = document.createElement('p');
      appendInlineFormatted(p, trimmed);
      container.appendChild(p);
    }

    if (currentList) {
      container.appendChild(currentList);
    }
  }

  function appendInlineFormatted(parent, text) {
    var regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    var lastIndex = 0;
    var match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parent.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
      }
      if (match[2]) {
        var strong = document.createElement('strong');
        strong.textContent = match[2];
        parent.appendChild(strong);
      } else if (match[3]) {
        var em = document.createElement('em');
        em.textContent = match[3];
        parent.appendChild(em);
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parent.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
  }

  // --- Video Info Display ---
  function showVideoInfo(data) {
    if (!data || !data.metadata) return;
    var meta = data.metadata;
    el.videoTitle.textContent = meta.title || '';

    var infoParts = [];
    if (meta.author) infoParts.push(meta.author);
    if (meta.lengthSeconds) infoParts.push(formatDuration(meta.lengthSeconds));
    if (data.transcript) {
      infoParts.push(data.transcript.charCount.toLocaleString() + ' chars');
      if (data.transcript.isAutoGenerated) {
        infoParts.push(chrome.i18n.getMessage('autoGeneratedSubs') || 'Auto-generated subtitles');
      }
    }
    el.videoMeta.textContent = infoParts.join(' \u00b7 ');
    el.videoInfo.classList.remove('svd-hidden');
  }

  function formatDuration(seconds) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  // --- UI Helpers ---
  function clearElement(elem) {
    while (elem.firstChild) {
      elem.removeChild(elem.firstChild);
    }
  }

  function showStatus(type, message) {
    el.statusBanner.className = 'svd-status-banner svd-' + type;
    el.statusBanner.textContent = message;
    el.statusBanner.classList.remove('svd-hidden');
  }

  function hideStatus() {
    el.statusBanner.classList.add('svd-hidden');
  }

  function showSectionLoading(container) {
    clearElement(container);
    var wrapper = document.createElement('div');
    wrapper.className = 'svd-section-loading';
    var spinner = document.createElement('div');
    spinner.className = 'svd-section-spinner';
    var label = document.createElement('span');
    label.textContent = chrome.i18n.getMessage('summarizing') || 'Generating...';
    wrapper.appendChild(spinner);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  }

  function showLoading(show, text) {
    if (show) {
      el.loadingOverlay.classList.remove('svd-hidden');
      if (text) el.loadingText.textContent = text;
    } else {
      el.loadingOverlay.classList.add('svd-hidden');
    }
  }

  function clearResults() {
    clearElement(el.tldrContent);
    clearElement(el.keyPointsContent);
    clearElement(el.chaptersContent);
    el.resultsArea.classList.add('svd-hidden');
    el.chaptersSection.classList.add('svd-hidden');
    el.downloadMdBtn.disabled = true;
    hideStatus();
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.remove('svd-hidden');
    setTimeout(function () {
      el.toast.classList.add('svd-hidden');
    }, 2000);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(function () {
      showToast(chrome.i18n.getMessage('copied') || 'Copied!');
    }).catch(function () {
      showToast('Failed to copy');
    });
  }

  // --- Read Aloud ---
  var currentReadAloudBtn = null;

  function stopReadAloud() {
    speechSynthesis.cancel();
    if (currentReadAloudBtn) {
      currentReadAloudBtn.classList.remove('svd-speaking');
      currentReadAloudBtn.querySelector('.svd-icon-play').classList.remove('svd-hidden');
      currentReadAloudBtn.querySelector('.svd-icon-stop').classList.add('svd-hidden');
      currentReadAloudBtn.title = chrome.i18n.getMessage('readAloud') || 'Read aloud';
      currentReadAloudBtn = null;
    }
  }

  function handleReadAloud(btn) {
    var targetId = btn.getAttribute('data-target');
    var targetEl = document.getElementById(targetId);
    if (!targetEl) return;

    if (btn === currentReadAloudBtn) {
      stopReadAloud();
      return;
    }

    stopReadAloud();

    var rawText = targetEl.getAttribute('data-raw-text');
    var text = rawText || targetEl.innerText;
    if (!text || !text.trim()) return;

    var speechText = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[(HIGH|MEDIUM|LOW)\]\s*/gi, '')
      .replace(/^[-*]\s+/gm, '')
      .trim();

    var lang = getOutputLanguage(extractedVideoData ? extractedVideoData.transcript.language : null);
    var langMap = { ja: 'ja-JP', en: 'en-US', es: 'es-ES' };
    var speechLang = langMap[lang] || 'en-US';

    var utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = speechLang;
    utterance.rate = SPEECH_SPEEDS[speechSpeedIndex];

    var voices = speechSynthesis.getVoices();
    var selectedURI = el.voiceSelect.value;
    var matchVoice = null;
    if (selectedURI) {
      matchVoice = voices.find(function (v) { return v.voiceURI === selectedURI; });
    }
    if (!matchVoice) {
      matchVoice = voices.find(function (v) {
        return v.lang === speechLang || v.lang.startsWith(lang);
      });
    }
    if (matchVoice) utterance.voice = matchVoice;

    currentReadAloudBtn = btn;
    btn.classList.add('svd-speaking');
    btn.querySelector('.svd-icon-play').classList.add('svd-hidden');
    btn.querySelector('.svd-icon-stop').classList.remove('svd-hidden');
    btn.title = chrome.i18n.getMessage('stopReadAloud') || 'Stop reading';

    utterance.onend = function () { stopReadAloud(); };
    utterance.onerror = function () { stopReadAloud(); };

    speechSynthesis.speak(utterance);
  }

  // --- Markdown Download ---
  function generateMarkdown() {
    if (!extractedVideoData || !extractedVideoData.metadata) return '';

    var meta = extractedVideoData.metadata;
    var videoUrl = 'https://www.youtube.com/watch?v=' + meta.videoId;
    var transcriptLang = extractedVideoData.transcript ? extractedVideoData.transcript.language : null;
    var outputLang = getOutputLanguage(transcriptLang);

    // Use i18n headings matching output language
    var headingTldr = chrome.i18n.getMessage('tldrHeading') || 'TL;DR';
    var headingKeyPoints = chrome.i18n.getMessage('keyPointsHeading') || 'Key Points';
    var headingChapters = chrome.i18n.getMessage('chapterSummariesHeading') || 'Chapter Summaries';
    var headingTranscript = chrome.i18n.getMessage('fullTranscriptHeading') || 'Full Transcript';

    var lines = [];
    lines.push('# ' + (meta.title || 'Untitled'));
    lines.push('');
    lines.push('**URL**: ' + videoUrl);
    if (meta.author) lines.push('**Channel**: ' + meta.author);
    if (meta.lengthSeconds) lines.push('**Duration**: ' + formatDuration(meta.lengthSeconds));
    lines.push('');

    // TL;DR
    var tldrText = el.tldrContent.getAttribute('data-raw-text');
    if (tldrText) {
      lines.push('## ' + headingTldr);
      lines.push('');
      lines.push(tldrText);
      lines.push('');
    }

    // Key Points
    var keyPointsText = el.keyPointsContent.getAttribute('data-raw-text');
    if (keyPointsText) {
      lines.push('## ' + headingKeyPoints);
      lines.push('');
      lines.push(keyPointsText);
      lines.push('');
    }

    // Chapters
    var cached = tabCache[currentTabId];
    var chapters = extractedVideoData.chapters;
    var chapterSummaries = cached ? cached.chapterSummaries : null;
    if (chapters && chapters.length > 0) {
      lines.push('## ' + headingChapters);
      lines.push('');
      for (var i = 0; i < chapters.length; i++) {
        var ch = chapters[i];
        var chTitle = ch.title ||
          (chrome.i18n.getMessage('partLabel') || 'Part') + ' ' + (i + 1);
        lines.push('### ' + ch.startLabel + ' - ' + chTitle);
        lines.push('');
        if (chapterSummaries && chapterSummaries[i]) {
          lines.push(chapterSummaries[i]);
          lines.push('');
        }
      }
    }

    // Full Transcript — organized by chapters when available
    if (extractedVideoData.transcript && extractedVideoData.transcript.fullText) {
      lines.push('## ' + headingTranscript);
      lines.push('');
      if (chapters && chapters.length > 0) {
        for (var k = 0; k < chapters.length; k++) {
          var tch = chapters[k];
          var tchTitle = tch.title ||
            (chrome.i18n.getMessage('partLabel') || 'Part') + ' ' + (k + 1);
          lines.push('### ' + tch.startLabel + ' - ' + tchTitle);
          lines.push('');
          if (tch.text) {
            lines.push(tch.text);
            lines.push('');
          }
        }
      } else {
        lines.push(extractedVideoData.transcript.fullText);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  function downloadMarkdown() {
    var md = generateMarkdown();
    if (!md) return;

    var meta = extractedVideoData.metadata;
    var filename = (meta.videoId || 'video') + '-summary.md';

    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(chrome.i18n.getMessage('downloadSuccess') || 'Downloaded!');
  }

  function getErrorMessage(err) {
    var msg = err.message || String(err);
    var map = {
      noSubtitles: chrome.i18n.getMessage('noSubtitles') ||
        'This video does not have subtitles/captions available.',
      noPlayerData: chrome.i18n.getMessage('noPlayerData') ||
        'Could not read video data. Try refreshing the page.',
      notYouTube: chrome.i18n.getMessage('notYouTube') ||
        'Open a YouTube video to summarize it.',
      noActiveTab: chrome.i18n.getMessage('noActiveTab') ||
        'No active tab found.',
      extractionFailed: 'Failed to extract video transcript.'
    };
    return map[msg] || msg;
  }

  // --- Event Binding ---
  function bindEvents() {
    el.summarizeBtn.addEventListener('click', function () { handleSummarize(); });
    el.customPromptBtn.addEventListener('click', handleCustomPrompt);
    el.generateQuizBtn.addEventListener('click', handleGenerateQuiz);
    el.downloadMdBtn.addEventListener('click', downloadMarkdown);

    el.customPromptInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault();
        if (!el.customPromptBtn.disabled) {
          handleCustomPrompt();
        }
      }
    });

    chrome.runtime.onMessage.addListener(function (message) {
      if (message.type === config.MESSAGES.START_SUMMARIZE) {
        if (!el.summarizeBtn.disabled) {
          handleSummarize();
        }
      }
    });

    chrome.tabs.onActivated.addListener(function (activeInfo) {
      switchToTab(activeInfo.tabId);
    });

    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
      if (changeInfo.url) {
        delete tabCache[tabId];
        if (tabId === currentTabId) {
          showFreshState();
          if (!isYouTubeWatch(changeInfo.url)) {
            el.summarizeBtn.disabled = true;
            showStatus('info', chrome.i18n.getMessage('notYouTube') ||
              'Open a YouTube video to summarize it.');
            return;
          }
          resetSummarizeBtn();
          hideStatus();
          if (currentSettings.autoSummarize) {
            handleSummarize();
          }
        }
      }
    });

    chrome.tabs.onRemoved.addListener(function (tabId) {
      delete tabCache[tabId];
    });

    el.settingsBtn.addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
    });

    el.copyVideoInfoBtn.addEventListener('click', function () {
      if (extractedVideoData && extractedVideoData.metadata) {
        var meta = extractedVideoData.metadata;
        var url = 'https://www.youtube.com/watch?v=' + meta.videoId;
        var mdLink = '[' + meta.title + '](' + url + ')';
        copyToClipboard(mdLink);
        el.copyVideoInfoBtn.classList.add('svd-copied');
        setTimeout(function () {
          el.copyVideoInfoBtn.classList.remove('svd-copied');
        }, 2000);
      }
    });

    el.langSelect.addEventListener('change', function () {
      saveSetting('outputLanguage', el.langSelect.value);
      populateVoiceList();
    });

    el.voiceSelect.addEventListener('change', function () {
      savedVoiceURI = el.voiceSelect.value;
      saveSetting('voiceURI', savedVoiceURI);
    });

    speechSynthesis.addEventListener('voiceschanged', function () {
      populateVoiceList();
    });

    el.speechSpeedBtn.addEventListener('click', cycleSpeechSpeed);

    document.querySelectorAll('.svd-read-aloud-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleReadAloud(btn);
      });
    });

    document.querySelectorAll('.svd-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var targetId = btn.getAttribute('data-target');
        var targetEl = document.getElementById(targetId);
        if (targetEl) {
          var rawText = targetEl.getAttribute('data-raw-text');
          copyToClipboard(rawText || targetEl.innerText);
          btn.classList.add('svd-copied');
          setTimeout(function () {
            btn.classList.remove('svd-copied');
          }, 2000);
        }
      });
    });
  }

  // --- Start ---
  document.addEventListener('DOMContentLoaded', init);
})();
