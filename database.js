const { Pool } = require('pg');
require('dotenv').config();

// Создаем пул подключений к PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Функция для инициализации базы данных
const initDatabase = async () => {
    try {
        const client = await pool.connect();

        // Создаем таблицу задач
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                completed BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                priority INT DEFAULT 1,
                due_date DATE,
                CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                username VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
            CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
            CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
            
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
        `;

        await client.query(createTableQuery);
        console.log('Database tables created successfully');

        client.release();
        return true;
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
};

// Функции для работы с пользователями
const userQueries = {
    findOrCreateUser: async (telegramUser) => {
        const { id, first_name, last_name, username } = telegramUser;

        const query = `
            INSERT INTO users (telegram_id, first_name, last_name, username) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (telegram_id) 
            DO UPDATE SET 
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                username = EXCLUDED.username
            RETURNING *;
        `;

        const values = [id, first_name, last_name, username];
        const result = await pool.query(query, values);
        return result.rows[0];
    },

    getUserById: async (userId) => {
        const query = 'SELECT * FROM users WHERE id = $1';
        const result = await pool.query(query, [userId]);
        return result.rows[0];
    },

    getUserByTelegramId: async (telegramId) => {
        const query = 'SELECT * FROM users WHERE telegram_id = $1';
        const result = await pool.query(query, [telegramId]);
        return result.rows[0];
    }
};

// Функции для работы с задачами
const taskQueries = {
    getTasks: async (userId, filter = 'all', orderBy = 'created_at', direction = 'DESC') => {
        let whereClause = 'WHERE user_id = $1';
        let queryParams = [userId];
        let paramCount = 1;

        if (filter === 'active') {
            paramCount++;
            whereClause += ` AND completed = $${paramCount}`;
            queryParams.push(false);
        } else if (filter === 'completed') {
            paramCount++;
            whereClause += ` AND completed = $${paramCount}`;
            queryParams.push(true);
        }

        // Валидация параметров сортировки
        const validOrders = ['created_at', 'updated_at', 'priority', 'due_date'];
        const validDirections = ['ASC', 'DESC'];

        const order = validOrders.includes(orderBy) ? orderBy : 'created_at';
        const dir = validDirections.includes(direction.toUpperCase()) ? direction.toUpperCase() : 'DESC';

        const query = `
            SELECT * FROM tasks 
            ${whereClause} 
            ORDER BY ${order} ${dir}
        `;

        const result = await pool.query(query, queryParams);
        return result.rows;
    },

    addTask: async (taskData) => {
        const { user_id, title, description, priority, due_date } = taskData;

        const query = `
            INSERT INTO tasks (user_id, title, description, priority, due_date) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING *;
        `;

        const values = [user_id, title, description, priority, due_date];
        const result = await pool.query(query, values);
        return result.rows[0];
    },

    updateTask: async (taskId, userId, updates) => {
        const { title, description, completed, priority, due_date } = updates;

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
        return result.rows[0];
    },

    deleteTask: async (taskId, userId) => {
        const query = 'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *';
        const result = await pool.query(query, [taskId, userId]);
        return result.rows[0];
    },

    toggleTask: async (taskId, userId, completed) => {
        const query = `
            UPDATE tasks 
            SET completed = $1 
            WHERE id = $2 AND user_id = $3 
            RETURNING *;
        `;

        const result = await pool.query(query, [completed, taskId, userId]);
        return result.rows[0];
    },

    getStats: async (userId) => {
        const query = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN completed = TRUE THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN completed = FALSE THEN 1 ELSE 0 END) as active
            FROM tasks 
            WHERE user_id = $1;
        `;

        const result = await pool.query(query, [userId]);
        return result.rows[0];
    }
};

module.exports = {
    pool,
    initDatabase,
    ...userQueries,
    ...taskQueries
};