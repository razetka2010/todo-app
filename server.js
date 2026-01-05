const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'telegram-todo-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// Импортируем роутеры
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');

// Подключаем роутеры
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Получение конфигурации для клиента
app.get('/api/config', (req, res) => {
    res.json({
        botUsername: process.env.TELEGRAM_BOT_USERNAME,
        appUrl: process.env.APP_URL || `https://${req.get('host')}`
    });
});

// Инициализация базы данных
app.get('/init-database', async (req, res) => {
    try {
        const { initDatabase } = require('./database');
        await initDatabase();
        res.send('Database initialized successfully!');
    } catch (error) {
        console.error('Database initialization error:', error);
        res.status(500).send('Database initialization failed');
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});