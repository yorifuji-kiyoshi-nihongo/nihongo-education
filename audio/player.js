'use strict';

window.createLessonAudio = function (host) {
  const media = new Audio();
  media.preload = 'metadata';
  media.preservesPitch = true;
  const keys = 'nihongo-lesson-audio:v1:';
  const speeds = [0.75, 1, 1.25, 1.5, 1.75, 2];
  function read(key) {
    try { return JSON.parse(localStorage.getItem(keys + key)); }
    catch { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(keys + key, JSON.stringify(value)); }
    catch { /* Playback is available even if storage is blocked. */ }
  }
  const preferences = read('preferences') || {};
  let speed = speeds.includes(preferences.speed) ? preferences.speed : 1;
  let autoscroll = preferences.autoscroll === true;
  let chapter = null;
  let manifest = null;
  let root;
  let options;
  let highlighted = [];
  let active = -1;
  let wantedTime = 0;
  let loading = false;
  let revision = 0;
  let lastSaved = -1;
  const badge = document.createElement('span');
  badge.className = 'lesson-audio-badge';
  badge.textContent = '音声位置';
  host.hidden = true;
  host.innerHTML = `
    <section class="lesson-audio" aria-label="解説の読み上げ">
      <div class="lesson-audio-primary">
        <button type="button" data-play>再生</button>
        <button type="button" data-stop>停止</button>
        <button type="button" data-prev>前の段落</button>
        <button type="button" data-next>次の段落</button>
      </div>
      <label class="lesson-audio-seek">
        <span>再生位置 <span data-time></span></span>
        <input type="range" min="0" value="0" step="0.1" data-seek>
      </label>
      <details>
        <summary>段落・再生設定</summary>
        <div class="lesson-audio-settings">
          <label>再生する段落 <select data-unit></select></label>
          <button type="button" data-jump>この段落から再生</button>
          <label>再生速度 <select data-speed>${speeds.map(s => `<option value="${s}">${s === 1 ? '1.0' : s}倍</option>`).join('')}</select></label>
          <label><input type="checkbox" data-scroll> 読み上げ箇所へ自動スクロール</label>
        </div>
      </details>
      <p data-status role="status"></p>
    </section>`;
  const ui = Object.fromEntries(['play', 'stop', 'prev', 'next', 'time', 'seek', 'unit',
    'jump', 'speed', 'scroll', 'status'].map(name => [name, host.querySelector(`[data-${name}]`)]));
  ui.speed.value = speed;
  ui.scroll.checked = autoscroll;

  const position = () => loading ? wantedTime : media.currentTime;
  const storageId = () => `position:${chapter}`;
  function save(force = false) {
    if (!manifest) return;
    const time = position();
    if (force || Math.floor(time) !== lastSaved) {
      lastSaved = Math.floor(time);
      const unit = manifest.units[unitAt(time)];
      write(storageId(), { id: unit.id, hash: unit.hash, offset: time - unit.start });
    }
  }
  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function unitAt(time) {
    let index = manifest.units.length - 1;
    while (index > 0 && manifest.units[index].start > time) index--;
    return index;
  }
  function clearHighlight() {
    highlighted.forEach(node => node.classList.remove('lesson-audio-current'));
    highlighted = [];
    badge.remove();
  }
  function highlight(scroll) {
    clearHighlight();
    const children = root.querySelector('.lesson-explanation')?.children;
    const unit = manifest.units[active];
    highlighted = unit.targets.length
      ? unit.targets.map(index => children?.[index]).filter(Boolean)
      : Array.from(root.querySelectorAll(':scope > h2:first-child, :scope > .goal'));
    const first = highlighted[0];
    if (!first) return;
    highlighted.forEach(node => node.classList.add('lesson-audio-current'));
    first.before(badge);
    if (scroll && autoscroll) badge.scrollIntoView({ block: 'center' });
  }
  function refresh(scroll = false) {
    if (!manifest) return;
    const time = position();
    const duration = Number.isFinite(media.duration) ? media.duration : manifest.duration;
    ui.seek.max = duration;
    ui.seek.value = time;
    ui.time.textContent = `${clock(time)} / ${clock(duration)}`;
    ui.seek.setAttribute('aria-valuetext', ui.time.textContent);
    const next = unitAt(time);
    if (next !== active) {
      active = next;
      ui.unit.value = next;
      highlight(scroll);
    }
    ui.prev.disabled = next === 0;
    ui.next.disabled = next === manifest.units.length - 1;
    ui.play.textContent = media.paused ? (time > 0 && !media.ended ? '再開' : '再生') : '一時停止';
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = media.paused ? 'paused' : 'playing';
      if (duration > 0) navigator.mediaSession.setPositionState?.({
        duration, position: Math.min(time, duration), playbackRate: speed
      });
    }
  }
  function seek(time, scroll = true) {
    const duration = Number.isFinite(media.duration) ? media.duration : manifest.duration;
    wantedTime = Math.min(duration, Math.max(0, time));
    if (!loading) media.currentTime = wantedTime;
    refresh(scroll);
    save(true);
  }
  function play() {
    if (!manifest) return;
    ui.status.textContent = '';
    if (media.error) {
      wantedTime = position();
      loading = true;
      media.load();
    } else if (media.ended) seek(0, false);
    if (autoscroll) badge.scrollIntoView({ block: 'center' });
    const request = revision;
    media.play().catch(error => {
      if (request === revision && error.name !== 'AbortError') {
        ui.status.textContent = media.error
          ? '音声ファイルを取得できません。通信状況を確認して再生し直してください。'
          : '再生を開始できませんでした。もう一度、再生を選択してください。';
      }
    });
  }
  function move(delta) {
    const index = Math.max(0, Math.min(manifest.units.length - 1, active + delta));
    seek(manifest.units[index].start);
  }
  function stop() {
    media.pause();
    seek(0, false);
  }
  function mediaSession(enabled) {
    const session = navigator.mediaSession;
    if (!session) return;
    session.metadata = enabled && window.MediaMetadata ? new MediaMetadata(options.metadata) : null;
    const actions = { play, pause: () => media.pause(), stop,
      previoustrack: () => move(-1), nexttrack: () => move(1),
      seekto: event => seek(event.seekTime),
      seekbackward: event => seek(position() - (event.seekOffset || 10)),
      seekforward: event => seek(position() + (event.seekOffset || 10)) };
    Object.entries(actions).forEach(([name, action]) => {
      try { session.setActionHandler(name, enabled ? action : null); }
      catch { /* Available actions vary by operating system. */ }
    });
    if (!enabled) {
      session.setPositionState?.();
      session.playbackState = 'none';
    }
  }
  ui.play.onclick = () => media.paused ? play() : media.pause();
  ui.stop.onclick = stop;
  ui.prev.onclick = () => move(-1);
  ui.next.onclick = () => move(1);
  ui.jump.onclick = () => {
    seek(manifest.units[Number(ui.unit.value)].start);
    play();
  };
  ui.seek.oninput = () => seek(Number(ui.seek.value));
  function savePrefs() { write('preferences', { speed, autoscroll }); }
  ui.speed.onchange = () => {
    speed = Number(ui.speed.value);
    media.defaultPlaybackRate = media.playbackRate = speed;
    savePrefs();
    refresh();
  };
  ui.scroll.onchange = () => {
    autoscroll = ui.scroll.checked;
    savePrefs();
    if (autoscroll && !media.paused) badge.scrollIntoView({ block: 'center' });
  };
  media.addEventListener('loadedmetadata', () => {
    if (!manifest) return;
    loading = false;
    seek(wantedTime, false);
  });
  media.addEventListener('timeupdate', () => { refresh(!media.paused); save(); });
  ['play', 'pause', 'ended'].forEach(event => media.addEventListener(event, () => {
    refresh();
    save(true);
  }));
  media.addEventListener('error', () => {
    if (manifest && media.error) ui.status.textContent =
      '音声ファイルを取得できません。通信状況を確認して再生し直してください。';
  });
  window.addEventListener('pagehide', () => save(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(true);
  });

  return async function attach(contentRoot, config) {
    root = contentRoot;
    if ((config?.id ?? null) === chapter) {
      if (manifest) highlight(false);
      return;
    }
    save(true);
    const request = ++revision;
    chapter = config?.id ?? null;
    manifest = null;
    active = lastSaved = -1;
    media.pause();
    media.removeAttribute('src');
    media.load();
    mediaSession(false);
    clearHighlight();
    host.hidden = true;
    ui.status.textContent = '';
    if (!config) return;
    options = config;
    try {
      const response = await fetch(config.manifestUrl);
      if (response.status === 404) return;
      if (!response.ok) throw new Error('manifest');
      const next = await response.json();
      if (request !== revision) return;
      if (config.source && globalThis.crypto?.subtle) {
        const bytes = new TextEncoder().encode(JSON.stringify(config.source));
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          byte => byte.toString(16).padStart(2, '0')).join('');
        if (request !== revision) return;
        if (hash !== next.sourceHash) throw new Error('source changed');
      }
      if (`${next.course}:${next.chapter}` !== chapter || !next.units?.length
          || !Number.isFinite(next.duration) || next.duration <= 0 || !next.src
          || next.units.some(unit => !Array.isArray(unit.targets) || !unit.id
            || !Number.isFinite(unit.start) || unit.start < 0 || unit.start >= next.duration)) {
        throw new Error('invalid manifest');
      }
      manifest = next;
      for (const el of Object.values(ui)) el.disabled = false;
      ui.unit.replaceChildren(...next.units.map((unit, index) => new Option(unit.label, index)));
      const stored = read(storageId());
      const unit = next.units.find(unit => unit.id === stored?.id);
      wantedTime = unit ? unit.start + (unit.hash === stored.hash && Number.isFinite(stored.offset)
        ? Math.max(0, Math.min(stored.offset, unit.duration)) : 0) : 0;
      loading = true;
      media.defaultPlaybackRate = media.playbackRate = speed;
      media.src = new URL(next.src, new URL(config.manifestUrl, document.baseURI)).href;
      mediaSession(true);
      host.hidden = false;
      refresh();
    } catch {
      if (request !== revision) return;
      host.hidden = false;
      for (const [key, el] of Object.entries(ui)) if (key !== 'status') el.disabled = true;
      ui.status.textContent = '読み上げ情報を読み込めませんでした。ページを再読み込みしてください。';
    }
  };
};
