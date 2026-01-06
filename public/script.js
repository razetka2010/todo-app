// Конфигурация
let API_BASE = '/api';
let currentUser = null;
let currentTasks = [];
let currentFilter = 'all';

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    console.log('ToDo App initialized');
    
    // Проверяем, открыто ли в Telegram Web App
    if (window.Telegram && Telegram.WebApp) {
        console.log('Telegram Web App detected');
        Telegram.WebApp.expand();
        Telegram.WebApp.ready();
        
        // Устанавливаем тему Telegram
        if (Telegram.WebApp.colorScheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
        
        // Авторизуемся через Telegram
        await telegramAuth();
    } else {
        console.log('Not in Telegram Web App');
    }
    
    // Загружаем интерфейс
    await loadInterface();
});

// Авторизация через Telegram
async function telegramAuth() {
    try {
        const tgUser = Telegram.WebApp.initDataUnsafe.user;
        if (!tgUser) {
            console.log('No Telegram user data');
            return false;
        }
        
        console.log('Telegram user:', tgUser);
        
        const response = await fetch(`${API_BASE}/auth/telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // Важно для сессий!
            body: JSON.stringify({
                user: tgUser
            })
        });
        
        const data = await response.json();
        console.log('Telegram auth response:', data);
        
        if (data.success) {
            currentUser = data.user;
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Telegram auth error:', error);
        return false;
    }
}

// Загрузка интерфейса
async function loadInterface() {
    const app = document.getElementById('app');
    
    // Показываем заглушку
    app.innerHTML = `
        <div class="loading">
            <div class="spinner">📝</div>
            <h2>ToDo List</h2>
            <p>Инициализация...</p>
        </div>
    `;
    
    try {
        // Проверяем сессию
        const response = await fetch(`${API_BASE}/auth/check`, {
            credentials: 'include' // Важно для сессий!
        });
        
        const data = await response.json();
        console.log('Session check:', data);
        
        if (data.success && data.user) {
            currentUser = data.user;
            renderMainApp();
            await loadTasks();
        } else {
            renderLoginScreen();
        }
    } catch (error) {
        console.error('Load interface error:', error);
        renderLoginScreen();
    }
}

// Рендер главного экрана
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
                    ${currentUser.username ? `<p>@${escapeHtml(currentUser.username)}</p>` : ''}
                </div>
            </div>
        </header>
        
        <main>
            <div class="add-task-section">
                <input type="text" id="taskTitle" placeholder="Что нужно сделать?" maxlength="255">
                <textarea id="taskDescription" placeholder="Подробное описание..."></textarea>
                <div class="task-meta">
                    <select id="taskPriority">
                        <option value="3">🔴 Высокий</option>
                        <option value="2" selected>🟡 Средний</option>
                        <option value="1">🟢 Низкий</option>
                    </select>
                    <input type="date" id="taskDueDate">
                </div>
                <button onclick="addTask()">➕ Добавить задачу</button>
            </div>
            
            <div class="controls">
                <div class="filters">
                    <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">Все</button>
                    <button class="filter-btn ${currentFilter === 'active' ? 'active' : ''}" onclick="setFilter('active')">Активные</button>
                    <button class="filter-btn ${currentFilter === 'completed' ? 'active' : ''}" onclick="setFilter('completed')">Готово</button>
                </div>
                <div class="sort">
                    <select id="sortOrder" onchange="loadTasks()">
                        <option value="created_at-DESC">Сначала новые</option>
                        <option value="priority-DESC">По важности</option>
                        <option value="due_date-ASC">По сроку</option>
                    </select>
                </div>
            </div>
            
            <div class="stats" id="stats">
                📊 Загрузка...
            </div>
            
            <div id="tasksList" class="tasks-list">
                <div class="loading-tasks">
                    <div class="spinner-small">⏳</div>
                    <p>Загрузка задач...</p>
                </div>
            </div>
            
            <div id="emptyState" class="empty-state" style="display: none;">
                📝 Список задач пуст. Добавьте первую задачу!
            </div>
        </main>
        
        <div class="footer-actions">
            <button onclick="refreshApp()" class="refresh-btn">🔄 Обновить</button>
            <button onclick="logout()" class="logout-btn">🚪 Выйти</button>
        </div>
        
        <footer>
            <p>ToDo App &copy; ${new Date().getFullYear()}</p>
        </footer>
    `;

    // Устанавливаем даты
    const today = new Date().toISOString().split('T')[0];
    const dueDateInput = document.getElementById('taskDueDate');
    if (dueDateInput) {
        dueDateInput.min = today;
        dueDateInput.value = today;
    }
}

// Рендер экрана входа
function renderLoginScreen() {
    const app = document.getElementById('app');

    app.innerHTML = `
        <div class="login-screen">
            <h1>📝 ToDo List</h1>
            <p>Простой менеджер задач</p>
            
            <div class="login-message">
                ${window.Telegram && Telegram.WebApp ? `
                    <p>Открыто в Telegram</p>
                    <p class="hint">Если задачи не загружаются, нажмите "Обновить"</p>
                    <button onclick="refreshApp()" class="action-btn">🔄 Обновить</button>
                ` : `
                    <p>Откройте приложение через Telegram бота</p>
                    <p class="hint">Это мини-приложение работает только в Telegram</p>
                `}
            </div>
        </div>
    `;
}

// Обновить приложение
function refreshApp() {
    location.reload();
}

// Загрузка задач
async function loadTasks() {
    try {
        const sortSelect = document.getElementById('sortOrder');
        const [order, direction] = sortSelect ? sortSelect.value.split('-') : ['created_at', 'DESC'];

        const response = await fetch(
            `${API_BASE}/tasks?filter=${currentFilter}&order=${order}&direction=${direction}`,
            {
                credentials: 'include'
            }
        );

        const data = await response.json();
        console.log('Tasks response:', data);

        if (data.success) {
            currentTasks = data.tasks || [];
            displayTasks(currentTasks);
            updateStats(data.stats);
        } else {
            if (data.error === 'Not authenticated') {
                showNotification('Сессия устарела. Обновите страницу.', 'warning');
                setTimeout(refreshApp, 2000);
            } else {
                showNotification('Ошибка загрузки: ' + data.error, 'error');
            }
        }
    } catch (error) {
        console.error('Load tasks error:', error);
        showNotification('Ошибка соединения', 'error');
    }
}

// Отображение задач
function displayTasks(tasks) {
    const tasksList = document.getElementById('tasksList');
    const emptyState = document.getElementById('emptyState');

    if (!tasks || tasks.length === 0) {
        if (tasksList) tasksList.innerHTML = '';
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
                <div class="task-header">
                    <h3 class="task-title">${escapeHtml(task.title)}</h3>
                    <span class="priority-badge priority-${task.priority}">
                        ${getPriorityText(task.priority)}
                    </span>
                </div>
                ${task.description ? `
                    <p class="task-description">${escapeHtml(task.description)}</p>
                ` : ''}
                <div class="task-footer">
                    <span class="task-date">📅 ${formatDate(task.created_at)}</span>
                    ${task.due_date ? `
                        <span class="due-date ${isOverdue(task.due_date) ? 'overdue' : ''}">
                            ⏰ ${formatDate(task.due_date)}
                        </span>
                    ` : ''}
                </div>
            </div>
            <div class="task-actions">
                <button class="action-icon" onclick="editTask(${task.id})" title="Редактировать">✏️</button>
                <button class="action-icon delete" onclick="deleteTask(${task.id})" title="Удалить">🗑️</button>
            </div>
        </div>
    `).join('');
}

// Добавление задачи
async function addTask() {
    const titleInput = document.getElementById('taskTitle');
    const descriptionInput = document.getElementById('taskDescription');
    const prioritySelect = document.getElementById('taskPriority');
    const dueDateInput = document.getElementById('taskDueDate');

    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const priority = parseInt(prioritySelect.value);
    const due_date = dueDateInput.value || null;

    if (!title) {
        showNotification('Введите название задачи', 'warning');
        titleInput.focus();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                title,
                description: description || null,
                priority,
                due_date
            })
        });

        const data = await response.json();
        console.log('Add task response:', data);

        if (data.success) {
            showNotification('✅ Задача добавлена!', 'success');
            
            // Сброс формы
            titleInput.value = '';
            descriptionInput.value = '';
            prioritySelect.value = '2';
            dueDateInput.value = new Date().toISOString().split('T')[0];
            titleInput.focus();
            
            // Обновление списка
            await loadTasks();
        } else {
            showNotification('❌ Ошибка: ' + (data.error || 'Неизвестная ошибка'), 'error');
        }
    } catch (error) {
        console.error('Add task error:', error);
        showNotification('❌ Ошибка соединения', 'error');
    }
}

// Переключение статуса задачи
async function toggleTask(taskId, completed) {
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}/toggle`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ completed })
        });

        const data = await response.json();
        if (data.success) {
            await loadTasks();
        }
    } catch (error) {
        console.error('Toggle error:', error);
        showNotification('❌ Ошибка обновления', 'error');
    }
}

// Удаление задачи
async function deleteTask(taskId) {
    if (!confirm('Удалить эту задачу?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();
        if (data.success) {
            showNotification('🗑️ Задача удалена', 'info');
            await loadTasks();
        }
    } catch (error) {
        console.error('Delete error:', error);
        showNotification('❌ Ошибка удаления', 'error');
    }
}

// Редактирование задачи (упрощенное)
async function editTask(taskId) {
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) return;
    
    const newTitle = prompt('Новое название задачи:', task.title);
    if (!newTitle || newTitle.trim() === '') return;
    
    const newDescription = prompt('Новое описание:', task.description || '');
    
    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                title: newTitle.trim(),
                description: newDescription ? newDescription.trim() : null
            })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('✅ Задача обновлена', 'success');
            await loadTasks();
        }
    } catch (error) {
        console.error('Edit error:', error);
        showNotification('❌ Ошибка обновления', 'error');
    }
}

// Установка фильтра
function setFilter(filter) {
    currentFilter = filter;
    
    // Обновляем кнопки
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    event.target.classList.add('active');
    loadTasks();
}

// Обновление статистики
function updateStats(stats) {
    const statsElement = document.getElementById('stats');
    if (statsElement && stats) {
        statsElement.innerHTML = `
            📊 Всего: ${stats.total || 0} | Активные: ${stats.active || 0} | Завершено: ${stats.completed || 0}
        `;
    }
}

// Выход
async function logout() {
    if (!confirm('Выйти из приложения?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();
        if (data.success) {
            showNotification('👋 До свидания!', 'info');
            setTimeout(refreshApp, 1000);
        }
    } catch (error) {
        console.error('Logout error:', error);
        showNotification('❌ Ошибка выхода', 'error');
    }
}

// Вспомогательные функции
function getAvatarInitials(firstName, lastName) {
    const first = firstName?.charAt(0) || 'U';
    const last = lastName?.charAt(0) || '';
    return first + last;
}

function getPriorityText(priority) {
    switch (parseInt(priority)) {
        case 3: return 'Высокий';
        case 2: return 'Средний';
        default: return 'Низкий';
    }
}

function formatDate(dateString) {
    if (!dateString) return '';
    try {
        return new Date(dateString).toLocaleDateString('ru-RU');
    } catch (e) {
        return dateString;
    }
}

function isOverdue(dateString) {
    if (!dateString) return false;
    try {
        const dueDate = new Date(dateString);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        return dueDate < today;
    } catch (e) {
        return false;
    }
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
                title: type === 'success' ? '✅ Успешно' : 'ℹ️ Информация',
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
window.editTask = editTask;
window.deleteTask = deleteTask;
window.refreshApp = refreshApp;
