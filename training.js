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

document.addEventListener('change', event => {
  const radio = event.target;
  if (!radio.matches('.training-hint-choice input[type="radio"]')) return;
  const hints = radio.closest('.training-hints');
  for (const panel of hints.querySelectorAll('[data-hint-level]')) {
    panel.hidden = panel.dataset.hintLevel !== radio.value;
  }
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
              <fieldset class="training-hint-choice">
                <legend>課題 ${index + 1} のヒント</legend>
                <div class="training-hint-options">
                  ${['Easy', 'Normal', 'Hard'].map(level => `
                    <label>
                      <input type="radio" name="${id}-hint" value="${level.toLowerCase()}"
                        aria-controls="${id}-hint-${level.toLowerCase()}" ${level === 'Normal' ? 'checked' : ''}>
                      ${level}
                    </label>
                  `).join('')}
                </div>
              </fieldset>
              ${['easy', 'normal', 'hard'].map(level => `
                <ul id="${id}-hint-${level}" data-hint-level="${level}" ${level === 'normal' ? '' : 'hidden'}>
                  ${task[level].map(cue => `<li>${cue}</li>`).join('')}
                </ul>
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
