const trainingDrafts = new Map();

document.addEventListener('input', event => {
  const field = event.target;
  if (!field.matches('textarea[data-training-key]')) return;
  const key = field.dataset.trainingKey;
  trainingDrafts.set(key, field.value);
  const status = document.getElementById(field.id + '-status');
  try {
    if (field.value === '') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, field.value);
    }
    trainingDrafts.delete(key);
    status.textContent = field.value ? '保存済み' : '';
  } catch {
    status.textContent = 'ブラウザに保存できません。再読み込みの前に回答をコピーしてください。';
  }
});

function selectHintTab(tab) {
  const group = tab.closest('.training-hint-tabs');
  for (const item of group.querySelectorAll('[role="tab"]')) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
}

document.addEventListener('click', event => {
  const tab = event.target.closest('.training-hint-tabs [role="tab"]');
  if (tab) selectHintTab(tab);
});

document.addEventListener('keydown', event => {
  const tab = event.target.closest('.training-hint-tabs [role="tab"]');
  if (!tab || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(tab);
  const destination = {
    ArrowLeft: tabs[(index + tabs.length - 1) % tabs.length],
    ArrowRight: tabs[(index + 1) % tabs.length],
    Home: tabs[0],
    End: tabs.at(-1)
  }[event.key];
  if (!destination) return;
  event.preventDefault();
  selectHintTab(destination);
  destination.focus();
});

function restoreTrainingAnswers(root) {
  for (const field of root.querySelectorAll('textarea[data-training-key]')) {
    const key = field.dataset.trainingKey;
    const status = document.getElementById(field.id + '-status');
    if (trainingDrafts.has(key)) {
      field.value = trainingDrafts.get(key);
      status.textContent = 'ブラウザに保存できません。再読み込みの前に回答をコピーしてください。';
      continue;
    }
    try {
      field.value = localStorage.getItem(key) ?? '';
      if (field.value) status.textContent = '保存済み';
    } catch {
      status.textContent = 'このブラウザでは回答の保存・復元を確認できません。';
    }
  }
}

function renderTraining(tasks, course, chapterIndex) {
  return `
    <section>
      <h2>言語化トレーニング</h2>
      <p>章の解説を根拠に、自分の言葉で説明してください。必要に応じてヒントの難易度を切り替え、最後に説明例とセルフチェックで振り返ります。</p>
      <p>記述回答はこのブラウザに自動保存されます。回答欄を空にすると、その回答を削除できます。</p>
      ${tasks.map((task, index) => {
        const id = 'training-' + (index + 1);
        const key = `nihongo:${course}:training:${chapterIndex + 1}:${index + 1}`;
        return `
          <section class="training-task">
            <h3>課題 ${index + 1}</h3>
            <p id="${id}-prompt">${task.prompt}</p>
            <label for="${id}">課題 ${index + 1} の回答</label>
            <textarea id="${id}" rows="4" data-training-key="${key}" aria-describedby="${id}-prompt ${id}-status"></textarea>
            <p class="training-status" id="${id}-status" role="status"></p>
            <div class="training-hints">
              <p class="training-hint-label" id="${id}-hint-label">課題 ${index + 1} のヒント</p>
              <div class="training-hint-tabs" role="tablist" aria-labelledby="${id}-hint-label">
                ${['easy', 'normal', 'hard'].map(level => `
                  <button type="button" role="tab" id="${id}-tab-${level}"
                    aria-controls="${id}-hint-${level}" aria-selected="${level === 'normal'}"
                    tabindex="${level === 'normal' ? '0' : '-1'}">${level[0].toUpperCase() + level.slice(1)}</button>
                `).join('')}
              </div>
              ${['easy', 'normal', 'hard'].map(level => `
                <div id="${id}-hint-${level}" role="tabpanel" aria-labelledby="${id}-tab-${level}"
                  data-hint-level="${level}" tabindex="0" ${level === 'normal' ? '' : 'hidden'}>
                  <ul>${task[level].map(cue => `<li>${cue}</li>`).join('')}</ul>
                </div>
              `).join('')}
            </div>
            <details>
              <summary>説明例とセルフチェック</summary>
              <p><strong>説明例</strong></p>
              <p>${task.example}</p>
              <p><strong>セルフチェック</strong></p>
              <ul class="training-checks">
                ${task.check.map(item => `<li><label><input type="checkbox"> <span>${item}</span></label></li>`).join('')}
              </ul>
            </details>
          </section>
        `;
      }).join('')}
    </section>
  `;
}
