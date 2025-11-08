import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';
import { Telegraf, Markup } from 'telegraf';
import PQueue from 'p-queue';

// ========= ENV =========
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN; // из @BotFather (обязательно)
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 4); // параллельность запросов
const USER_AGENT =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required in environment');
  process.exit(1);
}

// ========= helpers =========
const http = axios.create({
  headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
  timeout: 20000
});

// Нормализация текста/чисел звёзд: "1 100 ⭐", "1100 звёзд", "⭐1100"
function parseStars(text = '') {
  const clean = text.replace(/\s| |,/g, '');
  const m = clean.match(/(\d{1,9})/);
  return m ? Number(m[1]) : null;
}

// Проверяем страницу конкретного подарка: есть ли кнопка «купить за звёзды»
async function checkGiftBuyable(url) {
  try {
    const { data } = await http.get(url);
    const $ = cheerio.load(data);

    // SELECTOR: блок/кнопка покупки. Поддержим несколько вариантов текста.
    const btn = $('a,button')
      .filter((_, el) => {
        const t = $(el).text().toLowerCase();
        return (
          t.includes('купить за зв') ||
          t.includes('buy for') && t.includes('star') ||
          t.includes('купить') && t.includes('⭐')
        );
      })
      .first();

    return btn.length > 0;
  } catch (e) {
    return false; // если не открылась, считаем не подходит
  }
}

// Парсим выдачу peek.tg по «рынку/подаркам»
// ВАЖНО: это эвристика. Возможные маршруты peek.tg меняются; ниже 2 стратегии:
//  A) пробуем «маркет» (если есть), 
//  B) общий поиск с фильтром по цене внутри карточки.
async function scrapePeek({ maxStars, limit = 15, pageFrom = 1, pageTo = 5 }) {
  const results = [];
  const queue = new PQueue({ concurrency: MAX_CONCURRENCY });

  // вспомогательная функция: разобрать одну страницу каталога
  async function parseListPage(url) {
    const { data } = await http.get(url);
    const $ = cheerio.load(data);

    // SELECTOR: карточки подарков в выдаче (обнови при необходимости)
    const cards = $('[data-card="gift"], .gift-card, .market-card, .card'); // варианты
    if (cards.length === 0) {
      // fallback: искать по фрагментам
      return $('[href*="/gift/"], a:contains("gift")').closest('div');
    }
    return cards;
  }

  // разбор карточки → {username, priceStars, giftUrl}
  function extractCard($, card) {
    const el = $(card);

    // SELECTOR: ссылка на подарок
    const giftUrl =
      el.find('a[href*="/gift/"]').attr('href') ||
      el.find('a:contains("gift")').attr('href') ||
      el.find('a').attr('href');

    // нормализуем ссылку
    const fullUrl = giftUrl?.startsWith('http') ? giftUrl : giftUrl ? `https://peek.tg${giftUrl}` : null;

    // SELECTOR: цена в звёздах
    const priceText =
      el.find('.price, .gift-price, .market-price, .price-stars').text() ||
      el.text();
    const priceStars = parseStars(priceText);

    // SELECTOR: имя/юзернейм продавца
    const nameText =
      el.find('.username, .seller, .name, .title').text() ||
      el.find('a[href^="/u/"]').text() ||
      '';

    // Юзернейм из ссылки вида /u/username
    const unameHref = el.find('a[href^="/u/"]').attr('href');
    const username = unameHref ? unameHref.split('/').pop() : nameText.trim();

    return { username, priceStars, giftUrl: fullUrl };
  }

  // Стратегия A: «маркет подарков» (если у них есть страница вроде /market/gifts)
  const marketUrls = [
    `https://peek.tg/market/gifts?page=`,        // гипотетический
    `https://peek.tg/gifts?page=`,               // гипотетический
    `https://peek.tg/search?type=gifts&page=`    // общий поиск по типу
  ];

  // Стратегия B: общий поиск "gift" (на всякий случай)
  const fallbackUrls = [
    `https://peek.tg/search?q=gift&page=`,
    `https://peek.tg/search?q=%D0%BF%D0%BE%D0%B4%D0%B0%D1%80%D0%BE%D0%BA&page=`
  ];

  async function trySet(urlBase) {
    for (let page = pageFrom; page <= pageTo && results.length < limit; page++) {
      const url = `${urlBase}${page}`;
      let cards;
      try {
        cards = await parseListPage(url);
      } catch {
        continue;
      }
      const $ = cheerio.load((await http.get(url)).data);
      $(cards).each((_, c) => {
        if (results.length >= limit) return;
        const item = extractCard($, c);
        if (!item.giftUrl || !item.priceStars) return;
        if (item.priceStars <= maxStars) {
          results.push(item);
        }
      });
    }
  }

  // Пытаемся по стратегиям
  for (const base of marketUrls) {
    await trySet(base);
    if (results.length >= limit) break;
  }
  if (results.length < limit) {
    for (const base of fallbackUrls) {
      await trySet(base);
      if (results.length >= limit) break;
    }
  }

  // Доп.фильтр — проверка страницы подарка на наличие «купить за звёзды»
  const checked = [];
  await queue.addAll(
    results.map((r) => async () => {
      const ok = await checkGiftBuyable(r.giftUrl);
      if (ok) checked.push(r);
    })
  );

  // максимум 15 (или limit)
  return checked.slice(0, limit);
}

// ========= Telegram Bot =========
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) =>
  ctx.reply(
    'Привет! Я найду подарки в продаже «за звёзды».\n\n' +
      'Команды:\n' +
      '• /search — поиск по лимиту (например, 1100)\n' +
      '• /help — помощь',
    Markup.keyboard([['/search']]).resize()
  )
);

bot.help((ctx) =>
  ctx.reply('Напиши /search и затем введи число — максимальную цену в звёздах (например, 1100).')
);

// Состояние «жду число»
const WAITING = new Set();

bot.command('search', async (ctx) => {
  WAITING.add(ctx.chat.id);
  return ctx.reply('Введи максимальную цену в звёздах (например, 1100).');
});

bot.on('text', async (ctx) => {
  if (!WAITING.has(ctx.chat.id)) return;
  const raw = (ctx.message.text || '').trim();
  const n = parseStars(raw);
  if (!n || n <= 0) {
    return ctx.reply('Нужно число, например: 1100. Попробуй ещё раз.');
  }
  WAITING.delete(ctx.chat.id);

  const maxStars = n;
  const limit = 15;
  await ctx.reply(`Ищу подарки «за звёзды» до ${maxStars}… Это может занять 5–20 секунд.`);
  try {
    const items = await scrapePeek({ maxStars, limit, pageFrom: 1, pageTo: 5 });
    if (!items.length) {
      return ctx.reply('Пока ничего не нашёл под этот лимит. Попробуй увеличить или повторить позже.');
    }

    // Отправим одним сообщением
    const lines = items.map((it, i) => {
      const u = it.username ? `@${it.username}` : '—';
      const price = it.priceStars ? `${it.priceStars}⭐` : '—';
      const link = it.giftUrl;
      return `${i + 1}. ${u}\n   Цена: ${price}\n   Подарок: ${link}`;
    });

    await ctx.reply(lines.join('\n\n'), {
      disable_web_page_preview: true
    });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при поиске. Разработчик уже оповещён.');
  }
});

// ========= HTTP API / UI =========
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Мини-форма для ручной проверки
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8">
<title>Gift Parser</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:24px}
input,button{font:inherit;padding:10px;border:1px solid #cbd5e1;border-radius:8px}
button{background:#4f8cff;color:#fff;border:0}
pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e5e7eb;padding:12px;border-radius:8px}
</style>
<h1>Gift Parser — поиск подарков за звёзды</h1>
<form onsubmit="go(event)">
  <label>Максимум звёзд:</label>
  <input id="max" value="1100" />
  <label>Количество (до 15):</label>
  <input id="limit" value="15" />
  <button>Поиск</button>
</form>
<pre id="out"></pre>
<script>
async function go(e){
  e.preventDefault();
  const max = document.querySelector('#max').value;
  const limit = document.querySelector('#limit').value;
  const r = await fetch('/api/search?maxStars='+encodeURIComponent(max)+'&limit='+encodeURIComponent(limit));
  const j = await r.json();
  out.textContent = JSON.stringify(j, null, 2);
}
</script>`);
});

// JSON API
app.get('/api/search', async (req, res) => {
  try {
    const maxStars = Number(req.query.maxStars || 1100);
    const limit = Math.min(15, Math.max(1, Number(req.query.limit || 15)));
    const data = await scrapePeek({ maxStars, limit });
    res.json({ ok: true, count: data.length, items: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ========= launch =========
app.listen(PORT, () => console.log('HTTP listening on :' + PORT));
bot.launch().then(() => console.log('Telegram bot started'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
