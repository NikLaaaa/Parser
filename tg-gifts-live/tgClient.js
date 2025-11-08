import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || '');

export async function getClient() {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 3
  });
  if (!client.connected) {
    await client.connect();
  }
  return client;
}

// Локально: получить новую StringSession
// npm run session
if (process.argv.includes('--get-session')) {
  (async () => {
    const tmp = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 3
    });
    await tmp.start({
      phoneNumber: async () => await input.text('Введите номер телефона (+7…): '),
      password: async () => await input.text('Пароль 2FA (если есть): '),
      phoneCode: async () => await input.text('Код из Telegram: ')
    });
    console.log('\n=== TELEGRAM_STRING_SESSION (скопируй в Render env) ===\n');
    console.log(tmp.session.save());
    console.log('\n===========================================\n');
    process.exit(0);
  })();
}
