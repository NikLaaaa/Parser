import 'dotenv/config';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import PQueue from 'p-queue';
import puppeteer from 'puppeteer';

/** ===== ENV ===== */
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN; // токен бота из @BotFather
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required in Environment');
  process.exit(1);
}
const HEADLESS = process.env.HEADLESS !== 'false'; // true по умолчанию
const PAGE_TIMEOUT = Number(process.env.PAGE_TIMEOUT || 45000);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 2);

/** ===== UTILS ===== */
function parseStars(text = '') {
  const clean = String(text).replace(/\s|,| /g, '');
  const m = clean.match(/(\d{1,9})/);
  return m ? Number(m[1]) : null;
}

async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ]
  });
  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
    await page.setDefaultTimeout(PAGE_TIMEOUT);
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36'
    );
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function autoScroll(page, maxSteps = 12) {
  for (let i = 0; i < maxSteps; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(800);
  }
}

/** Проверяем страницу подарка: есть ли «купить за звёзды» */
async function checkGiftBuyable(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const hasBuy = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a,button'));
      return els.some(el => {
        const t = (el.textContent || '').toLowerCase();
        return (
          t.includes('купить за зв') ||
          (t.includes('buy for') && t.includes('star')) ||
          (t.includes('купить') && t.includes('⭐'))
        );
      });
    });
    return hasBuy;
  } catch {
    return false;
  }
}

/** Основной скрейпер peek.tg: собираем карточки и фильтруем по звёздам */
async function scrapePeek({ maxStars, limit = 15 }) {
  return await withBrowser(async (page) => {
    // 1) общий поиск/лента (если у peek.tg изменится маршрут — поправь URL)
    const url = 'https://peek.tg/search';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await autoScroll(page, 10);

    // 2) собрать сырые карточки из DOM
    const rawItems = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll(
          '[data-card="gift"], .gift-card, .market-card, .card, [class*="card"]'
        )
      );

      function firstAttr(el, sel, attr = 'href') {
        const a = el.querySelector(sel);
        return a ? a.getAttribute(attr) : null;
      }

      return cards.map(el => {
        const text = el.textContent || '';
        const priceBlock =
          el.querySelector('.price, .gift-price, .market-price, .price-stars') || el;
        const priceText = priceBlock.textContent || '';

        const unameHref = firstAttr(el, 'a[href^="/u/"]');
        const username = unameHref ? unameHref.split('/').pop() : '';

        let giftHref =
          firstAttr(el, 'a[href*="/gift/"]') ||
          firstAttr(el, 'a[href*="gift"]') ||
          firstAttr(el, 'a');

        if (!giftHref) return null;

        if (!giftHref.startsWith('http')) {
          if (giftHref.startsWith('/')) giftHref = `https://peek.tg${giftHref}`;
          else giftHref = `https://peek.tg/${giftHref}`;
        }

        return {
          username: username || '',
          priceText,
          link: giftHref,
          text
        };
      }).filter(Boolean);
    });

    // 3) фильтр по цене в звёздах
    const filtered = rawItems
      .map(it => ({ ...it, priceStars: parseStars(it.priceText) }))
      .filter(it => it.priceStars && it.priceStars <= maxStars);

    // 4) доп-проверка «есть кнопка купить за звёзды»
    const out = [];
    const queue = new PQueue({ concurrency: MAX_CONCURRENCY });
    await queue.addAll(
      filtered.map((it) => async () => {
        if (out.length >= limit) return;
        const ok = await checkGiftBuyable(page, it.link);
        if (ok) {
          out.push({
            username: it.username || '—',
            priceStars: it.priceStars || null,
            giftUrl: it.link
          });
        }
      })
    );

    return out.slice(0, limit);
  });
}

/** ===== Telegram Bot ===== */
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

bot.help((ctx) => ctx.reply('Напиши /search и затем введи число — максимум звёзд (например, 1100).'));

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
  await ctx.reply(`Ищу подарки «за звёзды» до ${maxStars}… Это может занять 5–40 секунд.`);
  try {
    const items = await scrapePeek({ maxStars, limit });
    if (!items.length) {
      return ctx.reply('Пока ничего не нашёл под этот лимит. Попробуй увеличить или повторить позже.');
    }
    const lines = items.map((it, i) => {
      const u = it.username ? `@${it.username}` : '—';
      const price = it.priceStars ? `${it.priceStars}⭐` : '—';
      return `${i + 1}. ${u}\n   Цена: ${price}\n   Подарок: ${it.giftUrl}`;
    });
    await ctx.reply(lines.join('\n\n'), { disable_web_page_preview: true });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при поиске. Попробуй ещё раз позже.');
  }
});

/** ===== HTTP API / UI ===== */
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

/** ===== Launch ===== */
app.listen(PORT, () => console.log('HTTP listening on :' + PORT));
bot.launch().then(() => console.log('Telegram bot started'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
