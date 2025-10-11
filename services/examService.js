const { requestChatCompletion } = require('./aiClient');
const crypto = require('crypto');

const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 10;
const DEFAULT_QUESTION_COUNT = MAX_QUESTION_COUNT;
const OPTIONS_PER_QUESTION = 3;

const DEFAULT_CATEGORIES = [
  'プロンプト設計とLLM活用',
  'データ・セキュリティとコンプライアンス',
  'ワークフロー統合と自動化',
  'ビジネス活用とROI',
  'リスクマネジメントと品質管理',
];

const SCORE_BANDS = [
  {
    label: 'S',
    min: 9,
    description: '卓越レベル：生成AI戦略をリードし、複雑な案件を自走できる状態。',
  },
  {
    label: 'A',
    min: 8,
    description: '実務リードレベル：主要プロセスを高い品質で運用できる状態。',
  },
  {
    label: 'B',
    min: 6,
    description: '実務遂行レベル：基本スキルを備え、標準プロセスを担える状態。',
  },
  {
    label: 'C',
    min: 5,
    description: '入門レベル：補助があれば業務に参加できるが、トレーニングが必要。',
  },
  {
    label: 'D',
    min: 0,
    description: '要育成レベル：基礎理解の強化が必須。',
  },
];

function clampQuestionCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUESTION_COUNT;
  }
  return Math.min(MAX_QUESTION_COUNT, Math.max(MIN_QUESTION_COUNT, Math.round(parsed)));
}

class ExamStore {
  constructor({ ttlMs = 1000 * 60 * 60 } = {}) {
    this.ttlMs = ttlMs;
    this.store = new Map();
  }

  createExam(exam) {
    const id = crypto.randomUUID();
    const record = {
      ...exam,
      createdAt: Date.now(),
    };
    this.store.set(id, record);
    this.cleanup();
    return { id, exam: record };
  }

  getExam(id) {
    const record = this.store.get(id);
    if (!record) {
      return null;
    }
    if (Date.now() - record.createdAt > this.ttlMs) {
      this.store.delete(id);
      return null;
    }
    return record;
  }

  deleteExam(id) {
    this.store.delete(id);
  }

  cleanup() {
    const now = Date.now();
    for (const [id, record] of this.store.entries()) {
      if (now - record.createdAt > this.ttlMs) {
        this.store.delete(id);
      }
    }
  }
}

function buildPrompt({
  questionCount = DEFAULT_QUESTION_COUNT,
  categories = DEFAULT_CATEGORIES,
  optionsPerQuestion = OPTIONS_PER_QUESTION,
  difficultyProfile = {
    初級: 3,
    中級: 5,
    上級: 2,
  },
}) {
  const lines = [];
  lines.push('あなたは企業の採用試験を設計する主任です。');
  lines.push('生成AI業務活用スキルを評価する三択問題を日本語で作成してください。');
  lines.push('以下の条件に厳密に従ってください。');
  lines.push(`- 問題数: ${questionCount}`);
  lines.push(`- 選択肢数: ${optionsPerQuestion}`);
  lines.push('- 出力形式は JSON のみで、以下のスキーマに従うこと');
  lines.push('  { "questions": [ { "id": <number>, "category": <string>, "difficulty": "初級|中級|上級", "question": <string>, "options": [<string>, <string>, <string>], "answer": <number>, "explanation": <string> } ] }');
  lines.push('- answer は 0 から始まるインデックスで正答を示すこと');
  lines.push('- explanation には正答の理由と業務観点でのポイントを簡潔に記述すること');
  lines.push('- カテゴリ配分は次の通り必ず網羅すること:');
  categories.forEach((category, index) => {
    lines.push(`  ${index + 1}. ${category}`);
  });
  lines.push('- 難易度配分の目安: 初級30%, 中級50%, 上級20%（概ねで可）');
  lines.push('- 出力は Markdown や余計な文章を含めず、純粋な JSON 文字列のみとすること');
  lines.push('- 各問題はユニークで、実務シナリオに基づくこと');

  return lines.join('\n');
}

async function requestOpenAIExam(prompt) {
  const systemMessage =
    'あなたは企業の試験問題を生成する専門家です。必ず純粋なJSONのみを出力し、説明文やコードフェンスは含めないでください。';

  const text = await requestChatCompletion({
    model: process.env.EXAM_AI_MODEL || process.env.DEFAULT_AI_MODEL,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: prompt },
    ],
    temperature: process.env.EXAM_AI_TEMPERATURE || 0.2,
    maxTokens: process.env.EXAM_AI_MAX_TOKENS || 2000,
    responseFormat: { type: 'json_object' },
    providerName: process.env.EXAM_AI_PROVIDER,
  });

  return text;
}

function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid text for JSON extraction');
  }

  const codeFenceMatch = text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/i);
  const jsonString = codeFenceMatch ? codeFenceMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error('Failed to parse JSON from model response');
  }
}

function normalizeQuestions(raw, { questionCount = DEFAULT_QUESTION_COUNT } = {}) {
  if (!raw || !Array.isArray(raw.questions)) {
    throw new Error('Invalid exam payload: questions 配列が見つかりません');
  }

  const normalized = raw.questions.map((item, index) => {
    const options = item.options || item.choices;
    const answer =
      typeof item.answer === 'number'
        ? item.answer
        : typeof item.answerIndex === 'number'
        ? item.answerIndex
        : typeof item.correct === 'number'
        ? item.correct
        : typeof item.correctOption === 'number'
        ? item.correctOption
        : null;

    if (!Array.isArray(options) || options.length !== OPTIONS_PER_QUESTION) {
      throw new Error(`Question ${index + 1} の選択肢数が ${OPTIONS_PER_QUESTION} に一致しません`);
    }

    if (answer === null || answer < 0 || answer >= options.length) {
      throw new Error(`Question ${index + 1} の answer が不正です`);
    }

    return {
      id: item.id || index + 1,
      category: item.category || '未分類',
      difficulty: item.difficulty || '中級',
      question: item.question || item.prompt || '',
      options,
      answer,
      explanation: item.explanation || item.reason || '',
    };
  });

  if (normalized.length < questionCount) {
    throw new Error(`期待した問題数 ${questionCount} 件に満たない結果が返されました`);
  }

  return normalized.slice(0, questionCount);
}

function validateQuestions(questions, expectedCount = DEFAULT_QUESTION_COUNT) {
  if (!Array.isArray(questions)) {
    throw new Error('questions は配列である必要があります');
  }

  if (questions.length !== expectedCount) {
    throw new Error(`問題数が要件 (${expectedCount}) と一致しません`);
  }

  questions.forEach((q, index) => {
    if (!q.question || !q.options) {
      throw new Error(`Question ${index + 1} が不完全です`);
    }
  });
}

const FALLBACK_QUESTIONS = [
  {
    category: 'プロンプト設計とLLM活用',
    difficulty: '初級',
    question: 'LLMの回答が冗長で長すぎるとき、まず行うべきプロンプト改善はどれですか？',
    options: [
      '出力温度を上げて多様性を高める',
      '回答文字数の上限や形式を明示する',
      'モデルの学習データを入れ替える',
    ],
    answer: 1,
    explanation: 'プロンプトで文字数や形式を指定することで、冗長さを制御できる。',
  },
  {
    category: 'プロンプト設計とLLM活用',
    difficulty: '中級',
    question: '同じ操作手順を説明させると毎回文体が変わる場合の有効な対策は？',
    options: [
      '出力を英語に固定する',
      'systemメッセージで役割とトーンを明示する',
      'モデル温度を最大まで上げる',
    ],
    answer: 1,
    explanation: 'systemメッセージでロールやトーンを固定すると出力が安定する。',
  },
  {
    category: 'プロンプト設計とLLM活用',
    difficulty: '中級',
    question: '複雑な業務プロセスを正確に説明させたいときの最適な指示は？',
    options: [
      'プロンプトを極力短くする',
      '推論温度を高めて創造性を上げる',
      '手順を段階ごとに分けて役割を定義する',
    ],
    answer: 2,
    explanation: 'ステップと役割を明示するとプロセスが抜け漏れなく整理される。',
  },
  {
    category: 'プロンプト設計とLLM活用',
    difficulty: '上級',
    question: '社内ブランドトーンを守った回答を得たい場合に有効な方法は？',
    options: [
      '回答時間制限を短くする',
      'temperatureを0に設定する',
      'スタイルガイドや良例をプロンプトに添付する',
    ],
    answer: 2,
    explanation: 'スタイルガイドや例示を渡すとブランドトーンを再現しやすい。',
  },
  {
    category: 'プロンプト設計とLLM活用',
    difficulty: '上級',
    question: 'JSON形式で安定した構造化出力を得る際に最初に行うべきことは？',
    options: [
      'モデルサイズを小さくする',
      '回答言語を英語に切り替える',
      '求めるJSONスキーマと必須キーを明示する',
    ],
    answer: 2,
    explanation: '期待するJSON構造をプロンプトで指定すると崩れにくくなる。',
  },
  {
    category: 'プロンプト設計とLLM活用',
    difficulty: '初級',
    question: '長文の参考資料を入力する際に出力品質を高める工夫は？',
    options: [
      '資料全文をsystemメッセージに入れる',
      '資料と指示を明確に分けて渡す',
      '資料を無視して短い指示だけ渡す',
    ],
    answer: 1,
    explanation: '指示と資料を区別するとモデルが文脈を理解しやすい。',
  },
  {
    category: 'データ・セキュリティとコンプライアンス',
    difficulty: '初級',
    question: 'クラウドLLMへ機密顧客データを送る前に最優先で行うべきことは？',
    options: [
      '個人情報や機微情報を匿名化する',
      '回答速度を測定する',
      'モデルの温度を調整する',
    ],
    answer: 0,
    explanation: '送信前の匿名化が機密漏えいリスクを下げる。',
  },
  {
    category: 'データ・セキュリティとコンプライアンス',
    difficulty: '中級',
    question: '外部LLMベンダーを採用する際に遵守すべき手続きは？',
    options: [
      'APIキーを共有ドライブに保存する',
      '社内の承認プロセスを省略する',
      'DPAなどの契約でデータ保護義務を確認する',
    ],
    answer: 2,
    explanation: 'データ処理契約でベンダーの責任と保護義務を定める必要がある。',
  },
  {
    category: 'データ・セキュリティとコンプライアンス',
    difficulty: '中級',
    question: '複数部署が共通LLMアプリを使うときに最も重要な制御は？',
    options: [
      '回答内容を全ユーザーにメール共有する',
      'テナントごとにアクセス権限を分離する',
      'モデルを毎日再学習する',
    ],
    answer: 1,
    explanation: '部署ごとのアクセス境界を守ることで情報漏えいを防げる。',
  },
  {
    category: 'データ・セキュリティとコンプライアンス',
    difficulty: '上級',
    question: '監査対応のために最低限保持すべきログはどれですか？',
    options: [
      '出力文字数のみ',
      '推論に使われた内部重みの値',
      '入力・出力と操作ユーザーの識別情報',
    ],
    answer: 2,
    explanation: '誰が何を入力しどんな出力が返ったかを記録する必要がある。',
  },
  {
    category: 'データ・セキュリティとコンプライアンス',
    difficulty: '初級',
    question: '社内でLLMを利用する際のAPIキー管理として正しいのは？',
    options: [
      'キーをコードに直書きする',
      'シークレットマネージャに保管しローテーションする',
      'チャットで共有する',
    ],
    answer: 1,
    explanation: '秘密情報は専用の管理サービスで保管し定期更新する。',
  },
  {
    category: 'データ・セキュリティとコンプライアンス',
    difficulty: '中級',
    question: '個人データを扱うチャットボットに必要な対応は？',
    options: [
      '利用目的を明示し最小権限に制御する',
      '出力品質を優先し保存期間を無制限にする',
      'モデル回答をそのまま社外に転用する',
    ],
    answer: 0,
    explanation: '目的限定と最小権限がプライバシー保護の基本である。',
  },
  {
    category: 'ワークフロー統合と自動化',
    difficulty: '中級',
    question: 'CRMデータを要約してSlack通知する自動化を設計する際の最初の確認事項は？',
    options: [
      '使用するAPIトークンの権限範囲',
      'Slackメッセージの絵文字',
      '要約文の語尾',
    ],
    answer: 0,
    explanation: '適切な権限のAPIトークンを用意することが前提となる。',
  },
  {
    category: 'ワークフロー統合と自動化',
    difficulty: '初級',
    question: '自動化が失敗した際の基本的な設計として適切なのは？',
    options: [
      '失敗ログを削除する',
      '担当者が後で気づくまで放置する',
      'リトライとアラート通知を組み込む',
    ],
    answer: 2,
    explanation: '再実行と通知を仕組み化して業務影響を抑える。',
  },
  {
    category: 'ワークフロー統合と自動化',
    difficulty: '中級',
    question: '外部APIとLLMを連携したマイクロサービス設計で推奨されるのは？',
    options: [
      '疎結合なインターフェースを維持する',
      'LLMに直接データベース資格情報を渡す',
      '全処理を単一の巨大関数にまとめる',
    ],
    answer: 0,
    explanation: '疎結合な設計が変更や障害に強い構造を生む。',
  },
  {
    category: 'ワークフロー統合と自動化',
    difficulty: '上級',
    question: '大量ドキュメントを夜間バッチで要約する際のボトルネック対策は？',
    options: [
      'キューとワーカーで並列度とレート制限を制御する',
      'ユーザー操作があるまで処理を開始しない',
      '温度を上げて推論精度を抑える',
    ],
    answer: 0,
    explanation: 'キュー制御でスケールとAPI制約の両立が可能になる。',
  },
  {
    category: 'ワークフロー統合と自動化',
    difficulty: '中級',
    question: '自動化パイプラインの健全性を監視する基礎指標は？',
    options: [
      '生成テキストの文字色',
      '処理件数・失敗率・平均処理時間',
      '開発チームの在席時間',
    ],
    answer: 1,
    explanation: 'スループットと失敗率を監視することで異常に気づける。',
  },
  {
    category: 'ワークフロー統合と自動化',
    difficulty: '初級',
    question: '生成AIワークフローを本番に統合する前に確認すべき点は？',
    options: [
      'エラー時のフォールバックと手動対応手順',
      '本番データをそのままテストに使う',
      '利用者に管理者権限を付与する',
    ],
    answer: 0,
    explanation: 'フェイルセーフと手動プロセスがないと業務停止リスクが高まる。',
  },
  {
    category: 'ビジネス活用とROI',
    difficulty: '上級',
    question: '月200時間の対応をAIで50%削減し、ツール費20万円・教育10万円の場合のROI算出式は？',
    options: [
      'コスト ÷ 削減時間',
      '(削減時間×時給 - コスト) ÷ コスト',
      '削減時間 ÷ コスト',
    ],
    answer: 1,
    explanation: 'ROIは純利益を投資額で割る指標であり、削減価値からコストを差し引いて計算する。',
  },
  {
    category: 'ビジネス活用とROI',
    difficulty: '中級',
    question: '生成AI導入の効果測定で最初に定義すべき指標は？',
    options: [
      'モデルバージョン名',
      'KPIとなる業務成果指標',
      '開発メンバーの満足度だけ',
    ],
    answer: 1,
    explanation: '業務成果のKPIを定義してから効果測定を行う。',
  },
  {
    category: 'ビジネス活用とROI',
    difficulty: '初級',
    question: 'PoC評価で必ず押さえるべき観点はどれですか？',
    options: [
      'ビジネス価値・実現可能性・リスクのバランス',
      'プロンプト文の文字数',
      'モデルの話し方の好み',
    ],
    answer: 0,
    explanation: '投資判断には価値・実現性・リスクの総合評価が要る。',
  },
  {
    category: 'ビジネス活用とROI',
    difficulty: '中級',
    question: '生成AI導入で定性的な効果を示す適切な指標は？',
    options: [
      'GPU利用率の変動',
      '従業員満足度や顧客NPSの改善',
      '推論モデルの隠しパラメータ',
    ],
    answer: 1,
    explanation: '満足度やNPSなどの体験指標も重要な効果測定軸となる。',
  },
  {
    category: 'ビジネス活用とROI',
    difficulty: '中級',
    question: '生成AI支援ツールを社内展開する際の現実的な戦略は？',
    options: [
      '全社一斉導入で後から整備する',
      'コスト負担を曖昧にする',
      'パイロット成功事例を可視化し段階的に横展開する',
    ],
    answer: 2,
    explanation: '段階的展開によりリスクを抑えながら浸透させられる。',
  },
  {
    category: 'ビジネス活用とROI',
    difficulty: '初級',
    question: 'ROIが目標に届かない場合の適切な対応は？',
    options: [
      '前提を再確認し業務範囲やプロセスを見直す',
      '導入を即時中止し成果を隠す',
      '数値を調整して目標達成に見せる',
    ],
    answer: 0,
    explanation: '原因分析とプロセス改善で追加価値を探るべきである。',
  },
  {
    category: 'リスクマネジメントと品質管理',
    difficulty: '中級',
    question: '生成AIがコンプライアンス違反の回答を出した際の一次対応として適切なのは？',
    options: [
      'ユーザー判断に任せて継続利用させる',
      '該当経路を遮断し原因調査を開始する',
      '回答をそのまま公開資料に使う',
    ],
    answer: 1,
    explanation: '影響を止めた上で原因と再発防止策を検討する必要がある。',
  },
  {
    category: 'リスクマネジメントと品質管理',
    difficulty: '初級',
    question: 'ハルシネーションを検知する基本的な方法は？',
    options: [
      '回答文字数が長いものを信頼する',
      'モデルを全面的に信用して検証を省く',
      '根拠となるデータソースと照合する',
    ],
    answer: 2,
    explanation: '外部データやルールと突き合わせて検証するのが基本である。',
  },
  {
    category: 'リスクマネジメントと品質管理',
    difficulty: '中級',
    question: '品質を継続的に監視する体制で重要な活動は？',
    options: [
      'レビュー結果を記録せず口頭共有のみとする',
      '問題が起きるまで改善を行わない',
      '人と機械のレビュー指標を定期的に収集・分析する',
    ],
    answer: 2,
    explanation: 'レビュー指標を蓄積し改善ループを回すことが品質維持につながる。',
  },
  {
    category: 'リスクマネジメントと品質管理',
    difficulty: '上級',
    question: '法規制が更新された場合に優先すべきアクションは？',
    options: [
      '利用者任せで自己判断に委ねる',
      '旧ポリシーのまま運用を続ける',
      '影響範囲を洗い出しポリシーやプロンプトを更新する',
    ],
    answer: 2,
    explanation: '規制変更に合わせて管理側でポリシーと設定を更新する必要がある。',
  },
  {
    category: 'リスクマネジメントと品質管理',
    difficulty: '中級',
    question: 'AIサービスの品質保証でテストケース設計に盛り込むべき視点は？',
    options: [
      'モデルの好きな色',
      '利用者の趣味',
      '正常系・異常系・境界条件のカバレッジ',
    ],
    answer: 2,
    explanation: '多様なケースを網羅することで品質リスクを抑えられる。',
  },
  {
    category: 'リスクマネジメントと品質管理',
    difficulty: '初級',
    question: '利用ログを分析してリスクを早期発見する際に着目すべき指標は？',
    options: [
      'ユーザーの好きな音楽',
      'モデル内部の重み値',
      '急増するエラー率や異常な利用パターン',
    ],
    answer: 2,
    explanation: '異常パターンの検知がリスク管理の早期対応につながる。',
  },
];

function buildFallbackExam(questionCount = DEFAULT_QUESTION_COUNT) {
  const resolvedQuestionCount = clampQuestionCount(questionCount);

  if (FALLBACK_QUESTIONS.length < resolvedQuestionCount) {
    throw new Error('Fallback 質問データが不足しています');
  }

  return {
    source: 'fallback',
    generatedAt: new Date().toISOString(),
    questions: FALLBACK_QUESTIONS.slice(0, resolvedQuestionCount).map((q, index) => ({
      ...q,
      id: index + 1,
    })),
  };
}

async function generateExam({
  categories = DEFAULT_CATEGORIES,
  questionCount,
} = {}) {
  const resolvedQuestionCount = clampQuestionCount(
    questionCount === undefined ? DEFAULT_QUESTION_COUNT : questionCount
  );

  const prompt = buildPrompt({ questionCount: resolvedQuestionCount, categories });

  try {
    const rawAnswer = await requestOpenAIExam(prompt);
    const parsed = extractJsonFromText(rawAnswer);
    const normalized = normalizeQuestions(parsed, { questionCount: resolvedQuestionCount });
    validateQuestions(normalized, resolvedQuestionCount);

    return {
      source: 'openai',
      generatedAt: new Date().toISOString(),
      prompt,
      questions: normalized,
    };
  } catch (error) {
    console.warn('[examService] OpenAI生成に失敗したためフォールバックに切り替えます:', error.message);
    return buildFallbackExam(resolvedQuestionCount);
  }
}

function gradeExam(exam, answers, { bands = SCORE_BANDS } = {}) {
  if (!exam || !Array.isArray(exam.questions)) {
    throw new Error('採点対象の試験データが無効です');
  }

  if (!Array.isArray(answers) || answers.length !== exam.questions.length) {
    throw new Error('回答数が問題数と一致していません');
  }

  const questionResults = exam.questions.map((question, index) => {
    const userAnswer = Number(answers[index]);
    const correct = userAnswer === question.answer;

    return {
      id: question.id,
      question: question.question,
      category: question.category,
      difficulty: question.difficulty,
      correct,
      correctOptionIndex: question.answer,
      userOptionIndex: Number.isNaN(userAnswer) ? null : userAnswer,
      explanation: question.explanation,
    };
  });

  const total = exam.questions.length;
  const score = questionResults.filter((item) => item.correct).length;
  const percentage = total === 0 ? 0 : Math.round((score / total) * 1000) / 10;

  const band = bands
    .slice()
    .sort((a, b) => b.min - a.min)
    .find((item) => score >= item.min);

  const categoryAggregate = new Map();
  const difficultyAggregate = new Map();

  questionResults.forEach((result) => {
    const cat = categoryAggregate.get(result.category) || { category: result.category, total: 0, correct: 0 };
    cat.total += 1;
    if (result.correct) {
      cat.correct += 1;
    }
    categoryAggregate.set(result.category, cat);

    const diff = difficultyAggregate.get(result.difficulty) || { difficulty: result.difficulty, total: 0, correct: 0 };
    diff.total += 1;
    if (result.correct) {
      diff.correct += 1;
    }
    difficultyAggregate.set(result.difficulty, diff);
  });

  const breakdown = {
    categories: Array.from(categoryAggregate.values()).map((item) => ({
      ...item,
      accuracy: item.total === 0 ? 0 : Math.round((item.correct / item.total) * 1000) / 10,
    })),
    difficulties: Array.from(difficultyAggregate.values()).map((item) => ({
      ...item,
      accuracy: item.total === 0 ? 0 : Math.round((item.correct / item.total) * 1000) / 10,
    })),
  };

  return {
    total,
    score,
    percentage,
    grade: band ? band.label : 'N/A',
    band: band || null,
    breakdown,
    questionResults,
    generatedAt: exam.generatedAt,
    source: exam.source,
  };
}

function getPublicQuestions(exam) {
  return exam.questions.map((question) => ({
    id: question.id,
    category: question.category,
    difficulty: question.difficulty,
    question: question.question,
    options: question.options,
  }));
}

module.exports = {
  generateExam,
  gradeExam,
  ExamStore,
  SCORE_BANDS,
  DEFAULT_CATEGORIES,
  DEFAULT_QUESTION_COUNT,
  MIN_QUESTION_COUNT,
  MAX_QUESTION_COUNT,
  getPublicQuestions,
};
