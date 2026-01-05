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
app.use(express.static('public'));

// Session middleware (для продакшена нужно использовать Redis или базу данных)
app.use(session({
    secret: process.env.SESSION_SECRET || 'telegram-todo-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// Простая проверка авторизации Telegram
function validateTelegramAuth(authData) {
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
}

// Подключение к PostgreSQL
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Инициализация базы данных
async function initDatabase() {
    try {
        const client = await pool.connect();
        
        // Создаем таблицы
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                username VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                completed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                priority INT DEFAULT 1,
                due_date DATE
            );
            
            CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
        `);
        
        console.log('Database initialized successfully');
        client.release();
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

// Вызываем инициализацию при запуске
initDatabase();

// API Routes

// Авторизация через Telegram
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const authData = req.body;
        const validatedData = validateTelegramAuth(authData);
        
        if (!validatedData) {
            return res.status(401).json({ success: false, error: 'Invalid authentication' });
        }

        const { id, first_name, last_name, username } = validatedData;
        
        // Находим или создаем пользователя
        const userQuery = `
            INSERT INTO users (telegram_id, first_name, last_name, username) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (telegram_id) 
            DO UPDATE SET 
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                username = EXCLUDED.username
            RETURNING id, telegram_id, first_name, last_name, username;
        `;
        
        const result = await pool.query(userQuery, [id, first_name, last_name, username]);
        const user = result.rows[0];
        
        // Сохраняем в сессии
        req.session.userId = user.id;
        req.session.telegramId = user.telegram_id;
        req.session.userData = {
            id: user.telegram_id,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username
        };

        res.json({ success: true, user: req.session.userData });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Проверка сессии
app.get('/api/auth/check', (req, res) => {
    if (req.session.userId && req.session.userData) {
        res.json({ success: true, user: req.session.userData });
    } else {
        res.json({ success: false, user: null });
    }
});

// Выход
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Задачи
app.get('/api/tasks', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const { filter = 'all', order = 'created_at', direction = 'DESC' } = req.query;
        const userId = req.session.userId;

        let whereClause = 'WHERE user_id = $1';
        let queryParams = [userId];

        if (filter === 'active') {
            whereClause += ' AND completed = FALSE';
        } else if (filter === 'completed') {
            whereClause += ' AND completed = TRUE';
        }

        const query = `
            SELECT * FROM tasks 
            ${whereClause} 
            ORDER BY ${order} ${direction}
        `;

        const result = await pool.query(query, queryParams);
        
        // Статистика
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN completed = TRUE THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN completed = FALSE THEN 1 ELSE 0 END) as active
            FROM tasks 
            WHERE user_id = $1;
        `;
        
        const statsResult = await pool.query(statsQuery, [userId]);
        
        res.json({
            success: true,
            tasks: result.rows,
            stats: statsResult.rows[0]
        });
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({ success: false, error: 'Failed to get tasks' });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const { title, description, priority, due_date } = req.body;
        const userId = req.session.userId;

        if (!title || title.trim() === '') {
            return res.status(400).json({ success: false, error: 'Title is required' });
        }

        const query = `
            INSERT INTO tasks (user_id, title, description, priority, due_date) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING *;
        `;
        
        const values = [userId, title.trim(), description ? description.trim() : null, priority || 2, due_date || null];
        const result = await pool.query(query, values);
        
        res.json({ success: true, task: result.rows[0] });
    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({ success: false, error: 'Failed to add task' });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const taskId = req.params.id;
        const userId = req.session.userId;
        const { title, description, completed, priority, due_date } = req.body;

        const query = `
            UPDATE tasks 
            SET title = COALESCE($1, title),
                description = COALESCE($2, description),
                completed = COALESCE($3, completed),
                priority = COALESCE($4, priority),
                due_date = COALESCE($5, due_date)
            WHERE id = $6 AND user_id = $7
            RETURNING *;
        `;
        
        const values = [title, description, completed, priority, due_date, taskId, userId];
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        res.json({ success: true, task: result.rows[0] });
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({ success: false, error: 'Failed to update task' });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const taskId = req.params.id;
        const userId = req.session.userId;

        const query = 'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *';
        const result = await pool.query(query, [taskId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete task' });
    }
});

app.patch('/api/tasks/:id/toggle', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const taskId = req.params.id;
        const userId = req.session.userId;
        const { completed } = req.body;

        if (typeof completed !== 'boolean') {
            return res.status(400).json({ success: false, error: 'Completed status is required' });
        }

        const query = `
            UPDATE tasks 
            SET completed = $1 
            WHERE id = $2 AND user_id = $3 
            RETURNING *;
        `;
        
        const result = await pool.query(query, [completed, taskId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }

        res.json({ success: true, task: result.rows[0] });
    } catch (error) {
        console.error('Toggle task error:', error);
        res.status(500).json({ success: false, error: 'Failed to toggle task' });
    }
});

// Инициализация базы данных
app.get('/init-database', async (req, res) => {
    try {
        await initDatabase();
        res.send('Database initialized successfully!');
    } catch (error) {
        console.error('Database initialization error:', error);
        res.status(500).send('Database initialization failed');
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database URL: ${process.env.DATABASE_URL ? 'Configured' : 'Not configured'}`);
});
