const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const line = require('@line/bot-sdk');
const {
  generateExam,
  gradeExam,
  ExamStore,
  getPublicQuestions,
  SCORE_BANDS,
} = require('./services/examService');
const { requestChatCompletion } = require('./services/openaiClient');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const hasLineCredentials = Boolean(config.channelAccessToken && config.channelSecret);
const client = hasLineCredentials ? new line.Client(config) : null;
const app = express();
const jsonParser = express.json({ limit: '1mb' });
const examStore = new ExamStore();

if (!hasLineCredentials) {
  console.warn('[server] LINEチャネルの資格情報が設定されていないため、/webhook エンドポイントは無効化されます。');
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/exam/generate', jsonParser, async (req, res) => {
  const body = req.body || {};
  const questionCount = body.questionCount ? Number(body.questionCount) : undefined;
  const categories =
    Array.isArray(body.categories) && body.categories.length > 0
      ? body.categories
      : undefined;
  const userTag = typeof body.userTag === 'string' ? body.userTag : undefined;

  try {
    const exam = await generateExam({ questionCount, categories, userTag });
    const { id: examId } = examStore.createExam(exam);

    const categorySummary = exam.questions.reduce((acc, question) => {
      const next = acc.get(question.category) || { category: question.category, count: 0 };
      next.count += 1;
      acc.set(question.category, next);
      return acc;
    }, new Map());

    res.json({
      examId,
      totalQuestions: exam.questions.length,
      generatedAt: exam.generatedAt,
      source: exam.source,
      categories: Array.from(categorySummary.values()),
      scoreBands: SCORE_BANDS,
      questions: getPublicQuestions(exam),
    });
  } catch (error) {
    console.error('[examService] generateExam error:', error);
    res.status(500).json({
      error: '試験の生成に失敗しました',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/exam/:id', (req, res) => {
  const exam = examStore.getExam(req.params.id);
  if (!exam) {
    return res.status(404).json({ error: '指定された試験が見つかりません' });
  }

  res.json({
    examId: req.params.id,
    totalQuestions: exam.questions.length,
    generatedAt: exam.generatedAt,
    source: exam.source,
    questions: getPublicQuestions(exam),
  });
});

app.post('/exam/:id/grade', jsonParser, (req, res) => {
  const exam = examStore.getExam(req.params.id);
  if (!exam) {
    return res.status(404).json({ error: '指定された試験が見つかりません' });
  }

  const answers = req.body && req.body.answers;
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: 'answers は配列で指定してください' });
  }

  try {
    const result = gradeExam(exam, answers);
    res.json({
      examId: req.params.id,
      totalQuestions: result.total,
      score: result.score,
      percentage: result.percentage,
      grade: result.grade,
      band: result.band,
      breakdown: result.breakdown,
      questionResults: result.questionResults,
      generatedAt: result.generatedAt,
      source: result.source,
    });
  } catch (error) {
    console.error('[examService] gradeExam error:', error);
    res.status(400).json({
      error: '採点に失敗しました',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

if (hasLineCredentials) {
  app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
      await Promise.all(req.body.events.map(handleEvent));
      res.sendStatus(200);
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
    }
  });
} else {
  app.post('/webhook', (_req, res) => {
    res.status(503).json({
      error: 'LINE webhookは構成されていません。環境変数 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET を設定してください。',
    });
  });
}

async function handleEvent(event) {
  if (!client) {
    throw new Error('LINE client is not configured');
  }

  if (event.type !== 'message' || event.message.type !== 'text') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'テキストで質問してね！',
    });
  }

  const text = event.message.text;
  const userId = (event.source && event.source.userId) || 'anonymous';

  try {
    const answer = await requestChatCompletion({
      model: process.env.LINE_OPENAI_MODEL || process.env.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'あなたはLINE上で動作するフレンドリーなアシスタントです。簡潔で丁寧に日本語で回答し、必要に応じて箇条書きも活用してください。',
        },
        { role: 'user', content: text },
      ],
      temperature: process.env.LINE_OPENAI_TEMPERATURE || 0.5,
      maxTokens: process.env.LINE_OPENAI_MAX_TOKENS || 600,
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: answer,
    });
  } catch (error) {
    console.error('[line] OpenAI応答生成に失敗しました:', error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'すみません、うまく返答できませんでした。時間をおいて試してみてください。',
    });
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on :${port}`);
});
