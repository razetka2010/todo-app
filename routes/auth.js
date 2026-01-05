const express = require('express');
const router = express.Router();
const { validateTelegramAuth } = require('../config');
const { findOrCreateUser, getUserByTelegramId } = require('../database');

// Авторизация через Telegram
router.post('/telegram', async (req, res) => {
    try {
        const authData = req.body;

        // Валидируем данные от Telegram
        const validatedData = validateTelegramAuth(authData);
        if (!validatedData) {
            return res.status(401).json({
                success: false,
                error: 'Invalid Telegram authentication'
            });
        }

        // Находим или создаем пользователя
        const user = await findOrCreateUser(validatedData);

        // Сохраняем пользователя в сессии
        req.session.userId = user.id;
        req.session.telegramId = user.telegram_id;
        req.session.userData = {
            id: user.telegram_id,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username
        };

        res.json({
            success: true,
            user: req.session.userData
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Проверка текущей сессии
router.get('/check', (req, res) => {
    if (req.session.userId && req.session.userData) {
        res.json({
            success: true,
            user: req.session.userData
        });
    } else {
        res.json({
            success: false,
            user: null
        });
    }
});

// Выход
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: 'Logout failed'
            });
        }

        res.json({
            success: true
        });
    });
});

module.exports = router;
