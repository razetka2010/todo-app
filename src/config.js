const crypto = require('crypto');

module.exports = {
    // Проверка авторизации Telegram
    validateTelegramAuth: (authData) => {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        if (!botToken) {
            console.error('TELEGRAM_BOT_TOKEN not configured');
            return null;
        }

        const { hash, ...data } = authData;

        // Проверяем, что данные не устарели (24 часа)
        const authDate = parseInt(data.auth_date);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) {
            return null;
        }

        // Создаем проверочную строку
        const dataCheckArr = [];
        Object.keys(data)
            .sort()
            .forEach(key => {
                if (data[key]) {
                    dataCheckArr.push(`${key}=${data[key]}`);
                }
            });

        const dataCheckString = dataCheckArr.join('\n');
        const secretKey = crypto.createHash('sha256').update(botToken).digest();
        const computedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        return computedHash === hash ? data : null;
    },

    // Проверка ID пользователя (если нужно ограничить доступ)
    isUserAllowed: (userId) => {
        const allowedUsers = process.env.ALLOWED_USERS;
        if (!allowedUsers) return true;

        const allowedIds = allowedUsers.split(',').map(id => parseInt(id.trim()));
        return allowedIds.includes(parseInt(userId));
    }
};