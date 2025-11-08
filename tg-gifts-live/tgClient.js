import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || '');

export async function getClient() {
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 3 });
  if (!client.connected) await client.connect();
  return client;
}

// локально: npm run session — получить TELEGRAM_STRING_SESSION
if (process.argv.includes('--get-session')) {
  (async () => {
    const tmp = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
    await tmp.start({
      phoneNumber: async () => await input.text('Phone (+7…): '),
      password:   async () => await input.text('2FA (если есть): '),
      phoneCode:  async () => await input.text('Код из Telegram: ')
    });
    console.log('\n=== TELEGRAM_STRING_SESSION ===\n' + tmp.session.save() + '\n');
    process.exit(0);
  })();
}
