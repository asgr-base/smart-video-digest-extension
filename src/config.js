/**
 * @file Shared configuration for Smart Video Digest extension
 */
(function () {
  'use strict';

  const SVD_CONFIG = Object.freeze({
    SUMMARY_LENGTHS: Object.freeze({
      SHORT: 'short',
      MEDIUM: 'medium',
      LONG: 'long'
    }),

    OUTPUT_LANGUAGES: Object.freeze({
      AUTO: 'auto',
      JA: 'ja',
      EN: 'en',
      ES: 'es'
    }),

    LANGUAGE_LABELS: Object.freeze({
      auto: 'Auto',
      ja: '日本語',
      en: 'English',
      es: 'Español'
    }),

    LANGUAGE_NAMES_FOR_PROMPT: Object.freeze({
      ja: 'Japanese',
      en: 'English',
      es: 'Spanish'
    }),

    TEXT_LIMITS: Object.freeze({
      CHUNK_SIZE: 3000,
      PROMPT_API_MAX_CHARS: 4000,
      MIN_CHARS: 50,
      TRUNCATION_SUFFIX: '\n\n[Text truncated for summarization]'
    }),

    DEFAULT_SETTINGS: Object.freeze({
      summaryLength: 'medium',
      outputLanguage: 'ja',
      autoSummarize: false
    }),

    MESSAGES: Object.freeze({
      EXTRACT_TRANSCRIPT: 'extractTranscript',
      START_SUMMARIZE: 'startSummarize'
    }),

    // Default chapter duration (ms) when no chapters are defined
    DEFAULT_CHAPTER_DURATION_MS: 150000, // 2.5 minutes

    STORAGE_KEY: 'svdSettings'
  });

  if (typeof globalThis !== 'undefined') {
    globalThis.SVD_CONFIG = SVD_CONFIG;
  }
})();
