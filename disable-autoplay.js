// Soraの各ページで動画の自動再生を徹底的にブロックする
// - ページ側の .play() 呼び出しを早期にフック（ページコンテキストに注入）
// - autoplay属性の削除と明示pause
// - SPA遷移や動的追加にも対応

(() => {
  'use strict';

  // 1) ページコンテキストへMAINワールド実行で注入（CSP回避）
  function isExemptPage(pathname) {
    try {
      const p = typeof pathname === 'string' ? pathname : (location.pathname || '');
      return p.startsWith('/d/') || p.startsWith('/p/');
    } catch { return false; }
  }

  function currentPathname() {
    try { return location.pathname || ''; } catch { return ''; }
  }

  let lastKnownPathname = currentPathname();

  (function requestMainWorldInjection(){
    try {
      if (window.__SORA_INJECT_REQUESTED__) return;
      window.__SORA_INJECT_REQUESTED__ = true;
      if (!isExemptPage() && chrome && chrome.runtime && chrome.runtime.sendMessage) {
        try { console.debug('[SoraAutoplay] request MAIN-world injection'); } catch {}
        chrome.runtime.sendMessage({ type: 'inject-page-script' }, () => {
          // 応答は特に使わない（失敗時も機能は劣化しつつ継続）
        });
      }
    } catch {}
  })();

  // ページ起因のCSP違反を特定しやすくするための軽量ログ
  try {
    window.addEventListener('securitypolicyviolation', (e) => {
      try {
        console.debug('[SoraAutoplay][CSP]', e.violatedDirective, e.blockedURI || 'inline', e.sourceFile || location.href, e.lineNumber || 0);
      } catch {}
    }, true);
  } catch {}

  // 2) コンテンツスクリプト側でも属性・状態を調整
  function isDraftsPage() {
    try { return location.pathname.startsWith('/drafts'); } catch { return false; }
  }

  function parseMetaFromUrl(urlStr) {
    if (!urlStr) return { issued: null, thumbId: null };
    try {
      const u = new URL(urlStr);
      const issued = u.searchParams.get('skt') || null;
      const path = decodeURIComponent(u.pathname || '');
      let thumbId = null;
      const m = path.match(/\/files\/([A-Za-z0-9_%-]+)_00000000-/);
      if (m) thumbId = m[1];
      return { issued, thumbId };
    } catch {
      try {
        const issuedMatch = urlStr.match(/skt=([\dT:%-]+)/);
        const issued = issuedMatch ? decodeURIComponent(issuedMatch[1]) : null;
        const thumbMatch = decodeURIComponent(urlStr).match(/\/files\/([A-Za-z0-9_%-]+)_00000000-/);
        const thumbId = thumbMatch ? thumbMatch[1] : null;
        return { issued, thumbId };
      } catch { return { issued: null, thumbId: null }; }
    }
  }

  function fmtLocal(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function upsertOverlayForVideo(video) {
    if (!isDraftsPage()) return;
    if (!(video instanceof HTMLVideoElement)) return;

    // 候補URL（poster優先、なければ退避src、その次に現在のsrc）
    const poster = video.getAttribute('poster');
    const ds = video.dataset || {};
    const lazySrc = ds.soraLazySrc || '';
    const currentSrc = video.getAttribute('src') || '';

    const meta = [poster, lazySrc, currentSrc]
      .map(parseMetaFromUrl)
      .reduce((acc, m) => ({
        issued: acc.issued || m.issued,
        thumbId: acc.thumbId || m.thumbId,
      }), { issued: null, thumbId: null });

    if (!meta.issued && !meta.thumbId) return; // 情報がなければ何もしない

    // オーバーレイを表示するコンテナ（親がaならa、なければ親要素）
    let container = video.parentElement || video;
    try {
      if (container && container.tagName !== 'A' && video.closest) {
        const a = video.closest('a');
        if (a) container = a;
      }
    } catch {}
    if (!container) container = video;

    // クリック干渉回避
    try {
      const cs = getComputedStyle(container);
      if (cs.position === 'static') {
        container.style.position = 'relative';
      }
    } catch {}

    let overlay = container.querySelector('.sora-meta-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sora-meta-overlay';
      overlay.style.position = 'absolute';
      overlay.style.top = '6px';
      overlay.style.left = '6px';
      overlay.style.zIndex = '5';
      overlay.style.pointerEvents = 'none';
      overlay.style.background = 'rgba(37,37,37,0.70)';
      overlay.style.color = '#fff';
      overlay.style.fontSize = '12px';
      overlay.style.lineHeight = '1.25';
      overlay.style.padding = '4px 6px';
      overlay.style.borderRadius = '6px';
      overlay.style.boxShadow = '0 2px 10px rgba(0,0,0,0.25)';
      overlay.style.backdropFilter = 'blur(2px)';
      container.appendChild(overlay);
    }

    const issuedText = meta.issued ? fmtLocal(meta.issued) : '';
    const lines = [];
    if (issuedText) lines.push(`発行日時: ${issuedText}`);
    if (meta.thumbId) lines.push(`サムネイルID: ${meta.thumbId}`);
    overlay.textContent = lines.join('\n');
    overlay.style.whiteSpace = 'pre-line';
  }

  function stashSourcesForLazy(video) {
    if (!video || !(video instanceof HTMLVideoElement)) return;
    const ds = video.dataset || {};
    if (ds.soraLazy) return; // 既に適用

    // 既にユーザーが再生した、あるいはプログラムが操作中ならスキップ
    if (video.__soraLazyRestored) return;

    // ソースが存在する場合のみ退避（動的にMSE等で設定されるケースは対象外）
    const directSrc = video.getAttribute('src');
    const sourceNodes = Array.from(video.querySelectorAll('source[src]'));
    if (!directSrc && sourceNodes.length === 0) return;

    try {
      // 元preloadを保持
      if (!ds.soraLazyPreload) {
        const currentPreload = video.getAttribute('preload') || '';
        if (currentPreload) ds.soraLazyPreload = currentPreload;
      }
      // 退避
      if (directSrc) ds.soraLazySrc = directSrc;
      if (sourceNodes.length) {
        const list = sourceNodes.map((n) => ({ src: n.getAttribute('src'), type: n.getAttribute('type') || '' }));
        ds.soraLazySources = JSON.stringify(list);
      }
      ds.soraLazy = '1';

      // 読み込みを抑制
      video.removeAttribute('src');
      sourceNodes.forEach((n) => n.remove());
      video.setAttribute('preload', 'none');
      // ネットワークを中断
      try { video.pause(); } catch {}
      try { video.load(); } catch {}
    } catch {}
  }

  function disableAutoplayOn(media) {
    if (!media) return;
    try {
      if (media.hasAttribute('autoplay')) media.removeAttribute('autoplay');
      media.autoplay = false;
      // 念のため停止（すでに再生開始されていても止める）
      media.pause();
      // ロード後に勝手に再開しないように保険
      media.addEventListener('loadeddata', () => {
        try { media.pause(); } catch {}
      }, { once: true, capture: true });
      // 動画の場合はサムネイルのみ表示（poster）にして実ソースを遅延
      if (media instanceof HTMLVideoElement) {
        stashSourcesForLazy(media);
        upsertOverlayForVideo(media);
      }
    } catch {}
  }

  function initExisting() {
    document.querySelectorAll('video, audio').forEach(disableAutoplayOn);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const t = m.target;
        if (t instanceof HTMLMediaElement) {
          disableAutoplayOn(t);
        } else if (t && (t.tagName === 'SOURCE' || t instanceof HTMLSourceElement)) {
          const p = t.parentNode;
          if (p && p instanceof HTMLMediaElement) disableAutoplayOn(p);
        }
      }

      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLMediaElement) {
            disableAutoplayOn(node);
          } else if (node && node.querySelectorAll) {
            node.querySelectorAll('video, audio').forEach(disableAutoplayOn);
          }
          // 新しく開かれたshadowRootにも監視を広げる
          try {
            if (node && node.shadowRoot) {
              observeDeep(node.shadowRoot);
              node.shadowRoot.querySelectorAll('video, audio').forEach(disableAutoplayOn);
            }
          } catch {}
        }
      }
    }
  });

  let blockersEnabled = false;

  function observeDeep(root) {
    try {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['autoplay', 'src', 'poster', 'preload']
      });
    } catch {}
  }

  function startObserver() {
    const start = () => {
      try {
        const base = document.body || document.documentElement;
        observeDeep(base);
        // 既存の開放済みshadowRootを拾う
        document.querySelectorAll('*').forEach((el) => {
          try {
            if (el.shadowRoot) {
              observeDeep(el.shadowRoot);
              el.shadowRoot.querySelectorAll('video, audio').forEach(disableAutoplayOn);
            }
          } catch {}
        });
      } catch {}
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function enableBlockers() {
    if (blockersEnabled) return;
    blockersEnabled = true;
    initExisting();
    startObserver();
  }

  function disableBlockers() {
    if (!blockersEnabled) return;
    blockersEnabled = false;
    try { observer.disconnect(); } catch {}
    // 既に遅延化したメディアを元に戻して副作用を解消
    try {
      const restoreIfLazy = (media) => {
        try {
          if (!media || !(media instanceof HTMLMediaElement)) return;
          const ds = media.dataset || {};
          if (!ds.soraLazy && !ds.soraLazySrc && !ds.soraLazySources) return;
          // 既存<source>をクリア
          try { media.querySelectorAll('source').forEach((n) => n.remove()); } catch {}
          // srcの復元
          if (ds.soraLazySrc) media.src = ds.soraLazySrc; else media.removeAttribute('src');
          // <source>の復元
          if (ds.soraLazySources) {
            try {
              const list = JSON.parse(ds.soraLazySources);
              if (Array.isArray(list)) {
                list.forEach((it) => {
                  if (!it || !it.src) return;
                  const s = document.createElement('source');
                  s.src = it.src;
                  if (it.type) s.type = it.type;
                  media.appendChild(s);
                });
              }
            } catch {}
          }
          if (ds.soraLazyPreload) media.setAttribute('preload', ds.soraLazyPreload); else media.removeAttribute('preload');
          media.load();
          delete ds.soraLazy;
          delete ds.soraLazySrc;
          delete ds.soraLazySources;
          delete ds.soraLazyPreload;
          media.__soraLazyRestored = true;
        } catch {}
      };
      document.querySelectorAll('video, audio').forEach(restoreIfLazy);
    } catch {}
  }

  function reevaluate() {
    const currentPath = currentPathname();
    lastKnownPathname = currentPath;
    if (isExemptPage(currentPath)) {
      disableBlockers();
    } else {
      enableBlockers();
      // 免除ページから戻った場合は改めてMAINワールド注入を要求
      try {
        if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'inject-page-script' }, () => {});
        }
      } catch {}
    }
  }

  // 初期適用（DOMContentLoaded 済みでも即時実行される）
  reevaluate();

  // スクロールで遅延挿入される要素を念のため再スキャン（バッチ処理）
  let scanTimer = null;
  function scheduleRescan() {
    if (!blockersEnabled || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (blockersEnabled) initExisting();
    }, 250);
  }
  window.addEventListener('scroll', scheduleRescan, { passive: true });
  window.addEventListener('resize', scheduleRescan, { passive: true });

  // SPA遷移やBFCache復帰対策
  window.addEventListener('pageshow', (e) => { if (e.persisted) reevaluate(); }, true);
  (function patchHistory() {
    try {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function patchedPushState(...args) {
        const ret = origPush.apply(this, args);
        queueMicrotask(reevaluate);
        return ret;
      };
      history.replaceState = function patchedReplaceState(...args) {
        const ret = origReplace.apply(this, args);
        queueMicrotask(reevaluate);
        return ret;
      };
      window.addEventListener('popstate', () => queueMicrotask(reevaluate));
      window.addEventListener('hashchange', () => queueMicrotask(reevaluate));
    } catch {}
  })();

  (function monitorPathnameChanges() {
    try {
      const check = () => {
        const now = currentPathname();
        if (now !== lastKnownPathname) {
          lastKnownPathname = now;
          reevaluate();
        }
      };
      const interval = setInterval(check, 400);
      window.addEventListener('visibilitychange', check, true);
      window.addEventListener('focus', check, true);
      window.addEventListener('beforeunload', () => clearInterval(interval), { once: true });
    } catch {}
  })();
})();
  
