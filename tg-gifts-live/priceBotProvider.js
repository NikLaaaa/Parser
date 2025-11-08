import 'dotenv/config';
import { getClient } from './tgClient.js';
import { Api } from 'telegram';

const BOT_USERNAME = process.env.PRICEBOT_USERNAME || 'PriceNFTbot';
const BOT_COMMAND  = process.env.PRICEBOT_COMMAND  || '/start';

// нормализация чисел "2 125", "1,223", "13 825+"
function toStarsNumber(s) {
  if (!s) return NaN;
  const clean = String(s)
    .replace(/[^\d.,]/g, '')
    .replace(',', '.')
    .replace(/\s/g, '');
  return Math.round(Number(clean));
}

// цена из текста
function extractFromText(text) {
  if (!text) return null;
  const m = text.match(/⭐\s*([\d\s.,]+)\+?/) || text.match(/([\d\s.,]+)\s*⭐\+?/);
  if (!m) return null;
  const price = toStarsNumber(m[1]);
  if (!Number.isFinite(price)) return null;
  let name = text.split('\n')[0].replace(/⭐.*$/, '').trim();
  if (!name) name = 'Gift';
  return { name, priceStars: price };
}

// цена из кнопок "Купить за ⭐ …"
function extractFromButtons(replyMarkup) {
  try {
    const rows = replyMarkup?.rows || [];
    for (const r of rows) {
      for (const btn of (r.buttons || [])) {
        const txt = btn?.text || '';
        const m = txt.match(/⭐\s*([\d\s.,]+)/);
        if (m) {
          const price = toStarsNumber(m[1]);
          if (Number.isFinite(price)) {
            return { priceStars: price, buttonText: txt };
          }
        }
      }
    }
  } catch {}
  return null;
}

export async function fetchGiftsFromPriceBot(maxWaitMs = 5000) {
  const client = await getClient();

  // запуск команды в боте (можно поменять через PRICEBOT_COMMAND)
  await client.invoke(new Api.messages.SendMessage({
    peer: BOT_USERNAME,
    message: BOT_COMMAND,
    noWebpage: true,
    randomId: BigInt(Math.floor(Math.random() * 1e15))
  }));

  // небольшой таймаут, чтобы бот ответил
  await new Promise(r => setTimeout(r, maxWaitMs));

  // история сообщений
  const history = await client.invoke(new Api.messages.GetHistory({
    peer: BOT_USERNAME,
    limit: 80
  }));

  const out = [];
  for (const m of (history.messages || [])) {
    const text =
      (typeof m.message === 'string' && m.message) ||
      (m?.media?.caption && String(m.media.caption)) || '';

    // 1) приоритет — кнопка "Купить за ⭐ ..." (значит точно на продаже)
    const btnInfo = extractFromButtons(m.replyMarkup);
    if (btnInfo) {
      let name = text.split('\n')[0].replace(/⭐.*$/, '').trim();
      if (!name) name = 'Gift';
      out.push({
        name,
        priceStars: btnInfo.priceStars,
        url: `https://t.me/${BOT_USERNAME}`
      });
      continue;
    }

    // 2) иначе — явная цена в тексте
    const parsed = extractFromText(text);
    if (parsed) {
      out.push({
        name: parsed.name,
        priceStars: parsed.priceStars,
        url: `https://t.me/${BOT_USERNAME}`
      });
    }
  }

  // уникализация (name+price)
  const uniq = [];
  const seen = new Set();
  for (const g of out) {
    const key = `${g.name}|${g.priceStars}`;
    if (!seen.has(key)) { seen.add(key); uniq.push(g); }
  }
  return uniq;
}
