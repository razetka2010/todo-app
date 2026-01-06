// Конфигурация
let API_BASE = '/api';
let currentUser = null;
let currentTasks = [];
let currentFilter = 'all';

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded');
    
    // Проверяем, открыто ли в Telegram Web App
    if (window.Telegram && Telegram.WebApp) {
        console.log('Telegram Web App detected');
        Telegram.WebApp.expand();
        Telegram.WebApp.ready();
        
        // Устанавливаем тему Telegram
        if (Telegram.WebApp.colorScheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }
    
    // Загружаем начальный интерфейс
    await loadApp();
});

// Упрощенная авторизация
async function simpleAuth(tgUser) {
    try {
        console.log('Simple auth with:', tgUser);
        
        const response = await fetch(`${API_BASE}/auth/telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                user: tgUser
            })
        });

        const data = await response.json();
        console.log('Auth response:', data);
        
        return data.success ? data.user : null;
    } catch (error) {
        console.error('Auth error:', error);
        return null;
    }
}

// Загрузка основного интерфейса
async function loadApp() {
    const app = document.getElementById('app');
    
    // Показываем заглушку
    app.innerHTML = `
        <div class="loading">
            <div class="spinner">📝</div>
            <h2>Загрузка ToDo List...</h2>
            <p>Пожалуйста, подождите</p>
        </div>
    `;

    try {
        // Сначала проверяем существующую сессию
        const checkResponse = await fetch(`${API_BASE}/auth/check`, {
            credentials: 'include'
        });
        
        if (!checkResponse.ok) {
            throw new Error('Network error');
        }
        
        const checkData = await checkResponse.json();
        console.log('Session check:', checkData);
        
        if (checkData.success && checkData.user) {
            currentUser = checkData.user;
            renderMainApp();
            await loadTasks();
            return;
        }
        
        // Если нет сессии, пробуем авторизоваться через Telegram
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe.user) {
            const tgUser = Telegram.WebApp.initDataUnsafe.user;
            console.log('Telegram user detected, trying auth...', tgUser);
            
            const user = await simpleAuth(tgUser);
            if (user) {
                currentUser = user;
                renderMainApp();
                await loadTasks();
                return;
            }
        }
        
        // Если ничего не сработало, показываем экран входа
        console.log('No valid session, showing login screen');
        renderLoginScreen();
        
    } catch (error) {
        console.error('Load app error:', error);
        renderErrorScreen('Ошибка загрузки: ' + error.message);
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
                <input type="text" id="taskTitle" placeholder="Название задачи..." maxlength="255">
                <textarea id="taskDescription" placeholder="Описание задачи..."></textarea>
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
                    <button class="filter-btn ${currentFilter === 'completed' ? 'active' : ''}" onclick="setFilter('completed')">Завершенные</button>
                </div>
                <div class="sort">
                    <select id="sortOrder" onchange="loadTasks()">
                        <option value="created_at-DESC">Сначала новые</option>
                        <option value="created_at-ASC">Сначала старые</option>
                        <option value="priority-DESC">По приоритету</option>
                        <option value="due_date-ASC">По дате</option>
                        <option value="title-ASC">По названию (А-Я)</option>
                    </select>
                </div>
            </div>
            
            <div class="stats" id="stats">
                📊 Загрузка статистики...
            </div>
            
            <div id="tasksList" class="tasks-list">
                <div class="loading-tasks">
                    <div class="spinner-small">⏳</div>
                    <p>Загрузка задач...</p>
                </div>
            </div>
            
            <div id="emptyState" class="empty-state" style="display: none;">
                📝 У вас пока нет задач. Добавьте первую!
            </div>
        </main>
        
        <div class="logout-section">
            <button onclick="logout()" class="logout-btn">🚪 Выйти</button>
        </div>
        
        <footer>
            <p>ToDo List Mini App &copy; ${new Date().getFullYear()}</p>
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
            <p>Войдите через Telegram для использования приложения</p>
            
            <div class="login-options">
                ${window.Telegram && Telegram.WebApp ? `
                    <div class="telegram-login">
                        <p>Вы открыли приложение через Telegram</p>
                        <p class="note">Если авторизация не сработала автоматически:</p>
                        <button onclick="location.reload()" class="refresh-btn">🔄 Обновить страницу</button>
                        <button onclick="testAuth()" class="test-btn">🔧 Тестовая авторизация</button>
                    </div>
                ` : `
                    <div class="web-login">
                        <p>Это приложение работает только через Telegram Mini Apps</p>
                        <p class="note">Откройте его через Telegram бота</p>
                        <a href="https://t.me/your_bot_username" target="_blank" class="telegram-btn">
                            📲 Открыть в Telegram
                        </a>
                    </div>
                `}
            </div>
        </div>
    `;
}

// Рендер экрана ошибки
function renderErrorScreen(message) {
    const app = document.getElementById('app');

    app.innerHTML = `
        <div class="error-screen">
            <h1>⚠️ Ошибка</h1>
            <p>${escapeHtml(message)}</p>
            <button onclick="location.reload()" class="refresh-btn">🔄 Обновить страницу</button>
            <button onclick="window.location.href='/'" class="home-btn">🏠 На главную</button>
        </div>
    `;
}

// Тестовая авторизация
async function testAuth() {
    try {
        const response = await fetch(`${API_BASE}/auth/telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                user: {
                    id: 123456789,
                    first_name: 'Test',
                    last_name: 'User',
                    username: 'testuser'
                }
            })
        });
        
        const data = await response.json();
        if (data.success) {
            location.reload();
        } else {
            showNotification('Тестовая авторизация не удалась', 'error');
        }
    } catch (error) {
        console.error('Test auth error:', error);
        showNotification('Ошибка тестовой авторизации', 'error');
    }
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

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('Tasks loaded:', data);

        if (data.success) {
            currentTasks = data.tasks || [];
            displayTasks(currentTasks);
            updateStats(data.stats);
        } else {
            throw new Error(data.error || 'Failed to load tasks');
        }
    } catch (error) {
        console.error('Load tasks error:', error);
        showNotification('Ошибка загрузки задач: ' + error.message, 'error');
        
        // Показываем пустой список
        const tasksList = document.getElementById('tasksList');
        if (tasksList) {
            tasksList.innerHTML = '<div class="error-message">⚠️ Не удалось загрузить задачи</div>';
        }
    }
}

// Отображение задач
function displayTasks(tasks) {
    const tasksList = document.getElementById('tasksList');
    const emptyState = document.getElementById('emptyState');

    if (!tasksList) return;

    if (!tasks || tasks.length === 0) {
        tasksList.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tasksList.innerHTML = tasks.map(task => `
        <div class="task-item ${task.completed ? 'completed' : ''} 
            ${getPriorityClass(task.priority)}" data-id="${task.id}">
            <div class="checkbox ${task.completed ? 'checked' : ''}" 
                 onclick="toggleTask(${task.id}, ${!task.completed})">
                ${task.completed ? '✓' : ''}
            </div>
            <div class="task-content">
                <div class="task-title">
                    <span>${escapeHtml(task.title)}</span>
                    <span class="priority-badge ${getPriorityBadgeClass(task.priority)}">
                        ${getPriorityText(task.priority)}
                    </span>
                </div>
                ${task.description ? `
                    <div class="task-description">${escapeHtml(task.description)}</div>
                ` : ''}
                <div class="task-meta-info">
                    <span>📅 ${formatDate(task.created_at)}</span>
                    ${task.due_date ? `
                        <span class="due-date ${isOverdue(task.due_date) ? 'overdue' : ''}">
                            ⏰ ${formatDate(task.due_date)}
                            ${isOverdue(task.due_date) ? '(Просрочено)' : ''}
                        </span>
                    ` : ''}
                </div>
            </div>
            <div class="task-actions">
                <button class="edit-btn" onclick="editTask(${task.id})">✏️</button>
                <button class="delete-btn" onclick="deleteTask(${task.id})">🗑️</button>
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

            // Очищаем поля
            titleInput.value = '';
            descriptionInput.value = '';
            prioritySelect.value = '2';
            dueDateInput.value = new Date().toISOString().split('T')[0];
            titleInput.focus();

            // Загружаем обновленный список задач
            await loadTasks();
        } else {
            showNotification('❌ Ошибка: ' + (data.error || 'Неизвестная ошибка'), 'error');
        }
    } catch (error) {
        console.error('Add task error:', error);
        showNotification('❌ Ошибка соединения с сервером', 'error');
    }
}

// Редактирование задачи
async function editTask(taskId) {
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) return;

    // Создаем модальное окно для редактирования
    const modalHtml = `
        <div class="modal" id="editModal">
            <div class="modal-content">
                <h3>✏️ Редактировать задачу</h3>
                <input type="text" id="editTitle" value="${escapeHtml(task.title)}" placeholder="Название задачи...">
                <textarea id="editDescription" placeholder="Описание задачи...">${escapeHtml(task.description || '')}</textarea>
                <div class="task-meta">
                    <select id="editPriority">
                        <option value="3" ${task.priority === 3 ? 'selected' : ''}>🔴 Высокий</option>
                        <option value="2" ${task.priority === 2 ? 'selected' : ''}>🟡 Средний</option>
                        <option value="1" ${task.priority === 1 ? 'selected' : ''}>🟢 Низкий</option>
                    </select>
                    <input type="date" id="editDueDate" value="${task.due_date || new Date().toISOString().split('T')[0]}">
                </div>
                <div class="modal-actions">
                    <button onclick="saveTaskEdit(${taskId})">💾 Сохранить</button>
                    <button onclick="closeModal()" class="cancel">❌ Отмена</button>
                </div>
            </div>
        </div>
    `;

    // Добавляем модальное окно в DOM
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    document.body.appendChild(modalContainer.firstElementChild);

    // Устанавливаем минимальную дату
    const today = new Date().toISOString().split('T')[0];
    const editDueDate = document.getElementById('editDueDate');
    if (editDueDate) {
        editDueDate.min = today;
    }
}

// Сохранение изменений задачи
async function saveTaskEdit(taskId) {
    const title = document.getElementById('editTitle').value.trim();
    const description = document.getElementById('editDescription').value.trim();
    const priority = parseInt(document.getElementById('editPriority').value);
    const due_date = document.getElementById('editDueDate').value || null;

    if (!title) {
        showNotification('Введите название задачи', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PUT',
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

        if (data.success) {
            showNotification('✅ Задача обновлена!', 'success');
            closeModal();
            await loadTasks();
        } else {
            showNotification('❌ Ошибка обновления задачи', 'error');
        }
    } catch (error) {
        console.error('Edit task error:', error);
        showNotification('❌ Ошибка обновления задачи', 'error');
    }
}

// Удаление задачи
async function deleteTask(taskId) {
    if (!confirm('Вы уверены, что хотите удалить эту задачу?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('🗑️ Задача удалена', 'success');
            await loadTasks();
        } else {
            showNotification('❌ Ошибка удаления задачи', 'error');
        }
    } catch (error) {
        console.error('Delete task error:', error);
        showNotification('❌ Ошибка удаления задачи', 'error');
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
        console.error('Toggle task error:', error);
        showNotification('❌ Ошибка обновления задачи', 'error');
    }
}

// Установка фильтра
function setFilter(filter) {
    currentFilter = filter;

    // Обновляем активные кнопки
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    const activeBtn = document.querySelector(`button[onclick="setFilter('${filter}')"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    loadTasks();
}

// Обновление статистики
function updateStats(stats) {
    const statsElement = document.getElementById('stats');
    if (statsElement && stats) {
        statsElement.innerHTML = `
            📊 <span id="totalTasks">${stats.total || 0}</span> задач всего, 
            <span id="activeTasks">${stats.active || 0}</span> активных, 
            <span id="completedTasks">${stats.completed || 0}</span> завершено
        `;
    }
}

// Выход
async function logout() {
    if (!confirm('Вы уверены, что хотите выйти? Все задачи сохранятся.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });

        const data = await response.json();
        
        if (data.success) {
            showNotification('🚪 Вы вышли из системы', 'info');
            setTimeout(() => {
                location.reload();
            }, 1000);
        } else {
            showNotification('❌ Ошибка выхода', 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showNotification('❌ Ошибка выхода', 'error');
    }
}

// Вспомогательные функции
function closeModal() {
    const modal = document.getElementById('editModal');
    if (modal) {
        modal.remove();
    }
}

function getAvatarInitials(firstName, lastName) {
    const first = firstName?.charAt(0) || 'U';
    const last = lastName?.charAt(0) || '';
    return first + last;
}

function getPriorityClass(priority) {
    switch (parseInt(priority)) {
        case 3: return 'high-priority';
        case 2: return 'medium-priority';
        default: return '';
    }
}

function getPriorityBadgeClass(priority) {
    switch (parseInt(priority)) {
        case 3: return 'priority-high';
        case 2: return 'priority-medium';
        default: return 'priority-low';
    }
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
    // В Telegram Mini App используем встроенные уведомления
    if (window.Telegram && Telegram.WebApp) {
        if (type === 'error') {
            Telegram.WebApp.showAlert(message);
        } else {
            Telegram.WebApp.showPopup({
                title: type === 'success' ? '✅ Успешно' : type === 'warning' ? '⚠️ Внимание' : 'ℹ️ Информация',
                message: message,
                buttons: [{ type: 'ok' }]
            });
        }
    } else {
        alert(message);
    }
}

// Глобальные функции для использования в HTML
window.addTask = addTask;
window.logout = logout;
window.setFilter = setFilter;
window.toggleTask = toggleTask;
window.editTask = editTask;
window.deleteTask = deleteTask;
window.saveTaskEdit = saveTaskEdit;
window.closeModal = closeModal;
window.testAuth = testAuth;
