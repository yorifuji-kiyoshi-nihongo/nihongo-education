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
  let objectUrl;
  let fetchController;
  let ready = false;
  let pendingSeek = null;
  let targets = new Map();
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
      <p data-current></p>
      <p data-status role="status"></p>
    </section>`;
  const ui = Object.fromEntries(['play', 'stop', 'prev', 'next', 'time', 'seek', 'unit',
    'jump', 'speed', 'scroll', 'status', 'current'].map(name => [name, host.querySelector(`[data-${name}]`)]));
  ui.speed.value = speed;
  ui.scroll.checked = autoscroll;

  const position = () => ready ? media.currentTime : wantedTime;
  const boundaryTolerance = 0.001;
  const storageId = () => `position:${chapter}`;
  function save(force = false) {
    if (!manifest || !ready || pendingSeek || media.seeking) return;
    const time = position();
    if (force || Math.floor(time) !== lastSaved) {
      lastSaved = Math.floor(time);
      const unit = manifest.units[unitAt(time)];
      write(storageId(), { id: unit.id, hash: unit.hash, offset: Math.max(0, time - unit.start) });
    }
  }
  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function unitAt(time) {
    let index = manifest.units.length - 1;
    while (index > 0 && manifest.units[index].start > time + boundaryTolerance) index--;
    return index;
  }
  function clearHighlight() {
    highlighted.forEach(node => node.classList.remove('lesson-audio-current'));
    highlighted = [];
    badge.remove();
  }
  function mapTargets() {
    clearHighlight();
    const children = root.querySelector('.lesson-explanation')?.children;
    targets = new Map(manifest.units.map(unit => {
      const nodes = unit.targets.length
        ? unit.targets.map(index => children?.[index]).filter(Boolean)
        : Array.from(root.querySelectorAll(':scope > h2:first-child, :scope > .goal'));
      nodes.forEach(node => { node.dataset.audioUnit = unit.id; });
      return [unit.id, nodes];
    }));
  }
  function highlight(scroll) {
    clearHighlight();
    highlighted = targets.get(manifest.units[active]?.id) || [];
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
    if (ready && !pendingSeek && !media.seeking && next !== active) {
      active = next;
      ui.current.textContent = `音声位置：${manifest.units[active].label}`;
      ui.current.dataset.unitId = manifest.units[active].id;
      highlight(scroll);
    }
    ui.play.disabled = !ready;
    ui.stop.disabled = !ready;
    ui.seek.disabled = !ready || !media.seekable.length;
    ui.jump.disabled = ui.seek.disabled;
    ui.prev.disabled = ui.seek.disabled || next === 0;
    ui.next.disabled = ui.seek.disabled || next === manifest.units.length - 1;
    ui.play.textContent = media.paused ? (time > 0 && !media.ended ? '再開' : '再生') : '一時停止';
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = media.paused ? 'paused' : 'playing';
      if (ready && duration > 0) {
        try {
          navigator.mediaSession.setPositionState?.({
            duration, position: Math.min(time, duration), playbackRate: speed
          });
        } catch { /* Media Session support varies by browser. */ }
      }
    }
  }
  function seek(time, scroll = true) {
    if (!ready || !media.seekable.length || !Number.isFinite(time)) return;
    const target = Math.min(media.duration, Math.max(0, time));
    if (!media.seeking && Math.abs(media.currentTime - target) <= boundaryTolerance) {
      refresh();
      if (scroll && autoscroll) badge.scrollIntoView({ block: 'center' });
      save(true);
      return;
    }
    pendingSeek = { target, scroll };
    media.currentTime = target;
  }
  function play(resetEnded = true) {
    if (!ready) return;
    ui.status.textContent = '';
    if (resetEnded && media.ended) seek(0, false);
    if (autoscroll && !pendingSeek) badge.scrollIntoView({ block: 'center' });
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
    const index = Math.max(0, Math.min(manifest.units.length - 1, unitAt(pendingSeek?.target ?? position()) + delta));
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
    const unit = manifest.units.find(item => item.id === ui.unit.value);
    if (!unit || ui.jump.disabled) return;
    seek(unit.start);
    play(false);
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
    if (!manifest || media.currentSrc !== objectUrl) return;
    if (!Number.isFinite(media.duration) || Math.abs(media.duration - manifest.duration) > 0.15) {
      ui.status.textContent = '音声ファイルと段落情報の再生時間が一致しません。';
      return;
    }
  });
  media.addEventListener('canplay', () => {
    if (ready || !manifest || media.currentSrc !== objectUrl ||
        !Number.isFinite(media.duration) || Math.abs(media.duration - manifest.duration) > 0.15) return;
    ready = true;
    if (wantedTime > 0) {
      const resume = wantedTime;
      wantedTime = 0;
      seek(resume, false);
    }
    ui.status.textContent = '';
    refresh();
  });
  media.addEventListener('seeked', () => {
    if (!ready || !pendingSeek || media.seeking) return;
    const { target, scroll } = pendingSeek;
    pendingSeek = null;
    refresh();
    if (Math.abs(position() - target) > 0.1) {
      ui.status.textContent = '指定位置へ移動できませんでした。もう一度お試しください。';
    } else if (scroll && autoscroll) badge.scrollIntoView({ block: 'center' });
    save(true);
  });
  media.addEventListener('timeupdate', () => { refresh(!media.paused); save(); });
  ['play', 'pause', 'ended'].forEach(event => media.addEventListener(event, () => {
    refresh();
    save(true);
  }));
  media.addEventListener('error', () => {
    if (!manifest || !media.error) return;
    ready = false;
    pendingSeek = null;
    refresh();
    ui.status.textContent = '音声ファイルを再生できません。ページを再読み込みしてください。';
  });
  window.addEventListener('pagehide', () => save(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(true);
  });

  return async function attach(contentRoot, config) {
    root = contentRoot;
    if ((config?.id ?? null) === chapter) {
      if (manifest) { mapTargets(); highlight(false); }
      return;
    }
    save(true);
    const request = ++revision;
    chapter = config?.id ?? null;
    manifest = null;
    fetchController?.abort();
    ready = false;
    pendingSeek = null;
    wantedTime = 0;
    ui.current.textContent = '';
    delete ui.current.dataset.unitId;
    active = lastSaved = -1;
    media.pause();
    media.removeAttribute('src');
    media.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
    mediaSession(false);
    clearHighlight();
    host.hidden = true;
    ui.status.textContent = '';
    if (!config) return;
    options = config;
    fetchController = new AbortController();
    const { signal } = fetchController;
    try {
      const response = await fetch(config.manifestUrl, { signal });
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
          || new Set(next.units.map(unit => unit.id)).size !== next.units.length
          || next.units.some((unit, i) => !Array.isArray(unit.targets) || !unit.id
            || !Number.isFinite(unit.start) || !Number.isFinite(unit.duration) || unit.duration <= 0
            || Math.abs(unit.start - (i ? next.units[i - 1].start + next.units[i - 1].duration : 0)) > 0.03
            || Math.abs(unit.start + unit.duration - (next.units[i + 1]?.start ?? next.duration)) > 0.15)) {
        throw new Error('invalid manifest');
      }
      manifest = next;
      mapTargets();
      for (const el of Object.values(ui)) el.disabled = false;
      ui.unit.replaceChildren(...next.units.map(unit => new Option(unit.label, unit.id)));
      const stored = read(storageId());
      const unit = next.units.find(unit => unit.id === stored?.id);
      wantedTime = unit ? unit.start + (unit.hash === stored.hash && Number.isFinite(stored.offset)
        ? Math.max(0, Math.min(stored.offset, unit.duration)) : 0) : 0;
      ui.unit.value = unit?.id ?? next.units[0].id;
      host.hidden = false;
      ui.status.textContent = '音源を読み込んでいます。';
      refresh();
      // The private gateway may not serve byte ranges. A local Blob is seekable
      // without another request for each segment.
      const sourceUrl = new URL(next.src, new URL(config.manifestUrl, document.baseURI));
      const audioResponse = await fetch(sourceUrl, { signal });
      if (!audioResponse.ok || !/^audio\//i.test(audioResponse.headers.get('content-type') || '')) {
        throw new Error('audio response');
      }
      const bytes = await audioResponse.blob();
      if (request !== revision) return;
      objectUrl = URL.createObjectURL(bytes);
      media.preload = 'auto';
      media.defaultPlaybackRate = media.playbackRate = speed;
      media.src = objectUrl;
      mediaSession(true);
    } catch {
      if (request !== revision) return;
      host.hidden = false;
      for (const [key, el] of Object.entries(ui)) if (key !== 'status') el.disabled = true;
      ui.status.textContent = '読み上げ情報または音源を読み込めませんでした。ページを再読み込みしてください。';
    }
  };
};
