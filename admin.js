// Authentication Configuration
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'Bargh@2025' // رمز عبور: Bargh@2025
};

// Check if admin is logged in
function isAdminLoggedIn() {
    return sessionStorage.getItem('adminLoggedIn') === 'true';
}

function setAdminLoggedIn() {
    sessionStorage.setItem('adminLoggedIn', 'true');
}

function logoutAdmin() {
    sessionStorage.removeItem('adminLoggedIn');
    location.reload();
}

// Handle Login
document.addEventListener('DOMContentLoaded', () => {
    const loginPage = document.getElementById('login-page');
    const adminDashboard = document.getElementById('admin-dashboard');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    
    // Check if already logged in
    if (isAdminLoggedIn()) {
        loginPage.classList.add('hidden');
        adminDashboard.style.display = 'flex';
        initializeAdmin();
    }
    
    // Handle login form submission
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const username = document.getElementById('admin-username').value;
        const password = document.getElementById('admin-password').value;
        
        if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
            // Login successful
            setAdminLoggedIn();
            loginPage.classList.add('hidden');
            adminDashboard.style.display = 'flex';
            loginError.classList.remove('show');
            initializeAdmin();
        } else {
            // Login failed
            loginError.classList.add('show');
            document.getElementById('admin-password').value = '';
            document.getElementById('admin-password').focus();
            
            // Hide error after 3 seconds
            setTimeout(() => {
                loginError.classList.remove('show');
            }, 3000);
        }
    });
});

// Initialize admin panel after successful login
function initializeAdmin() {
    // Socket connection will be initialized here
    // Force socket to connect if not already connected
    if (socket.connected) {
        socket.emit('admin-connect');
    }
    
    // Initialize UI
    updateUI();
    addLog('پنل ادمین راه‌اندازی شد', 'info');
}

// Connect to Socket.IO server
const socket = io();

// DOM Elements
const elements = {
    gameStatusBadge: document.getElementById('gameStatusBadge'),
    totalPlayers: document.getElementById('totalPlayers'),
    activePlayers: document.getElementById('activePlayers'),
    currentQuestion: document.getElementById('currentQuestion'),
    totalQuestions: document.getElementById('totalQuestions'),
    startGameBtn: document.getElementById('startGameBtn'),
    nextQuestionBtn: document.getElementById('nextQuestionBtn'),
    resetGameBtn: document.getElementById('resetGameBtn'),
    activePlayersList: document.getElementById('activePlayersList'),
    winnersList: document.getElementById('winnersList'),
    eliminatedList: document.getElementById('eliminatedList'),
    activityLog: document.getElementById('activityLog'),
    activePlayersBadge: document.getElementById('activePlayersBadge'),
    winnersBadge: document.getElementById('winnersBadge'),
    eliminatedBadge: document.getElementById('eliminatedBadge'),
    connectionIndicator: document.getElementById('connectionIndicator'),
    connectionStatus: document.getElementById('connectionStatus')
};

// Game State
let gameState = {
    status: 'waiting',
    players: [],
    winners: [],
    eliminated: [],
    currentQuestion: 0,
    totalQuestions: 10
};

// Initialize
socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
    
    // Only emit admin-connect if logged in
    if (isAdminLoggedIn()) {
        socket.emit('admin-connect');
        addLog('اتصال به سرور برقرار شد', 'success');
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
    addLog('اتصال به سرور قطع شد', 'error');
});

// Socket Event Listeners
socket.on('game-state-update', (data) => {
    console.log('Game state update:', data);
    gameState = {
        status: data.status,
        players: data.players || [],
        winners: data.winners || [],
        eliminated: data.eliminated || [],
        currentQuestion: data.currentQuestion,
        totalQuestions: data.totalQuestions
    };
    updateUI();
});

socket.on('player-joined', (data) => {
    console.log('Player joined:', data);
    addLog(`بازیکن جدید: ${data.player.firstName} ${data.player.lastName}`, 'success');
    elements.totalPlayers.textContent = data.totalPlayers;
    
    // Add player to list
    if (!gameState.players.find(p => p.socketId === data.player.socketId)) {
        gameState.players.push(data.player);
        updatePlayersList();
        updateButtons(); // Update buttons to enable/disable based on player count
    }
});

socket.on('player-left', (data) => {
    console.log('Player left:', data);
    addLog(`بازیکن خارج شد: ${data.player.firstName} ${data.player.lastName}`, 'info');
    elements.totalPlayers.textContent = data.totalPlayers;
    
    // Remove player from list
    gameState.players = gameState.players.filter(p => 
        p.studentId !== data.player.studentId
    );
    updatePlayersList();
    updateButtons(); // Update buttons when player leaves
});

socket.on('game-started', (data) => {
    console.log('Game started:', data);
    gameState.status = 'playing';
    addLog('🚀 بازی شروع شد!', 'success');
    updateUI();
});

socket.on('question-sent', (data) => {
    console.log('Question sent:', data);
    gameState.currentQuestion = data.questionNumber;
    addLog(`سوال ${data.questionNumber} ارسال شد (${data.activePlayers} بازیکن فعال)`, 'info');
    updateUI();
});

socket.on('player-eliminated', (data) => {
    console.log('Player eliminated:', data);
    const reason = data.reason === 'timeout' ? '(زمان تمام شد)' : '(پاسخ اشتباه)';
    addLog(`❌ ${data.player.firstName} ${data.player.lastName} حذف شد ${reason}`, 'error');
    
    // Move player to eliminated list
    const player = gameState.players.find(p => p.studentId === data.player.studentId);
    if (player) {
        player.status = 'eliminated';
        gameState.eliminated.push({
            ...data.player,
            reason: data.reason
        });
    }
    
    updateUI();
});

socket.on('game-ended', (data) => {
    console.log('Game ended:', data);
    gameState.status = 'finished';
    gameState.winners = data.winners;
    gameState.eliminated = data.eliminated;
    addLog(`🏁 بازی به پایان رسید! تعداد برندگان: ${data.winners.length}`, 'success');
    updateUI();
});

socket.on('game-reset', (data) => {
    console.log('Game reset');
    // Don't clear players here - wait for game-state-update from server
    gameState.status = 'waiting';
    gameState.winners = [];
    gameState.eliminated = [];
    gameState.currentQuestion = 0;
    addLog('🔄 بازی ریست شد', 'info');
    updateButtons(); // Update buttons immediately after reset
    // Full updateUI will be called when game-state-update arrives
});

socket.on('error', (data) => {
    console.error('Error:', data);
    addLog(`خطا: ${data.message}`, 'error');
    alert(data.message);
});

// Button Event Listeners
elements.startGameBtn.addEventListener('click', () => {
    if (gameState.players.length === 0) {
        alert('هیچ بازیکنی در اتاق انتظار نیست!');
        return;
    }
    
    if (confirm(`آیا می‌خواهید بازی را با ${gameState.players.length} بازیکن شروع کنید؟`)) {
        socket.emit('admin-start-game');
        addLog('درخواست شروع بازی ارسال شد...', 'info');
    }
});

elements.nextQuestionBtn.addEventListener('click', () => {
    socket.emit('admin-next-question');
    addLog('درخواست سوال بعدی ارسال شد...', 'info');
});

elements.resetGameBtn.addEventListener('click', () => {
    if (confirm('آیا مطمئن هستید که می‌خواهید بازی را ریست کنید؟')) {
        socket.emit('admin-reset-game');
        addLog('درخواست ریست بازی ارسال شد...', 'info');
    }
});

// UI Update Functions
function updateUI() {
    updateGameStatus();
    updateStats();
    updatePlayersList();
    updateWinnersList();
    updateEliminatedList();
    updateButtons();
}

function updateGameStatus() {
    const status = gameState.status;
    const badge = elements.gameStatusBadge;
    
    badge.className = 'status-badge';
    
    if (status === 'waiting') {
        badge.classList.add('status-waiting');
        badge.textContent = 'در انتظار';
    } else if (status === 'playing') {
        badge.classList.add('status-playing');
        badge.textContent = 'در حال بازی';
    } else if (status === 'finished') {
        badge.classList.add('status-finished');
        badge.textContent = 'پایان یافته';
    }
}

function updateStats() {
    const activePlayers = gameState.players.filter(p => p.status === 'playing').length;
    
    elements.totalPlayers.textContent = gameState.players.length;
    elements.activePlayers.textContent = activePlayers;
    elements.currentQuestion.textContent = gameState.currentQuestion;
    elements.totalQuestions.textContent = gameState.totalQuestions;
}

function updatePlayersList() {
    const activePlayers = gameState.players.filter(p => 
        p.status === 'waiting' || p.status === 'playing'
    );
    
    console.log('Updating players list:', {
        totalPlayers: gameState.players.length,
        activePlayers: activePlayers.length,
        players: gameState.players
    });
    
    elements.activePlayersBadge.textContent = activePlayers.length;
    
    if (activePlayers.length === 0) {
        elements.activePlayersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <p>هیچ بازیکن فعالی وجود ندارد</p>
            </div>
        `;
        return;
    }
    
    elements.activePlayersList.innerHTML = activePlayers.map(player => `
        <div class="player-item">
            <div class="player-name">${player.firstName} ${player.lastName}</div>
            <div class="player-id">شماره دانشجویی: ${player.studentId}</div>
            <div class="player-stats">
                <div class="player-stat">
                    <span class="player-stat-label">وضعیت</span>
                    <span class="player-stat-value">${getStatusText(player.status)}</span>
                </div>
                <div class="player-stat">
                    <span class="player-stat-label">پاسخ صحیح</span>
                    <span class="player-stat-value">${player.correctAnswers || 0}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function updateWinnersList() {
    console.log('Updating winners list:', gameState.winners);
    
    elements.winnersBadge.textContent = gameState.winners.length;
    
    if (gameState.winners.length === 0) {
        elements.winnersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🏆</div>
                <p>هنوز برنده‌ای نداریم</p>
            </div>
        `;
        return;
    }
    
    elements.winnersList.innerHTML = gameState.winners.map((winner, index) => `
        <div class="winner-item">
            <div class="player-name">🏆 ${index + 1}. ${winner.firstName} ${winner.lastName}</div>
            <div class="player-id">شماره دانشجویی: ${winner.studentId}</div>
            <div class="player-stats">
                <div class="player-stat">
                    <span class="player-stat-label">پاسخ صحیح</span>
                    <span class="player-stat-value">${winner.correctAnswers}</span>
                </div>
            </div>
        </div>
    `).join('');
}

function updateEliminatedList() {
    console.log('Updating eliminated list:', gameState.eliminated);
    
    elements.eliminatedBadge.textContent = gameState.eliminated.length;
    
    if (gameState.eliminated.length === 0) {
        elements.eliminatedList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <p>هیچ بازیکنی حذف نشده</p>
            </div>
        `;
        return;
    }
    
    elements.eliminatedList.innerHTML = gameState.eliminated.map(player => `
        <div class="player-item">
            <div class="player-name">❌ ${player.firstName} ${player.lastName}</div>
            <div class="player-id">شماره دانشجویی: ${player.studentId}</div>
            <div class="player-stats">
                <div class="player-stat">
                    <span class="player-stat-label">پاسخ صحیح</span>
                    <span class="player-stat-value">${player.correctAnswers || 0}</span>
                </div>
                <div class="player-stat">
                    <span class="player-stat-label">حذف در سوال</span>
                    <span class="player-stat-value">${player.eliminatedAtQuestion || '-'}</span>
                </div>
                ${player.reason ? `
                <div class="player-stat">
                    <span class="player-stat-label">دلیل</span>
                    <span class="player-stat-value">${player.reason === 'timeout' ? 'تایم اوت' : 'پاسخ اشتباه'}</span>
                </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function updateButtons() {
    const status = gameState.status;
    
    if (status === 'waiting') {
        elements.startGameBtn.disabled = gameState.players.length === 0;
        elements.nextQuestionBtn.disabled = true;
    } else if (status === 'playing') {
        elements.startGameBtn.disabled = true;
        elements.nextQuestionBtn.disabled = false;
    } else if (status === 'finished') {
        elements.startGameBtn.disabled = true;
        elements.nextQuestionBtn.disabled = true;
    }
}

function updateConnectionStatus(connected) {
    if (connected) {
        elements.connectionIndicator.classList.remove('disconnected');
        elements.connectionIndicator.classList.add('connected');
        elements.connectionStatus.textContent = 'متصل';
    } else {
        elements.connectionIndicator.classList.remove('connected');
        elements.connectionIndicator.classList.add('disconnected');
        elements.connectionStatus.textContent = 'قطع شده';
    }
}

function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString('fa-IR');
    const logClass = `log-${type}`;
    
    const logItem = document.createElement('div');
    logItem.className = `log-item ${logClass}`;
    logItem.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span>${message}</span>
    `;
    
    elements.activityLog.insertBefore(logItem, elements.activityLog.firstChild);
    
    // Keep only last 50 logs
    while (elements.activityLog.children.length > 50) {
        elements.activityLog.removeChild(elements.activityLog.lastChild);
    }
}

function getStatusText(status) {
    const statusMap = {
        'waiting': 'در انتظار',
        'playing': 'در حال بازی',
        'eliminated': 'حذف شده',
        'winner': 'برنده'
    };
    return statusMap[status] || status;
}

// Initialize UI
updateUI();
addLog('پنل ادمین راه‌اندازی شد', 'info');

