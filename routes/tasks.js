const express = require('express');
const router = express.Router();

const {
    getTasks,
    addTask,
    updateTask,
    deleteTask,
    toggleTask,
    getStats
} = require('../database');

// Middleware для проверки авторизации
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            error: 'Not authenticated'
        });
    }
    next();
};

// Получение всех задач пользователя
router.get('/', requireAuth, async (req, res) => {
    try {
        const { filter = 'all', order = 'created_at', direction = 'DESC' } = req.query;
        const userId = req.session.userId;

        const tasks = await getTasks(userId, filter, order, direction);
        const stats = await getStats(userId);

        res.json({
            success: true,
            tasks,
            stats
        });
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get tasks'
        });
    }
});

// Добавление новой задачи
router.post('/', requireAuth, async (req, res) => {
    try {
        const { title, description, priority, due_date } = req.body;
        const userId = req.session.userId;

        if (!title || title.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Title is required'
            });
        }

        const taskData = {
            user_id: userId,
            title: title.trim(),
            description: description ? description.trim() : null,
            priority: priority || 2,
            due_date: due_date || null
        };

        const task = await addTask(taskData);

        res.json({
            success: true,
            task
        });
    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add task'
        });
    }
});

// Обновление задачи
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.session.userId;
        const updates = req.body;

        const task = await updateTask(taskId, userId, updates);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        res.json({
            success: true,
            task
        });
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update task'
        });
    }
});

// Удаление задачи
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.session.userId;

        const task = await deleteTask(taskId, userId);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        res.json({
            success: true
        });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete task'
        });
    }
});

// Переключение статуса задачи (выполнена/не выполнена)
router.patch('/:id/toggle', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.session.userId;
        const { completed } = req.body;

        if (typeof completed !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'Completed status is required'
            });
        }

        const task = await toggleTask(taskId, userId, completed);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        res.json({
            success: true,
            task
        });
    } catch (error) {
        console.error('Toggle task error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle task'
        });
    }
});

module.exports = router;