let API_BASE = '/api';
let currentUser = null;
let currentTasks = [];
let currentFilter = 'all';

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.expand();
        Telegram.WebApp.ready();
        
        const tgUser = Telegram.WebApp.initDataUnsafe.user;
        if (tgUser) {
            await authenticateWithTelegram(tgUser);
        }
    }
    
    await loadApp();
});

// Авторизация
async function authenticateWithTelegram(tgUser) {
    try {
        const response = await fetch(`${API_BASE}/auth/telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: tgUser.id,
                first_name: tgUser.first_name,
                last_name: tgUser.last_name,
                username: tgUser.username,
                auth_date: Math.floor(Date.now() / 1000),
                hash: Telegram.WebApp.initData
            })
        });
        
        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            showNotification('Добро пожаловать!', 'success');
        }
    } catch (error) {
        console.error('Auth error:', error);
    }
}

// Загрузка приложения
async function loadApp() {
    try {
        const response = await fetch(`${API_BASE}/auth/check`);
        const data = await response.json();
        
        if (data.success && data.user) {
            currentUser = data.user;
            renderMainApp();
            await loadTasks();
        } else {
            renderLoginScreen();
        }
    } catch (error) {
        console.error('Auth check error:', error);
        renderLoginScreen();
    }
}

// Основные функции (упрощенные версии)
function renderMainApp() {
    const app = document.getElementById('app');
    
    app.innerHTML = `
        <header>
            <div class="user-info">
                <div class="avatar">
                    ${getAvatarInitials(currentUser.first_name, currentUser.last_name)}
                </div>
                <div class="user-details">
                    <h2>${escapeHtml(currentUser.first_name + ' ' + (currentUser.last_name || ''))}</h2>
                    <p>@${escapeHtml(currentUser.username || 'user')}</p>
                </div>
            </div>
            <button class="logout-btn" onclick="logout()">Выйти</button>
        </header>
        
        <main>
            <div class="add-task-section">
                <input type="text" id="taskTitle" placeholder="Название задачи..." maxlength="255">
                <button onclick="addTask()">➕ Добавить задачу</button>
            </div>
            
            <div class="controls">
                <div class="filters">
                    <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Все</button>
                    <button class="filter-btn ${currentFilter === 'active' ? 'active' : ''}" onclick="setFilter('active')">Активные</button>
                    <button class="filter-btn ${currentFilter === 'completed' ? 'active' : ''}" onclick="setFilter('completed')">Завершенные</button>
                </div>
            </div>
            
            <div class="stats" id="stats">
                Загрузка...
            </div>
            
            <div id="tasksList" class="tasks-list">
                <!-- Задачи будут здесь -->
            </div>
            
            <div id="emptyState" class="empty-state" style="display: none;">
                📝 У вас пока нет задач. Добавьте первую!
            </div>
        </main>
        
        <footer>
            <p>ToDo List Mini App &copy; ${new Date().getFullYear()}</p>
        </footer>
    `;
}

function renderLoginScreen() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div class="login-screen">
            <h1>📝 ToDo List</h1>
            <p>Войдите через Telegram для использования приложения</p>
            <p class="note">Откройте это приложение через Telegram бота</p>
            <button onclick="location.reload()" class="refresh-btn">Обновить страницу</button>
        </div>
    `;
}

async function loadTasks() {
    try {
        const response = await fetch(`${API_BASE}/tasks?filter=${currentFilter}`);
        const data = await response.json();
        
        if (data.success) {
            currentTasks = data.tasks;
            displayTasks(currentTasks);
            updateStats(data.stats);
        }
    } catch (error) {
        console.error('Load tasks error:', error);
        showNotification('Ошибка загрузки задач', 'error');
    }
}

function displayTasks(tasks) {
    const tasksList = document.getElementById('tasksList');
    const emptyState = document.getElementById('emptyState');
    
    if (tasks.length === 0) {
        tasksList.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    tasksList.innerHTML = tasks.map(task => `
        <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
            <div class="checkbox ${task.completed ? 'checked' : ''}" 
                 onclick="toggleTask(${task.id}, ${!task.completed})">
                ${task.completed ? '✓' : ''}
            </div>
            <div class="task-content">
                <div class="task-title">
                    <span>${escapeHtml(task.title)}</span>
                </div>
                ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
                <div class="task-meta-info">
                    <span>📅 ${formatDate(task.created_at)}</span>
                </div>
            </div>
            <div class="task-actions">
                <button class="delete-btn" onclick="deleteTask(${task.id})">🗑️</button>
            </div>
        </div>
    `).join('');
}

async function addTask() {
    const titleInput = document.getElementById('taskTitle');
    const title = titleInput.value.trim();
    
    if (!title) {
        showNotification('Введите название задачи', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Задача добавлена!', 'success');
            titleInput.value = '';
            await loadTasks();
        }
    } catch (error) {
        console.error('Add task error:', error);
        showNotification('Ошибка добавления задачи', 'error');
    }
}

async function deleteTask(taskId) {
    if (!confirm('Удалить задачу?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Задача удалена', 'success');
            await loadTasks();
        }
    } catch (error) {
        console.error('Delete task error:', error);
        showNotification('Ошибка удаления задачи', 'error');
    }
}

async function toggleTask(taskId, completed) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}/toggle`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed })
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadTasks();
        }
    } catch (error) {
        console.error('Toggle task error:', error);
    }
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`button[onclick="setFilter('${filter}')"]`);
    if (activeBtn) activeBtn.classList.add('active');
    loadTasks();
}

function updateStats(stats) {
    const statsElement = document.getElementById('stats');
    if (statsElement && stats) {
        statsElement.innerHTML = `
            ${stats.total || 0} задач всего, 
            ${stats.active || 0} активных, 
            ${stats.completed || 0} завершено
        `;
    }
}

async function logout() {
    if (!confirm('Выйти?')) return;
    
    try {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        location.reload();
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Вспомогательные функции
function getAvatarInitials(firstName, lastName) {
    return (firstName?.charAt(0) || '') + (lastName?.charAt(0) || '');
}

function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('ru-RU');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'info') {
    if (window.Telegram && Telegram.WebApp) {
        if (type === 'error') {
            Telegram.WebApp.showAlert(message);
        } else {
            Telegram.WebApp.showPopup({
                title: type === 'success' ? 'Успешно' : 'Информация',
                message: message,
                buttons: [{ type: 'ok' }]
            });
        }
    } else {
        alert(message);
    }
}

// Глобальные функции
window.addTask = addTask;
window.logout = logout;
window.setFilter = setFilter;
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
