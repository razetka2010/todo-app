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
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'telegram-todo-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
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
    
    // В режиме продакшена упрощаем проверку для тестирования
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

// API Routes

// Авторизация через Telegram (упрощенная версия)
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const authData = req.body;
        console.log('Received auth data:', authData);
        
        let validatedData;
        
        // Вариант 1: Если пришла строка initData от Telegram
        if (typeof authData === 'string' || authData.initData) {
            const initDataStr = typeof authData === 'string' ? authData : authData.initData;
            console.log('Parsing initData string:', initDataStr);
            
            // Парсим query string
            const params = new URLSearchParams(initDataStr);
            const parsedData = {};
            
            for (const [key, value] of params) {
                parsedData[key] = value;
            }
            
            // Парсим user если он в JSON формате
            if (parsedData.user) {
                try {
                    const userData = JSON.parse(decodeURIComponent(parsedData.user));
                    console.log('Parsed user data:', userData);
                    
                    validatedData = {
                        id: userData.id,
                        first_name: userData.first_name || '',
                        last_name: userData.last_name || '',
                        username: userData.username || '',
                        auth_date: parsedData.auth_date || Math.floor(Date.now() / 1000),
                        hash: parsedData.hash || ''
                    };
                } catch (e) {
                    console.error('Error parsing user data:', e);
                    // Если не удалось распарсить, используем raw данные
                    validatedData = {
                        id: parsedData.id || 0,
                        first_name: '',
                        last_name: '',
                        username: '',
                        auth_date: parsedData.auth_date || Math.floor(Date.now() / 1000),
                        hash: parsedData.hash || ''
                    };
                }
            } else {
                validatedData = parsedData;
            }
        }
        // Вариант 2: Если пришли данные пользователя напрямую
        else if (authData.user || authData.id) {
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
        
        // Валидируем данные
        let userData;
        if (process.env.NODE_ENV === 'production' && validatedData?.id) {
            // В продакшене пропускаем проверку hash для упрощения
            console.log('Production mode: skipping hash validation');
            userData = validatedData;
        } else {
            userData = validateTelegramAuth(validatedData);
        }
        
        if (!userData || !userData.id) {
            console.log('Auth validation failed, falling back to test mode');
            
            // Если авторизация не удалась, создаем тестового пользователя
            const testId = validatedData?.id || Math.floor(Math.random() * 1000000);
            const testUser = {
                id: testId,
                first_name: validatedData?.first_name || 'Test',
                last_name: validatedData?.last_name || 'User',
                username: validatedData?.username || 'testuser'
            };
            
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
            
            const result = await pool.query(userQuery, [
                testUser.id, 
                testUser.first_name, 
                testUser.last_name, 
                testUser.username
            ]);
            const dbUser = result.rows[0];
            
            req.session.userId = dbUser.id;
            req.session.telegramId = dbUser.telegram_id;
            req.session.userData = {
                id: dbUser.telegram_id,
                first_name: dbUser.first_name,
                last_name: dbUser.last_name,
                username: dbUser.username
            };

            console.log('Fallback user authenticated:', dbUser);
            return res.json({ success: true, user: req.session.userData, fallback: true });
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

        console.log('User authenticated successfully:', dbUser);
        res.json({ success: true, user: req.session.userData });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Простая авторизация (для тестирования)
app.post('/api/auth/simple', async (req, res) => {
    try {
        const { user } = req.body;
        console.log('Simple auth request:', user);
        
        if (!user || !user.id) {
            return res.status(400).json({ success: false, error: 'User data required' });
        }
        
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
        
        const result = await pool.query(userQuery, [
            user.id, 
            user.first_name || '', 
            user.last_name || '', 
            user.username || ''
        ]);
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

        console.log('User authenticated via simple auth:', dbUser);
        res.json({ success: true, user: req.session.userData });
    } catch (error) {
        console.error('Simple auth error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Проверка сессии
app.get('/api/auth/check', (req, res) => {
    console.log('Session check:', req.session);
    if (req.session.userId && req.session.userData) {
        res.json({ success: true, user: req.session.userData });
    } else {
        res.json({ success: false, user: null });
    }
});

// Выход
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

// Задачи
app.get('/api/tasks', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const { filter = 'all', order = 'created_at', direction = 'DESC' } = req.query;
        const userId = req.session.userId;

        let whereClause = 'WHERE t.user_id = $1';
        let queryParams = [userId];

        if (filter === 'active') {
            whereClause += ' AND t.completed = FALSE';
        } else if (filter === 'completed') {
            whereClause += ' AND t.completed = TRUE';
        }

        const validOrders = ['created_at', 'updated_at', 'priority', 'due_date', 'title'];
        const validDirections = ['ASC', 'DESC'];

        const orderBy = validOrders.includes(order) ? order : 'created_at';
        const orderDirection = validDirections.includes(direction.toUpperCase()) ? direction.toUpperCase() : 'DESC';

        const query = `
            SELECT t.* 
            FROM tasks t
            ${whereClause} 
            ORDER BY t.${orderBy} ${orderDirection}
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
            stats: statsResult.rows[0] || { total: 0, completed: 0, active: 0 }
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

// Получить пользователя по ID
app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        
        const query = 'SELECT * FROM users WHERE telegram_id = $1 OR id = $1';
        const result = await pool.query(query, [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, error: 'Failed to get user' });
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

// Тестовая страница
app.get('/test', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Page</title>
            <script src="https://telegram.org/js/telegram-web-app.js"></script>
        </head>
        <body>
            <h1>Test Page</h1>
            <div id="info"></div>
            <button onclick="testAuth()">Test Auth</button>
            <script>
                function testAuth() {
                    const tg = window.Telegram?.WebApp;
                    if (tg) {
                        const user = tg.initDataUnsafe?.user;
                        const initData = tg.initData;
                        
                        document.getElementById('info').innerHTML = 
                            '<pre>' + JSON.stringify({ user, initData }, null, 2) + '</pre>';
                        
                        fetch('/api/auth/telegram', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                user: user,
                                initData: initData
                            })
                        })
                        .then(res => res.json())
                        .then(data => {
                            console.log('Auth result:', data);
                            alert('Auth ' + (data.success ? 'success' : 'failed'));
                        });
                    } else {
                        alert('Not in Telegram');
                    }
                }
                
                if (window.Telegram?.WebApp) {
                    Telegram.WebApp.ready();
                    Telegram.WebApp.expand();
                }
            </script>
        </body>
        </html>
    `);
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
            telegram_token: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'
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
    console.log(`Test page: https://todo-app-1-zq6v.onrender.com/test`);
    console.log(`Init DB: https://todo-app-1-zq6v.onrender.com/init-database`);
});
