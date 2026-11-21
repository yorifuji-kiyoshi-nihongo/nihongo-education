function renderTraining(tasks) {
  const hints = [
    ['Easy', 'easy'],
    ['Normal', 'normal'],
    ['Hard', 'hard']
  ];
  return `
    <section>
      <h2>言語化トレーニング</h2>
      <p>章の解説を根拠に、自分の言葉で説明してください。まずはヒントを開かずに取り組み、最後に説明例とセルフチェックで振り返ります。</p>
      ${tasks.map((task, index) => `
        <section class="training-task">
          <h3>課題 ${index + 1}</h3>
          <p>${task.prompt}</p>
          ${hints.map(([label, key]) => `
            <details><summary>ヒント ${label}</summary><p>${task[key]}</p></details>
          `).join('')}
          <details>
            <summary>説明例とセルフチェック</summary>
            <p><strong>説明例</strong></p>
            <p>${task.example}</p>
            <p><strong>セルフチェック</strong></p>
            <label><input type="checkbox"> ${task.check}</label>
          </details>
        </section>
      `).join('')}
    </section>
  `;
}
