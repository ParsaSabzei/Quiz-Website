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
    activePlayersBadge: document.getElementById('activePlayersBadge'),
    winnersBadge: document.getElementById('winnersBadge'),
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
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus(false);
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
    updateUI();
});

socket.on('question-sent', (data) => {
    console.log('Question sent:', data);
    gameState.currentQuestion = data.questionNumber;
    updateUI();
});

socket.on('player-eliminated', (data) => {
    console.log('Player eliminated:', data);
    
    // REAL-TIME UPDATE: Update player in local state
    const player = gameState.players.find(p => p.studentId === data.player.studentId);
    if (player) {
        player.status = 'eliminated';
        player.correctAnswers = data.player.correctAnswers;
        gameState.eliminated.push({
            ...data.player,
            reason: data.reason
        });
    }
    
    // Update active players count
    elements.activePlayers.textContent = data.remainingPlayers;
    
    // Immediate UI update without full refresh
    updatePlayersList();
    updateStats();
});

// REAL-TIME UPDATE: Listen for score updates
socket.on('player-score-updated', (data) => {
    console.log('Player score updated:', data);
    
    // Find and update player in local state
    const player = gameState.players.find(p => p.studentId === data.studentId);
    if (player) {
        player.correctAnswers = data.correctAnswers;
        player.status = data.status;
    }
    
    // Immediate UI update - just update the rankings, no full refresh
    updatePlayersList();
});

socket.on('game-ended', (data) => {
    console.log('Game ended:', data);
    gameState.status = 'finished';
    gameState.winners = data.winners;
    gameState.eliminated = data.eliminated;
    updateUI();
});

socket.on('game-reset', (data) => {
    console.log('Game reset');
    // Clear game state completely
    gameState.status = 'waiting';
    gameState.winners = [];
    gameState.eliminated = [];
    gameState.currentQuestion = 0;
    // Clear ACK tracking
    hideAckStatus();
    // Update UI immediately to show empty rankings and winners
    updateUI();
});

// ACK tracking events
socket.on('game-start-sent', (data) => {
    console.log('Game start sent to', data.sentCount, 'players');
    showAckStatus('شروع بازی', data.totalPlayers, data.ackedCount);
});

socket.on('game-start-ack-update', (data) => {
    console.log('Player ACKed game start:', data.playerName);
    updateAckStatus(data.ackedCount, data.totalPlayers);
});

socket.on('game-start-ack-report', (data) => {
    console.log('Game start ACK report:', data);
    updateAckStatus(data.ackedCount, data.totalPlayers);
    
    if (data.missingCount > 0) {
        showNotification(`⚠️ ${data.missingCount} بازیکن شروع بازی را دریافت نکردند!`, 'warning');
    } else {
        showNotification(`✅ همه بازیکنان وارد بازی شدند!`, 'success');
    }
    
    // Hide ACK status after 3 seconds
    setTimeout(hideAckStatus, 3000);
});

socket.on('question-sent', (data) => {
    console.log('Question sent:', data);
    showAckStatus(`سوال ${data.questionNumber}`, data.activePlayers, data.ackedCount);
});

socket.on('question-ack-update', (data) => {
    console.log('Player ACKed question:', data.playerName);
    updateAckStatus(data.ackedCount, data.totalActivePlayers);
});

socket.on('question-ack-report', (data) => {
    console.log('Question ACK report:', data);
    updateAckStatus(data.ackedCount, data.totalActivePlayers);
    
    if (data.missingCount > 0) {
        showNotification(`⚠️ ${data.missingCount} بازیکن سوال ${data.questionNumber} را دریافت نکردند!`, 'warning');
    } else {
        showNotification(`✅ همه بازیکنان سوال ${data.questionNumber} را دریافت کردند!`, 'success');
    }
    
    // Hide ACK status after 3 seconds
    setTimeout(hideAckStatus, 3000);
});

socket.on('error', (data) => {
    console.error('Error:', data);
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
    }
});

elements.nextQuestionBtn.addEventListener('click', () => {
    socket.emit('admin-next-question');
});

elements.resetGameBtn.addEventListener('click', () => {
    if (confirm('آیا مطمئن هستید که می‌خواهید بازی را ریست کنید؟')) {
        socket.emit('admin-reset-game');
    }
});

// UI Update Functions
function updateUI() {
    updateGameStatus();
    updateStats();
    updatePlayersList();
    updateWinnersList();
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
    // Count players who are NOT eliminated (includes 'waiting', 'playing', and 'winner')
    const activePlayers = gameState.players.filter(p => p.status !== 'eliminated').length;
    
    elements.totalPlayers.textContent = gameState.players.length;
    elements.activePlayers.textContent = activePlayers;
    elements.currentQuestion.textContent = gameState.currentQuestion;
    elements.totalQuestions.textContent = gameState.totalQuestions;
}

function updatePlayersList() {
    // If game is in waiting status, show empty state (rankings only show during/after game)
    if (gameState.status === 'waiting') {
        elements.activePlayersBadge.textContent = 0;
        elements.activePlayersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>رنک‌بندی پس از شروع بازی نمایش داده می‌شود</p>
            </div>
        `;
        return;
    }
    
    // Get all players (including eliminated) and sort by correctAnswers
    const allPlayers = gameState.players;
    const sortedPlayers = [...allPlayers].sort((a, b) => (b.correctAnswers || 0) - (a.correctAnswers || 0));
    
    elements.activePlayersBadge.textContent = allPlayers.length;
    
    if (sortedPlayers.length === 0) {
        elements.activePlayersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>هنوز بازیکنی وجود ندارد</p>
            </div>
        `;
        return;
    }
    
    // OPTIMIZED: Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');
    
    tempDiv.innerHTML = sortedPlayers.map((player, index) => `
        <div class="player-item" data-student-id="${player.studentId}" style="${player.status === 'eliminated' ? 'opacity: 0.7; border-color: var(--danger-red);' : ''}">
            <div class="player-name">
                ${index + 1}. ${player.firstName} ${player.lastName}
                ${player.status === 'eliminated' ? '<span style="color: var(--danger-red); margin-right: 10px;">❌</span>' : ''}
                ${player.status === 'winner' ? '<span style="color: var(--yellow); margin-right: 10px;">🏆</span>' : ''}
            </div>
            <div class="player-id">شماره دانشجویی: ${player.studentId}</div>
            <div class="player-stats">
                <div class="player-stat">
                    <span class="player-stat-label">پاسخ صحیح</span>
                    <span class="player-stat-value" style="color: ${player.status === 'eliminated' ? 'var(--danger-red)' : 'var(--success-green)'}; font-size: 1.3rem; font-weight: 700;">${player.correctAnswers || 0}</span>
                </div>
                <div class="player-stat">
                    <span class="player-stat-label">وضعیت</span>
                    <span class="player-stat-value">${getStatusText(player.status)}</span>
                </div>
            </div>
        </div>
    `).join('');
    
    // Clear and update in one operation
    elements.activePlayersList.innerHTML = '';
    elements.activePlayersList.appendChild(tempDiv);
}

function updateWinnersList() {
    elements.winnersBadge.textContent = gameState.winners.length;
    
    // Always show empty state if no winners (whether waiting, playing, or finished)
    if (gameState.winners.length === 0) {
        const emptyMessage = gameState.status === 'waiting' 
            ? 'برنده‌ها پس از پایان بازی نمایش داده می‌شوند'
            : 'هنوز برنده‌ای نداریم';
        
        elements.winnersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🏆</div>
                <p>${emptyMessage}</p>
            </div>
        `;
        return;
    }
    
    // OPTIMIZED: Build HTML string once
    const winnersHTML = gameState.winners.map((winner, index) => `
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
    
    elements.winnersList.innerHTML = winnersHTML;
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

function getStatusText(status) {
    const statusMap = {
        'waiting': 'در انتظار',
        'playing': 'در حال بازی',
        'eliminated': 'حذف شده',
        'winner': 'برنده'
    };
    return statusMap[status] || status;
}

// ACK Status Display Functions
function showAckStatus(eventName, totalPlayers, ackedCount) {
    let ackStatusEl = document.getElementById('ack-status');
    
    if (!ackStatusEl) {
        ackStatusEl = document.createElement('div');
        ackStatusEl.id = 'ack-status';
        ackStatusEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(10, 25, 47, 0.95);
            border: 2px solid var(--electric-blue);
            border-radius: 15px;
            padding: 20px 30px;
            z-index: 2000;
            box-shadow: 0 10px 40px rgba(0, 212, 255, 0.5);
            min-width: 300px;
        `;
        document.body.appendChild(ackStatusEl);
    }
    
    ackStatusEl.innerHTML = `
        <div style="color: var(--electric-blue); font-size: 1rem; margin-bottom: 10px; font-weight: 600;">
            📡 ${eventName}
        </div>
        <div style="color: var(--text-light); font-size: 1.5rem; font-weight: 700;">
            <span id="ack-count">${ackedCount}</span> / <span id="ack-total">${totalPlayers}</span>
        </div>
        <div style="margin-top: 10px;">
            <div style="background: rgba(255,255,255,0.1); height: 10px; border-radius: 5px; overflow: hidden;">
                <div id="ack-progress" style="background: var(--success-green); height: 100%; width: ${(ackedCount/totalPlayers)*100}%; transition: width 0.3s ease;"></div>
            </div>
        </div>
    `;
    
    ackStatusEl.style.display = 'block';
}

function updateAckStatus(ackedCount, totalPlayers) {
    const ackCountEl = document.getElementById('ack-count');
    const ackTotalEl = document.getElementById('ack-total');
    const ackProgressEl = document.getElementById('ack-progress');
    
    if (ackCountEl && ackTotalEl && ackProgressEl) {
        ackCountEl.textContent = ackedCount;
        ackTotalEl.textContent = totalPlayers;
        ackProgressEl.style.width = `${(ackedCount/totalPlayers)*100}%`;
    }
}

function hideAckStatus() {
    const ackStatusEl = document.getElementById('ack-status');
    if (ackStatusEl) {
        ackStatusEl.style.display = 'none';
    }
}

function showNotification(message, type = 'info') {
    const notificationEl = document.createElement('div');
    notificationEl.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${type === 'success' ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 215, 0, 0.2)'};
        border: 2px solid ${type === 'success' ? 'var(--success-green)' : 'var(--yellow)'};
        color: ${type === 'success' ? 'var(--success-green)' : 'var(--yellow)'};
        border-radius: 12px;
        padding: 15px 25px;
        z-index: 2001;
        box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
        font-weight: 600;
        animation: slideIn 0.3s ease;
    `;
    notificationEl.textContent = message;
    document.body.appendChild(notificationEl);
    
    setTimeout(() => {
        notificationEl.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notificationEl);
        }, 300);
    }, 5000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Initialize UI
updateUI();

