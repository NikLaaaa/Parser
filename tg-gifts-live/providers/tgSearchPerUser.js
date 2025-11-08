import { Api } from 'telegram';
import { getClient } from '../tgClient.js';

const BOT_USERNAME = process.env.SOURCE_BOT || 'PriceNFTbot';
// для калькулятора поставь: SOURCE_BOT=NFTGiftCalculator
const SEARCH_TEMPLATE = process.env.SEARCH_TEMPLATE || '/search {username}';
// если у бота другой формат — поменяй в env, напр.: '🔎 Поиск {username}'

const SLEEP_MS = Number(process.env.SEARCH_WAIT_MS || 5000);

// утилиты
const toPrice = (s) => {
  const clean = String(s).replace(/[^\d.,]/g,'').replace(',', '.').replace(/\s/g,'');
  return Math.round(Number(clean));
};
const priceFromButtons = (markup) => {
  const rows = markup?.rows || [];
  for (const r of rows) {
    for (const b of (r.buttons || [])) {
      const t = b?.text || '';
      const m = t.match(/⭐\s*([\d\s.,]+)/);
      if (m) {
        const p = toPrice(m[1]);
        if (Number.isFinite(p)) return p;
      }
    }
  }
  return null;
};
const parseName = (text) => (text || '').split('\n')[0].replace(/⭐.*$/, '').trim() || 'Gift';

async function triggerSearchForUser(client, bot, username) {
  const msg = SEARCH_TEMPLATE.replace('{username}', username.replace(/^@/, ''));
  await client.invoke(new Api.messages.SendMessage({
    peer: bot,
    message: msg,
    noWebpage: true,
    randomId: BigInt(Math.floor(Math.random() * 1e15))
  }));
}

export async function scanUsers({ sellers = [], maxItems = 15, maxStars = null }) {
  const client = await getClient();
  const out = [];

  // по очереди обрабатываем каждого юзера
  for (const raw of sellers) {
    const seller = raw.trim();
    if (!seller) continue;

    // пошлём запрос боту на этого юзера
    await triggerSearchForUser(client, BOT_USERNAME, seller);
    await new Promise(r => setTimeout(r, SLEEP_MS));

    // возьмём последние сообщения
    const history = await client.invoke(new Api.messages.GetHistory({
      peer: BOT_USERNAME,
      limit: 60
    }));

    for (const m of (history.messages || [])) {
      const text = (typeof m.message === 'string' && m.message) ||
                   (m?.media?.caption && String(m.media.caption)) || '';

      // ищем кнопку «Купить за ⭐ …»
      const price = priceFromButtons(m.replyMarkup);
      if (!Number.isFinite(price)) continue;       // нет кнопки — пропускаем

      if (Number.isFinite(maxStars) && price > maxStars) continue; // дороже лимита

      out.push({
        giftName: parseName(text),
        priceStars: price,
        seller,                                   // чей поиск делали
        url: `https://t.me/${BOT_USERNAME}`       // deep-link к конкретному посту ботами не даётся публично
      });

      if (out.length >= maxItems) return out.sort((a,b)=>a.priceStars-b.priceStars).slice(0, maxItems);
    }
  }

  // итог — отсортирован топ по цене (до maxItems)
  return out.sort((a,b)=>a.priceStars-b.priceStars).slice(0, maxItems);
}
