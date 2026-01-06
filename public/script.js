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
        
        // Получаем данные пользователя
        const tgUser = Telegram.WebApp.initDataUnsafe.user;
        const initData = Telegram.WebApp.initData;
        
        console.log('Telegram user:', tgUser);
        console.log('Init data:', initData);
        
        if (tgUser && initData) {
            // Авторизуемся через упрощенный метод
            await simpleAuth(tgUser);
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
            credentials: 'include', // Важно для сессий
            body: JSON.stringify({
                user: tgUser
            })
        });

        const data = await response.json();
        console.log('Auth response:', data);
        
        if (data.success) {
            currentUser = data.user;
            return true;
        }
        return false;
    } catch (error) {
        console.error('Auth error:', error);
        return false;
    }
}

// Загрузка основного интерфейса
async function loadApp() {
    const app = document.getElementById('app');
    
    // Показываем заглушку
    app.innerHTML = `
        <div class="loading">
            <h2>📝 ToDo List</h2>
            <p>Загрузка...</p>
        </div>
    `;

    try {
        // Сначала проверяем существующую сессию
        const checkResponse = await fetch(`${API_BASE}/auth/check`, {
            credentials: 'include' // Важно для сессий
        });
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
            console.log('Telegram user detected:', tgUser);
            
            const authSuccess = await simpleAuth(tgUser);
            if (authSuccess) {
                renderMainApp();
                await loadTasks();
                return;
            }
        }
        
        // Если ничего не сработало, показываем экран входа
        renderLoginScreen();
        
    } catch (error) {
        console.error('Load app error:', error);
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
                    <p>@${escapeHtml(currentUser.username || 'user')}</p>
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
                Загрузка статистики...
            </div>
            
            <div id="tasksList" class="tasks-list">
                <!-- Задачи будут загружены здесь -->
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

    // Устанавливаем минимальную дату
    const today = new Date().toISOString().split('T')[0];
    const dueDateInput = document.getElementById('taskDueDate');
    if (dueDateInput) {
        dueDateInput.min = today;
        dueDateInput.value = today;
    }
}

// Добавление задачи (ИСПРАВЛЕННАЯ ВЕРСИЯ)
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
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // ВАЖНО ДЛЯ СЕССИЙ!
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
            showNotification('Задача добавлена!', 'success');

            // Очищаем поля
            titleInput.value = '';
            descriptionInput.value = '';
            prioritySelect.value = '2';
            dueDateInput.value = new Date().toISOString().split('T')[0];

            // Загружаем обновленный список задач
            await loadTasks();
        } else {
            console.error('Server error:', data.error);
            showNotification('Ошибка: ' + (data.error || 'Неизвестная ошибка'), 'error');
        }
    } catch (error) {
        console.error('Add task error:', error);
        showNotification('Ошибка соединения', 'error');
    }
}

// Загрузка задач (ИСПРАВЛЕННАЯ ВЕРСИЯ)
async function loadTasks() {
    try {
        const sortSelect = document.getElementById('sortOrder');
        const [order, direction] = sortSelect ? sortSelect.value.split('-') : ['created_at', 'DESC'];

        const response = await fetch(
            `${API_BASE}/tasks?filter=${currentFilter}&order=${order}&direction=${direction}`,
            {
                credentials: 'include' // ВАЖНО ДЛЯ СЕССИЙ!
            }
        );

        const data = await response.json();
        console.log('Tasks loaded:', data);

        if (data.success) {
            currentTasks = data.tasks || [];
            displayTasks(currentTasks);
            updateStats(data.stats);
        } else {
            console.error('Failed to load tasks:', data.error);
            if (data.error === 'Not authenticated') {
                showNotification('Сессия истекла, обновите страницу', 'warning');
            }
        }
    } catch (error) {
        console.error('Load tasks error:', error);
        showNotification('Ошибка загрузки задач', 'error');
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
            showNotification('Вы вышли из системы', 'info');
            setTimeout(() => {
                location.reload();
            }, 1000);
        }
    } catch (error) {
        console.error('Logout error:', error);
        showNotification('Ошибка выхода', 'error');
    }
}
