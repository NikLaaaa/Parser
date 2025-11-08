import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import { scanUsers } from './providers/tgSearchPerUser.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());

// GET /api/gifts?sellers=@user1,@user2&maxStars=1100
app.get('/api/gifts', async (req, res) => {
  try {
    const sellersParam = (req.query.sellers || '').trim();
    if (!sellersParam) return res.json([]); // нет списка — пустой ответ

    const sellers = sellersParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 15);
    const maxStars = req.query.maxStars ? Number(req.query.maxStars) : null;

    const items = await scanUsers({ sellers, maxItems: 15, maxStars });

    // нормализуем ответ
    res.json(items.map(x => ({
      name: x.giftName,
      priceStars: x.priceStars,
      seller: x.seller,
      url: x.url
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'fetch_failed', details: String(e?.message || e) });
  }
});

app.use(express.static('public'));
app.get('/healthz', (_req, res) => res.send('ok'));
app.listen(PORT, () => console.log('listening on :' + PORT));
