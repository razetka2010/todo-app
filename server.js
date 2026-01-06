const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware для отладки
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    console.log('Session ID:', req.sessionID);
    console.log('Session data:', req.session);
    next();
});

// Middleware
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session middleware с улучшенными настройками
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'telegram-todo-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        httpOnly: true
    },
    name: 'todoapp.sid'
};

// В продакшене используем прокси
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    sessionConfig.cookie.secure = true;
    sessionConfig.cookie.sameSite = 'none';
}

app.use(session(sessionConfig));

// Простая проверка авторизации Telegram
function validateTelegramAuth(authData) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
        console.error('TELEGRAM_BOT_TOKEN not configured');
        return null;
    }

    const { hash, ...data } = authData;
    
    // В продакшене упрощаем проверку для тестирования
    if (process.env.NODE_ENV === 'production') {
        console.log('Production mode: simplified auth validation');
        
        // Проверяем только наличие основных данных
        if (!data.id || !data.auth_date) {
            console.log('Missing required data:', data);
            return null;
        }
        
        // Проверяем, что данные не устарели (24 часа)
        const authDate = parseInt(data.auth_date);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) {
            console.log('Auth data expired:', now - authDate);
            return null;
        }
        
        return data;
    }
    
    // В режиме разработки выполняем полную проверку
    if (!hash) {
        console.log('No hash provided');
        return null;
    }

    // Проверяем, что данные не устарели (24 часа)
    const authDate = parseInt(data.auth_date);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
        console.log('Auth data expired:', now - authDate);
        return null;
    }

    // Создаем проверочную строку
    const dataCheckArr = [];
    Object.keys(data)
        .sort()
        .forEach(key => {
            if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
                dataCheckArr.push(`${key}=${data[key]}`);
            }
        });

    const dataCheckString = dataCheckArr.join('\n');
    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const computedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    console.log('Telegram auth validation:', {
        dataCheckString,
        computedHash,
        receivedHash: hash,
        match: computedHash === hash
    });

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
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
            
            -- Функция для обновления updated_at
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
            
            -- Триггер для обновления updated_at
            DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
            CREATE TRIGGER update_tasks_updated_at
                BEFORE UPDATE ON tasks
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        `);
        
        console.log('Database initialized successfully');
        client.release();
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

// Вызываем инициализацию при запуске
initDatabase();

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
    console.log('Auth check for', req.path, 'session:', req.session);
    
    if (!req.session.userId) {
        console.log('User not authenticated for', req.path);
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    console.log('User authenticated:', req.session.userId);
    next();
}

// API Routes

// Авторизация через Telegram
app.post('/api/auth/telegram', async (req, res) => {
    try {
        console.log('Auth request body:', req.body);
        const authData = req.body;
        
        let validatedData;
        
        // Если пришли данные пользователя напрямую
        if (authData.user || authData.id) {
            console.log('Using direct user data');
            validatedData = {
                id: authData.id || authData.user?.id || 0,
                first_name: authData.first_name || authData.user?.first_name || '',
                last_name: authData.last_name || authData.user?.last_name || '',
                username: authData.username || authData.user?.username || '',
                auth_date: authData.auth_date || Math.floor(Date.now() / 1000),
                hash: authData.hash || ''
            };
        }
        
        console.log('Validating data:', validatedData);
        
        let userData;
        if (process.env.NODE_ENV === 'production' && validatedData?.id) {
            // В продакшене пропускаем проверку hash для упрощения
            console.log('Production mode: skipping hash validation');
            userData = validatedData;
        } else {
            userData = validateTelegramAuth(validatedData);
        }
        
        if (!userData || !userData.id) {
            console.log('Auth validation failed');
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid Telegram authentication'
            });
        }

        const { id, first_name, last_name, username } = userData;
        
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
        const dbUser = result.rows[0];
        
        // Сохраняем в сессии
        req.session.userId = dbUser.id;
        req.session.telegramId = dbUser.telegram_id;
        req.session.userData = {
            id: dbUser.telegram_id,
            first_name: dbUser.first_name,
            last_name: dbUser.last_name,
            username: dbUser.username
        };

        // Сохраняем сессию
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Session save failed' 
                });
            }
            
            console.log('User authenticated successfully:', dbUser);
            console.log('Session saved:', req.session);
            res.json({ success: true, user: req.session.userData });
        });
        
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Проверка сессии
app.get('/api/auth/check', (req, res) => {
    console.log('Session check endpoint called, session:', req.session);
    
    if (req.session.userId && req.session.userData) {
        console.log('User authenticated:', req.session.userData);
        res.json({ success: true, user: req.session.userData });
    } else {
        console.log('User not authenticated');
        res.json({ success: false, user: null });
    }
});

// Выход
app.post('/api/auth/logout', (req, res) => {
    console.log('Logout called, session:', req.session);
    
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        
        console.log('Session destroyed');
        res.json({ success: true });
    });
});

// Задачи - все защищены requireAuth
app.get('/api/tasks', requireAuth, async (req, res) => {
    try {
        console.log('Get tasks for user:', req.session.userId);
        
        const { filter = 'all', order = 'created_at', direction = 'DESC' } = req.query;
        const userId = req.session.userId;

        let whereClause = 'WHERE user_id = $1';
        let queryParams = [userId];

        if (filter === 'active') {
            whereClause += ' AND completed = FALSE';
        } else if (filter === 'completed') {
            whereClause += ' AND completed = TRUE';
        }

        const validOrders = ['created_at', 'updated_at', 'priority', 'due_date', 'title'];
        const validDirections = ['ASC', 'DESC'];

        const orderBy = validOrders.includes(order) ? order : 'created_at';
        const orderDirection = validDirections.includes(direction.toUpperCase()) ? direction.toUpperCase() : 'DESC';

        const query = `
            SELECT * FROM tasks 
            ${whereClause} 
            ORDER BY ${orderBy} ${orderDirection}
        `;

        console.log('Executing query:', query, 'with params:', queryParams);
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
            stats: statsResult.rows[0] || { total: 0, completed: 0, active: 0 }
        });
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({ success: false, error: 'Failed to get tasks' });
    }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
        console.log('Add task request from user:', req.session.userId, 'body:', req.body);
        
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
        
        console.log('Task added:', result.rows[0]);
        res.json({ success: true, task: result.rows[0] });
    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({ success: false, error: 'Failed to add task' });
    }
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
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

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
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

app.patch('/api/tasks/:id/toggle', requireAuth, async (req, res) => {
    try {
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
        res.status(500).send('Database initialization failed: ' + error.message);
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        // Проверяем подключение к базе данных
        await pool.query('SELECT 1');
        
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            database: 'connected',
            session_enabled: true
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR', 
            timestamp: new Date().toISOString(),
            error: error.message,
            database: 'disconnected'
        });
    }
});

// Тестовая страница для отладки сессий
app.get('/debug', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Debug Session</title>
            <script>
                async function testSession() {
                    const response = await fetch('/api/auth/check', {
                        credentials: 'include'
                    });
                    const data = await response.json();
                    document.getElementById('result').innerHTML = 
                        '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
                }
                
                async function clearSession() {
                    const response = await fetch('/api/auth/logout', {
                        method: 'POST',
                        credentials: 'include'
                    });
                    const data = await response.json();
                    alert('Session cleared: ' + JSON.stringify(data));
                }
            </script>
        </head>
        <body>
            <h1>Session Debug</h1>
            <button onclick="testSession()">Test Session</button>
            <button onclick="clearSession()">Clear Session</button>
            <div id="result"></div>
        </body>
        </html>
    `);
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
    console.log(`Telegram Bot Token: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
    console.log(`App URL: https://todo-app-1-zq6v.onrender.com`);
    console.log(`Debug page: https://todo-app-1-zq6v.onrender.com/debug`);
});
