import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { fetchGiftsFromPriceBot } from './priceBotProvider.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false })); // упростили CSP для WebApp
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());

// API: /api/gifts?maxStars=1100
app.get('/api/gifts', async (req, res) => {
  try {
    const maxStars = req.query.maxStars ? Number(req.query.maxStars) : null;
    let gifts = await fetchGiftsFromPriceBot(); // только те, у кого есть реальная цена "Купить за ⭐"

    if (Number.isFinite(maxStars)) {
      gifts = gifts.filter(g => g.priceStars <= maxStars);
    }

    gifts.sort((a, b) => a.priceStars - b.priceStars);
    gifts = gifts.slice(0, 15); // максимум 15

    res.json(gifts);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'fetch_failed', details: String(e?.message || e) });
  }
});

// фронт
app.use(express.static('public'));

// healthcheck
app.get('/healthz', (_req, res) => res.send('ok'));

app.listen(PORT, () => console.log('listening on :' + PORT));
