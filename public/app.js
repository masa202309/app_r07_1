const state = {
  examId: null,
  questions: [],
  scoreBands: [],
  answers: [],
  result: null,
};

const configForm = document.getElementById('exam-config');
const generateBtn = document.getElementById('generate-btn');
const configStatus = document.getElementById('config-status');
const examSection = document.getElementById('exam-section');
const examForm = document.getElementById('exam-form');
const examStatus = document.getElementById('exam-status');
const questionsContainer = document.getElementById('questions');
const scorebandsContainer = document.getElementById('scorebands');
const summaryTags = document.getElementById('summary-tags');
const submitBtn = document.getElementById('submit-btn');
const resetBtn = document.getElementById('reset-btn');
const resultSection = document.getElementById('result-section');
const resultContainer = document.getElementById('result');
const questionTemplate = document.getElementById('question-template');

configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await generateExam();
});

resetBtn.addEventListener('click', () => {
  resetExam();
});

examForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAnswers();
});

function parseCategoriesText(value) {
  if (!value) return undefined;
  const categories = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return categories.length > 0 ? categories : undefined;
}

async function generateExam() {
  const formData = new FormData(configForm);
  const questionCountRaw = formData.get('questionCount');
  const questionCount = questionCountRaw ? Number(questionCountRaw) : undefined;
  const categoriesText = formData.get('categories');
  const categories = parseCategoriesText(categoriesText);

  if (questionCount && (questionCount < 5 || questionCount > 10)) {
    setStatus(configStatus, '問題数は5〜10の範囲で指定してください', true);
    return;
  }

  toggleLoading(generateBtn, true);
  setStatus(configStatus, '試験を生成しています…');

  try {
    const payload = {
      questionCount,
      categories,
    };

    // Remove undefined keys to avoid sending them
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    const response = await fetch('/exam/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || error.error || '試験の生成に失敗しました');
    }

    const exam = await response.json();
    state.examId = exam.examId;
    state.questions = exam.questions || [];
    state.scoreBands = exam.scoreBands || [];
    state.answers = new Array(state.questions.length).fill(undefined);
    state.result = null;

    renderScorebands(state.scoreBands);
    renderSummary(exam);
    renderQuestions();
    setStatus(configStatus, '試験を生成しました。回答に進んでください。');
    setStatus(examStatus, '未回答の設問があります。');

    examSection.classList.remove('card--hidden');
    resultSection.classList.add('card--hidden');
    window.scrollTo({ top: examSection.offsetTop - 20, behavior: 'smooth' });
  } catch (error) {
    console.error(error);
    setStatus(configStatus, error.message || '試験の生成に失敗しました', true);
  } finally {
    toggleLoading(generateBtn, false);
  }
}

function renderScorebands(bands) {
  scorebandsContainer.textContent = '';
  if (!bands || bands.length === 0) {
    return;
  }

  bands
    .slice()
    .sort((a, b) => (b.min || 0) - (a.min || 0))
    .forEach((band) => {
      const el = document.createElement('div');
      el.className = 'scoreband';

      const label = document.createElement('div');
      label.className = 'scoreband__label';
      label.textContent = band.label || '-';

      const range = document.createElement('div');
      range.className = 'scoreband__range';
      if (typeof band.min === 'number') {
        range.textContent = `${band.min}点以上`;
      }

      const desc = document.createElement('p');
      desc.className = 'scoreband__desc';
      desc.textContent = band.description || '';

      el.append(label, range, desc);
      scorebandsContainer.appendChild(el);
    });
}

function renderSummary(exam) {
  summaryTags.textContent = '';
  if (!exam) return;

  const tags = [];
  tags.push({ label: '問題数', value: `${exam.totalQuestions}` });
  if (exam.source) {
    tags.push({ label: '生成元', value: exam.source });
  }
  if (exam.generatedAt) {
    const date = new Date(exam.generatedAt);
    if (!Number.isNaN(date.valueOf())) {
      tags.push({ label: '生成日時', value: date.toLocaleString('ja-JP') });
    }
  }

  if (Array.isArray(exam.categories)) {
    exam.categories.forEach((cat) => {
      tags.push({ label: cat.category || 'カテゴリ', value: `${cat.count || 0}問` });
    });
  }

  tags.forEach((tag) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = `${tag.label}: ${tag.value}`;
    summaryTags.appendChild(el);
  });
}

function renderQuestions() {
  questionsContainer.textContent = '';

  state.questions.forEach((question, index) => {
    const node = questionTemplate.content.firstElementChild.cloneNode(true);
    const legend = node.querySelector('.question__title');
    const meta = node.querySelector('.question__meta');
    const optionsContainer = node.querySelector('.question__options');

    legend.textContent = `${index + 1}. ${question.question}`;

    const metaItems = [];
    if (question.category) {
      metaItems.push(`カテゴリ: ${question.category}`);
    }
    if (question.difficulty) {
      metaItems.push(`難易度: ${question.difficulty}`);
    }
    meta.textContent = metaItems.join(' / ');

    optionsContainer.textContent = '';

    (question.options || []).forEach((option, optionIndex) => {
      const id = `q${index}-opt${optionIndex}`;
      const label = document.createElement('label');
      label.className = 'option';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `q-${index}`;
      input.id = id;
      input.value = optionIndex;
      input.required = true;
      if (state.answers[index] === optionIndex) {
        input.checked = true;
      }

      input.addEventListener('change', () => {
        state.answers[index] = optionIndex;
        updateExamStatus();
      });

      const span = document.createElement('span');
      span.textContent = option;

      label.append(input, span);
      optionsContainer.appendChild(label);
    });

    questionsContainer.appendChild(node);
  });
}

function updateExamStatus() {
  const unanswered = state.answers.filter((answer) => typeof answer !== 'number').length;
  if (unanswered > 0) {
    setStatus(examStatus, `未回答: ${unanswered}問あります。`, true);
  } else {
    setStatus(examStatus, '全て回答済みです。採点を実行できます。');
  }
}

async function submitAnswers() {
  if (!state.examId) {
    setStatus(examStatus, '先に試験を生成してください。', true);
    return;
  }

  const unanswered = state.answers.filter((answer) => typeof answer !== 'number').length;
  if (unanswered > 0) {
    setStatus(examStatus, `未回答: ${unanswered}問あります。すべての設問に回答してください。`, true);
    return;
  }

  toggleLoading(submitBtn, true);
  setStatus(examStatus, '採点中です…');

  try {
    const response = await fetch(`/exam/${state.examId}/grade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ answers: state.answers }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || error.error || '採点に失敗しました');
    }

    const result = await response.json();
    state.result = result;
    renderResult(result);
    setStatus(examStatus, '採点が完了しました。');
    resultSection.classList.remove('card--hidden');
    window.scrollTo({ top: resultSection.offsetTop - 20, behavior: 'smooth' });
  } catch (error) {
    console.error(error);
    setStatus(examStatus, error.message || '採点に失敗しました', true);
  } finally {
    toggleLoading(submitBtn, false);
  }
}

function renderResult(result) {
  resultContainer.textContent = '';
  if (!result) return;

  const summary = document.createElement('div');
  summary.className = 'result__summary';

  const grade = document.createElement('div');
  grade.className = 'result__grade';
  grade.textContent = `評価 ${result.grade || 'N/A'}`;

  const score = document.createElement('div');
  score.className = 'result__score';
  score.textContent = `${result.score} / ${result.total} 点 (${result.percentage}% )`;

  summary.append(grade, score);

  if (result.band && result.band.description) {
    const desc = document.createElement('p');
    desc.textContent = result.band.description;
    desc.className = 'result__description';
    summary.appendChild(desc);
  }

  const grid = document.createElement('div');
  grid.className = 'result__grid';

  if (result.breakdown) {
    if (Array.isArray(result.breakdown.categories)) {
      grid.appendChild(buildBreakdownTable('カテゴリ別正答率', result.breakdown.categories, 'category'));
    }
    if (Array.isArray(result.breakdown.difficulties)) {
      grid.appendChild(buildBreakdownTable('難易度別正答率', result.breakdown.difficulties, 'difficulty'));
    }
  }

  const mistakes = (result.questionResults || []).filter((q) => !q.correct);
  if (mistakes.length > 0) {
    const mistakesBox = document.createElement('div');
    mistakesBox.className = 'breakdown';
    const title = document.createElement('h3');
    title.textContent = '復習ポイント';
    mistakesBox.appendChild(title);

    const list = document.createElement('ol');
    mistakes.forEach((item) => {
      const li = document.createElement('li');
      const question = document.createElement('p');
      question.textContent = item.question;
      question.className = 'mistake__question';

      const detail = document.createElement('p');
      detail.className = 'mistake__detail';
      detail.textContent = `正答: 選択肢 ${item.correctOptionIndex + 1} ／ あなたの回答: ${
        item.userOptionIndex !== null ? `選択肢 ${item.userOptionIndex + 1}` : '未回答'
      }`;

      const explanation = document.createElement('p');
      explanation.className = 'mistake__explanation';
      explanation.textContent = item.explanation || '';

      li.append(question, detail, explanation);
      list.appendChild(li);
    });

    mistakesBox.appendChild(list);
    grid.appendChild(mistakesBox);
  }

  resultContainer.append(summary, grid);
}

function buildBreakdownTable(title, items, keyName) {
  const box = document.createElement('div');
  box.className = 'breakdown';

  const heading = document.createElement('h3');
  heading.textContent = title;
  box.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'breakdown__table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['項目', '正答数', '出題数', '正答率'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');

  items.forEach((item) => {
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = item[keyName] || '-';

    const correctCell = document.createElement('td');
    correctCell.textContent = `${item.correct || 0}`;

    const totalCell = document.createElement('td');
    totalCell.textContent = `${item.total || 0}`;

    const accuracyCell = document.createElement('td');
    accuracyCell.textContent = `${item.accuracy || 0}%`;

    tr.append(nameCell, correctCell, totalCell, accuracyCell);
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  box.appendChild(table);
  return box;
}

function resetExam() {
  state.examId = null;
  state.questions = [];
  state.answers = [];
  state.result = null;

  examSection.classList.add('card--hidden');
  resultSection.classList.add('card--hidden');
  questionsContainer.textContent = '';
  scorebandsContainer.textContent = '';
  summaryTags.textContent = '';
  setStatus(examStatus, '');
  setStatus(configStatus, '試験設定を調整して再生成できます。');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = '処理中…';
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('status--error', Boolean(isError));
}
