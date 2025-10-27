(() => {
  'use strict';
  try {
    if (window.__SORA_AUTOPLAY_PATCHED__) return;
    window.__SORA_AUTOPLAY_PATCHED__ = true;
    try { console.debug('[SoraAutoplay] page-inject loaded (MAIN world)'); } catch {}

    const OriginalPlay = HTMLMediaElement.prototype.play;
    const allowedByUser = new WeakSet();
    let lastGestureTs = 0;
    const ALLOW_WINDOW_MS = 1500; // ユーザー操作直後のみ許可

    function isExemptPage() {
      try {
        const p = location.pathname || '';
        return p.startsWith('/d/') || p.startsWith('/p/');
      } catch { return false; }
    }

    function isAllowed(el) {
      return allowedByUser.has(el) || (Date.now() - lastGestureTs) < ALLOW_WINDOW_MS;
    }

    // data属性に退避してある実ソースを復元
    function restoreIfLazy(media) {
      try {
        if (!media || !(media instanceof HTMLMediaElement)) return;
        const ds = media.dataset || {};
        if (media.__soraLazyRestored || (!ds.soraLazy && !ds.soraLazySrc && !ds.soraLazySources)) return;
        // 既存<source>は一旦クリア
        try {
          const sources = media.querySelectorAll('source');
          sources.forEach((n) => n.remove());
        } catch {}
        // srcの復元
        if (ds.soraLazySrc) {
          media.src = ds.soraLazySrc;
        } else {
          media.removeAttribute('src');
        }
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
        // preloadの復元
        if (ds.soraLazyPreload) {
          media.setAttribute('preload', ds.soraLazyPreload);
        } else {
          media.setAttribute('preload', 'metadata');
        }
        // 状態更新
        media.load();
        media.__soraLazyRestored = true;
        delete ds.soraLazy;
        delete ds.soraLazySrc;
        delete ds.soraLazySources;
        delete ds.soraLazyPreload;
      } catch {}
    }

    // ユーザー操作を検知（対象videoは優先して許可）
    const gesture = (e) => {
      lastGestureTs = Date.now();
      const t = e && e.target;
      if (t instanceof HTMLMediaElement) {
        allowedByUser.add(t);
        restoreIfLazy(t);
      } else if (t && t.querySelector) {
        const v = t.querySelector('video, audio');
        if (v) {
          allowedByUser.add(v);
          restoreIfLazy(v);
        }
      }
    };

    window.addEventListener('pointerdown', gesture, true);
    window.addEventListener('click', gesture, true);
    window.addEventListener('keydown', () => { lastGestureTs = Date.now(); }, true);

    // 再生要求を横取りしてブロック
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: function playPatched(...args) {
        // /d/ と /p/ はブロック対象外
        if (isExemptPage()) {
          return OriginalPlay.apply(this, args);
        }
        if (!isAllowed(this)) {
          try { this.pause(); } catch {}
          const err = new DOMException('play() interrupted: autoplay blocked', 'NotAllowedError');
          return Promise.reject(err);
        }
        // 許可時は必要に応じて実ソースを復元
        try { restoreIfLazy(this); } catch {}
        return OriginalPlay.apply(this, args);
      }
    });
  } catch {}
})();
