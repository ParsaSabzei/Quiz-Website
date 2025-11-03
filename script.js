// Connect to Socket.IO server with optimized settings for reliability
const socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    transports: ['websocket', 'polling'],
    upgrade: true
});

// Game State
let gameState = {
    sessionId: null,
    player: {
        firstName: '',
        lastName: '',
        studentId: ''
    },
    currentQuestion: null,
    currentQuestionNumber: 0,
    totalQuestions: 10,
    correctAnswers: 0,
    timer: null,
    timeLeft: 15,
    isConnected: false,
    playerStatus: 'not-registered', // not-registered, waiting, playing, eliminated, winner
    statusCheckInterval: null // For polling game status
};

// DOM Elements
const pages = {
    registration: document.getElementById('registration-page'),
    waiting: document.getElementById('waiting-page'),
    quiz: document.getElementById('quiz-page'),
    eliminated: document.getElementById('eliminated-page'),
    winner: document.getElementById('winner-page')
};

// Session Management
function saveSession() {
    const sessionData = {
        sessionId: gameState.sessionId,
        player: gameState.player,
        playerStatus: gameState.playerStatus,
        correctAnswers: gameState.correctAnswers
    };
    localStorage.setItem('quizSession', JSON.stringify(sessionData));
}

function loadSession() {
    const sessionData = localStorage.getItem('quizSession');
    if (sessionData) {
        try {
            return JSON.parse(sessionData);
        } catch (e) {
            console.error('Failed to parse session data:', e);
            localStorage.removeItem('quizSession');
        }
    }
    return null;
}

function clearSession() {
    localStorage.removeItem('quizSession');
}

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupSocketListeners();
    
    // Check if user wants to clear session (for new player in same browser)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('new') === 'true') {
        console.log('Clearing session for new player...');
        clearSession();
        // Remove query parameter from URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Try to restore session
    const savedSession = loadSession();
    if (savedSession && savedSession.sessionId) {
        console.log('Found existing session, attempting to reconnect...', savedSession);
        gameState.sessionId = savedSession.sessionId;
        gameState.player = savedSession.player;
        gameState.playerStatus = savedSession.playerStatus;
        gameState.correctAnswers = savedSession.correctAnswers || 0;
    }
});

// Socket Connection Events
socket.on('connect', () => {
    console.log('Connected to server');
    gameState.isConnected = true;
    
    // If we have a session, try to reconnect
    if (gameState.sessionId && gameState.player.studentId) {
        console.log('Attempting to reconnect with session:', gameState.sessionId);
        socket.emit('player-reconnect', {
            sessionId: gameState.sessionId,
            studentId: gameState.player.studentId,
            firstName: gameState.player.firstName,
            lastName: gameState.player.lastName
        });
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    gameState.isConnected = false;
});

socket.on('reconnect', (attemptNumber) => {
    console.log(`Reconnected to server after ${attemptNumber} attempts`);
    gameState.isConnected = true;
    
    // Try to restore session
    if (gameState.sessionId && gameState.player.studentId) {
        console.log('Attempting to reconnect with session:', gameState.sessionId);
        socket.emit('player-reconnect', {
            sessionId: gameState.sessionId,
            studentId: gameState.player.studentId,
            firstName: gameState.player.firstName,
            lastName: gameState.player.lastName
        });
    }
});

socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`Reconnection attempt ${attemptNumber}...`);
});

socket.on('reconnect_error', (error) => {
    console.error('Reconnection error:', error);
});

socket.on('registration-success', (data) => {
    console.log('✅ Registration successful:', data);
    console.log('Player:', gameState.player);
    gameState.sessionId = data.sessionId;
    gameState.playerStatus = data.status || 'waiting';
    saveSession();
    console.log('Session saved. Current status:', gameState.playerStatus);
    
    // Start polling for game status changes
    startStatusPolling();
    
    // Stay in waiting page until game starts
});

socket.on('registration-failed', (data) => {
    console.log('Registration failed:', data);
    alert(data.message);
    // Stay on registration page
    showPage('registration');
});

socket.on('reconnect-success', (data) => {
    console.log('Reconnection successful:', data);
    gameState.playerStatus = data.status;
    gameState.correctAnswers = data.correctAnswers || 0;
    
    // Update UI based on current status
    if (data.status === 'eliminated') {
        showEliminatedPage();
        stopStatusPolling();
    } else if (data.status === 'winner') {
        showWinnerPage();
        stopStatusPolling();
    } else if (data.status === 'playing' && data.currentQuestion) {
        // Resume game
        gameState.currentQuestion = data.currentQuestion;
        gameState.currentQuestionNumber = data.questionNumber;
        gameState.totalQuestions = data.totalQuestions;
        showPage('quiz');
        updatePlayerInfo();
        stopStatusPolling();
        
        // Show question with remaining time
        showQuestionWithTimeRemaining(data.currentQuestion.timeRemaining);
    } else if (data.status === 'waiting') {
        showPage('waiting');
        // Start status polling to detect game start
        startStatusPolling();
    }
    
    saveSession();
});

socket.on('reconnect-failed', (data) => {
    console.log('Reconnection failed:', data);
    // Clear invalid session and show registration
    clearSession();
    gameState.sessionId = null;
    gameState.player = { firstName: '', lastName: '', studentId: '' };
    gameState.playerStatus = 'not-registered';
    showPage('registration');
    
    if (data.message) {
        alert(data.message);
    }
});

socket.on('game-started', (data) => {
    console.log('🎮 Game started event received:', data);
    console.log('Current page:', Object.keys(pages).find(key => pages[key].classList.contains('active')));
    gameState.totalQuestions = data.totalQuestions;
    gameState.playerStatus = 'playing';
    saveSession();
    
    // Stop status polling - we're now playing
    stopStatusPolling();
    
    // Send acknowledgment to server
    socket.emit('game-started-ack', {
        sessionId: gameState.sessionId,
        studentId: gameState.player.studentId
    });
    
    // Move to quiz UI immediately; first question will arrive shortly
    if (!pages.quiz.classList.contains('active')) {
        console.log('📄 Switching to quiz page on game start...');
        showPage('quiz');
        updatePlayerInfo();
    }
    console.log('✅ Game state updated, waiting for first question...');
    // Wait for first question
});

socket.on('new-question', (data) => {
    console.log('❓ New question event received:', data);
    console.log('Question ID:', data.question?.id, 'Question Number:', data.questionNumber);
    gameState.currentQuestion = data.question;
    gameState.currentQuestionNumber = data.questionNumber;
    gameState.totalQuestions = data.totalQuestions;
    gameState.playerStatus = 'playing';
    
    // Send acknowledgment to server
    socket.emit('question-received-ack', {
        questionId: data.question.id,
        sessionId: gameState.sessionId,
        studentId: gameState.player.studentId
    });
    
    // Show quiz page if not already shown
    if (!pages.quiz.classList.contains('active')) {
        console.log('📄 Switching to quiz page...');
        showPage('quiz');
        updatePlayerInfo();
    }
    
    console.log('🎯 Showing question...');
    showQuestion();
    saveSession();
    console.log('✅ Question displayed successfully');
});

socket.on('answer-submitted', (data) => {
    console.log('✅ Answer submitted:', data.message);
    // Just show that answer was received, keep waiting for timer
});

socket.on('answer-result', (data) => {
    console.log('📊 Answer result received:', data);
    
    // Stop timer
    if (gameState.timer) {
        clearInterval(gameState.timer);
    }
    
    // Show the correct answer
    const options = document.querySelectorAll('.option');
    options.forEach((opt, index) => {
        opt.classList.add('disabled');
        opt.classList.remove('selected'); // Remove selected state
        if (index === data.correctAnswer) {
            opt.classList.add('correct');
        }
        if (index === data.yourAnswer && !data.correct) {
            opt.classList.add('incorrect');
        }
    });
    
    if (data.eliminated) {
        // Will receive player-eliminated event
        return;
    }
    
    // If correct, wait for next question
    console.log('✅ Correct answer! Waiting for next question...');
});

socket.on('player-eliminated', (data) => {
    console.log('Player eliminated:', data);
    gameState.correctAnswers = data.correctAnswers;
    gameState.playerStatus = 'eliminated';
    saveSession();
    
    if (gameState.timer) {
        clearInterval(gameState.timer);
    }
    
    setTimeout(() => {
        showEliminatedPage();
    }, 500);
});

socket.on('game-won', (data) => {
    console.log('Player won:', data);
    gameState.correctAnswers = data.correctAnswers;
    gameState.playerStatus = 'winner';
    saveSession();
    
    if (gameState.timer) {
        clearInterval(gameState.timer);
    }
    
    setTimeout(() => {
        showWinnerPage();
    }, 500);
});

socket.on('game-finished', (data) => {
    console.log('Game finished:', data);
});

socket.on('game-reset', (data) => {
    console.log('Game reset - returning to waiting room');
    
    // Update player status to waiting (keep session)
    gameState.playerStatus = 'waiting';
    gameState.player.correctAnswers = 0;
    saveSession();
    
    // Restart status polling
    startStatusPolling();
    
    // Go to waiting page
    showPage('waiting');
    updatePlayerInfo();
});

socket.on('game-status-response', (data) => {
    console.log('📊 Game status response:', data);
    
    // If game has started and we're still in waiting, transition to playing
    if (data.gameStatus === 'playing' && gameState.playerStatus === 'waiting') {
        console.log('⚠️ Detected game start via polling! Transitioning to playing...');
        
        gameState.playerStatus = 'playing';
        gameState.totalQuestions = data.totalQuestions || 10;
        saveSession();
        
        // Stop polling
        stopStatusPolling();
        
        // Move to quiz page
        if (!pages.quiz.classList.contains('active')) {
            showPage('quiz');
            updatePlayerInfo();
        }
        
        // If there's a current question, show it
        if (data.currentQuestion) {
            gameState.currentQuestion = data.currentQuestion;
            gameState.currentQuestionNumber = data.currentQuestionNumber;
            showQuestion();
        }
    }
});

socket.on('error', (data) => {
    console.error('Server error:', data);
    alert(`خطا: ${data.message}`);
});

// Setup Event Listeners
function setupEventListeners() {
    const registrationForm = document.getElementById('registration-form');
    registrationForm.addEventListener('submit', handleRegistration);
}

function setupSocketListeners() {
    // Already set up above
}

// Handle Registration
function handleRegistration(e) {
    e.preventDefault();
    
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const studentId = document.getElementById('studentId').value.trim();
    
    if (!firstName || !lastName || !studentId) {
        alert('لطفا همه فیلدها را پر کنید');
        return;
    }
    
    if (!gameState.isConnected) {
        alert('لطفا صبر کنید، در حال اتصال به سرور...');
        return;
    }
    
    gameState.player = { firstName, lastName, studentId };
    gameState.sessionId = generateSessionId();
    
    // Send registration to server
    socket.emit('player-register', {
        sessionId: gameState.sessionId,
        firstName,
        lastName,
        studentId
    });
    
    // Show waiting page
    showPage('waiting');
}

// Show Page
function showPage(pageName) {
    Object.keys(pages).forEach(key => {
        pages[key].classList.remove('active');
    });
    pages[pageName].classList.add('active');
}

// Update Player Info
function updatePlayerInfo() {
    const playerNameEl = document.getElementById('playerName');
    const playerStudentIdEl = document.getElementById('playerStudentId');
    
    playerNameEl.textContent = `${gameState.player.firstName} ${gameState.player.lastName}`;
    playerStudentIdEl.textContent = gameState.player.studentId;
}

// Show Question
function showQuestion() {
    const question = gameState.currentQuestion;
    
    if (!question) {
        console.error('No question data');
        return;
    }
    
    // Stop any existing timer
    if (gameState.timer) {
        clearInterval(gameState.timer);
    }
    
    // Update question counter
    document.querySelector('.current-question').textContent = gameState.currentQuestionNumber;
    document.querySelector('.total-questions').textContent = gameState.totalQuestions;
    
    // Update progress bar
    const progress = ((gameState.currentQuestionNumber - 1) / gameState.totalQuestions) * 100;
    document.getElementById('progressFill').style.width = `${progress}%`;
    
    // Show question text
    const questionTextEl = document.getElementById('questionText');
    questionTextEl.textContent = question.text;
    
    // Trigger animation by removing and re-adding the question card
    const questionCard = document.getElementById('questionCard');
    questionCard.style.animation = 'none';
    setTimeout(() => {
        questionCard.style.animation = 'slide-in 0.3s ease-out'; // Reduced from 0.5s to 0.3s
    }, 10);
    
    // Show options
    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';
    
    question.options.forEach((option, index) => {
        const optionEl = document.createElement('div');
        optionEl.className = 'option';
        optionEl.textContent = option;
        optionEl.dataset.index = index;
        optionEl.addEventListener('click', () => handleAnswer(index));
        optionsContainer.appendChild(optionEl);
    });
    
    // Hide timer - admin controls timing now
    const timerContainer = document.getElementById('timer');
    const timerEl = document.getElementById('timeLeft');
    timerContainer.style.display = 'none';
}

// Show Question with Specific Time Remaining (for reconnection)
function showQuestionWithTimeRemaining(timeRemaining) {
    // No timer anymore, just show the question normally
    showQuestion();
}

// Timer functions removed - admin now controls progression manually

// Handle Answer
function handleAnswer(selectedIndex) {
    const question = gameState.currentQuestion;
    const options = document.querySelectorAll('.option');
    
    // Check if already answered (results shown)
    if (options[0].classList.contains('disabled')) {
        return;
    }
    
    // Reset selection UI
    options.forEach(opt => opt.classList.remove('selected'));
    
    // Mark selected option (can change until admin moves to next question)
    options[selectedIndex].classList.add('selected');
    
    console.log(`🎯 Selected option ${selectedIndex}, you can still change...`);
    
    // Send current selection to server (overwrites previous selection)
    socket.emit('player-answer', {
        questionId: question.id,
        answerIndex: selectedIndex
    });
}

// Show Eliminated Page
function showEliminatedPage() {
    showPage('eliminated');
    document.getElementById('correctAnswers').textContent = gameState.correctAnswers;
    
    // Add electric shock effect
    const resultIcon = document.querySelector('.result-icon.eliminated');
    if (resultIcon) {
        resultIcon.style.animation = 'none';
        setTimeout(() => {
            resultIcon.style.animation = 'pulse-circle 1.5s ease-in-out infinite';
        }, 10);
    }
}

// Show Winner Page
function showWinnerPage() {
    showPage('winner');
    document.getElementById('finalScore').textContent = '100%';
    
    // Add celebration effect
    const resultIcon = document.querySelector('.result-icon.winner');
    if (resultIcon) {
        resultIcon.style.animation = 'none';
        setTimeout(() => {
            resultIcon.style.animation = 'winner-spin 2s ease-in-out infinite';
        }, 10);
    }
}

// Reset Game
function resetGame() {
    if (gameState.timer) {
        clearInterval(gameState.timer);
    }
    
    stopStatusPolling();
    
    gameState = {
        sessionId: null,
        player: {
            firstName: '',
            lastName: '',
            studentId: ''
        },
        currentQuestion: null,
        currentQuestionNumber: 0,
        totalQuestions: 10,
        correctAnswers: 0,
        timer: null,
        timeLeft: 15,
        isConnected: socket.connected,
        playerStatus: 'not-registered',
        statusCheckInterval: null
    };
    
    showPage('registration');
    
    // Clear form
    document.getElementById('registration-form').reset();
}

// CRITICAL: Status polling to catch game start if socket event is missed
function startStatusPolling() {
    // Clear any existing interval
    stopStatusPolling();
    
    console.log('🔄 Started status polling...');
    
    // Check status every 2 seconds
    gameState.statusCheckInterval = setInterval(() => {
        // Only poll when in waiting status
        if (gameState.playerStatus === 'waiting' && gameState.sessionId) {
            socket.emit('check-game-status', {
                sessionId: gameState.sessionId
            });
        } else if (gameState.playerStatus !== 'waiting') {
            // Stop polling if we're not waiting anymore
            stopStatusPolling();
        }
    }, 2000); // Check every 2 seconds
}

function stopStatusPolling() {
    if (gameState.statusCheckInterval) {
        clearInterval(gameState.statusCheckInterval);
        gameState.statusCheckInterval = null;
        console.log('⏸️ Stopped status polling');
    }
}

