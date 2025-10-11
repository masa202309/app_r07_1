const { generateText } = require('ai');
const { openai } = require('@ai-sdk/openai');
const { anthropic } = require('@ai-sdk/anthropic');
const { google } = require('@ai-sdk/google');

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getAIProvider(providerName) {
  const provider = providerName || process.env.AI_PROVIDER || 'openai';

  switch (provider.toLowerCase()) {
    case 'openai':
      return {
        provider: openai,
        defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        apiKey: process.env.OPENAI_API_KEY,
      };
    case 'anthropic':
    case 'claude':
      return {
        provider: anthropic,
        defaultModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
        apiKey: process.env.ANTHROPIC_API_KEY,
      };
    case 'google':
    case 'gemini':
      return {
        provider: google,
        defaultModel: process.env.GOOGLE_MODEL || 'gemini-2.0-flash-exp',
        apiKey: process.env.GOOGLE_API_KEY,
      };
    default:
      throw new Error(`未対応のAIプロバイダーです: ${provider}`);
  }
}

async function requestChatCompletion({
  messages,
  model,
  temperature = process.env.AI_TEMPERATURE,
  maxTokens = process.env.AI_MAX_TOKENS,
  responseFormat,
  providerName,
} = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('チャット補完にはmessages配列が必要です');
  }

  const { provider, defaultModel, apiKey } = getAIProvider(providerName);

  if (!apiKey) {
    throw new Error(`APIキーが設定されていません。環境変数を確認してください。`);
  }

  const resolvedModel = model || defaultModel;

  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');

  const options = {
    model: provider(resolvedModel, { apiKey }),
    messages: userMessages,
    temperature: parseNumber(temperature, 0.2),
    maxTokens: parseNumber(maxTokens, 2000),
  };

  if (systemMessage) {
    options.system = systemMessage.content;
  }

  if (responseFormat?.type === 'json_object') {
    options.experimental_output = 'json-object';
  }

  const { text } = await generateText(options);

  if (!text) {
    throw new Error('AI APIのレスポンスにテキストが含まれていません');
  }

  return text.trim();
}

module.exports = {
  requestChatCompletion,
  getAIProvider,
};
