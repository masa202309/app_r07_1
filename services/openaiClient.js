const axios = require('axios');

const DEFAULT_BASE_URL = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function requestChatCompletion({
  messages,
  model = process.env.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini',
  temperature = process.env.OPENAI_TEMPERATURE,
  maxTokens = process.env.OPENAI_MAX_TOKENS,
  responseFormat,
  baseURL = DEFAULT_BASE_URL,
} = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('OpenAIチャット補完には messages 配列が必要です');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません');
  }

  const payload = {
    model,
    messages,
    temperature: parseNumber(temperature, 0.2),
    max_tokens: parseNumber(maxTokens, 2000),
  };

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  const response = await axios.post(
    `${baseURL}/chat/completions`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(process.env.OPENAI_PROJECT_ID
          ? { 'OpenAI-Project': process.env.OPENAI_PROJECT_ID }
          : {}),
      },
      timeout: parseNumber(process.env.OPENAI_TIMEOUT_MS, 60000),
    }
  );

  const text = response?.data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI API response に message content が含まれていません');
  }

  return text.trim();
}

module.exports = {
  requestChatCompletion,
};
