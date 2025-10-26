// Connect to Socket.IO server
const socket = io();

// Game State
let gameState = {
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
    isConnected: false
};

// DOM Elements
const pages = {
    registration: document.getElementById('registration-page'),
    waiting: document.getElementById('waiting-page'),
    quiz: document.getElementById('quiz-page'),
    eliminated: document.getElementById('eliminated-page'),
    winner: document.getElementById('winner-page')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupSocketListeners();
});

// Socket Connection Events
socket.on('connect', () => {
    console.log('Connected to server');
    gameState.isConnected = true;
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    gameState.isConnected = false;
});

socket.on('registration-success', (data) => {
    console.log('Registration successful:', data);
    // Stay in waiting page until game starts
});

socket.on('game-started', (data) => {
    console.log('Game started:', data);
    gameState.totalQuestions = data.totalQuestions;
    // Wait for first question
});

socket.on('new-question', (data) => {
    console.log('New question received:', data);
    gameState.currentQuestion = data.question;
    gameState.currentQuestionNumber = data.questionNumber;
    gameState.totalQuestions = data.totalQuestions;
    
    // Show quiz page if not already shown
    if (!pages.quiz.classList.contains('active')) {
        showPage('quiz');
        updatePlayerInfo();
    }
    
    showQuestion();
});

socket.on('answer-result', (data) => {
    console.log('Answer result:', data);
    
    if (data.eliminated) {
        // Will receive player-eliminated event
        return;
    }
});

socket.on('player-eliminated', (data) => {
    console.log('Player eliminated:', data);
    gameState.correctAnswers = data.correctAnswers;
    
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
    console.log('Game reset');
    resetGame();
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
    
    // Send registration to server
    socket.emit('player-register', {
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
        questionCard.style.animation = 'slide-in 0.5s ease-out';
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
    
    // Start timer
    startTimer(question.timeLimit || 15);
}

// Start Timer
function startTimer(timeLimit) {
    gameState.timeLeft = timeLimit;
    const timerEl = document.getElementById('timeLeft');
    const timerContainer = document.getElementById('timer');
    
    timerEl.textContent = gameState.timeLeft;
    timerContainer.classList.remove('warning');
    
    if (gameState.timer) {
        clearInterval(gameState.timer);
    }
    
    gameState.timer = setInterval(() => {
        gameState.timeLeft--;
        timerEl.textContent = gameState.timeLeft;
        
        if (gameState.timeLeft <= 5) {
            timerContainer.classList.add('warning');
        }
        
        if (gameState.timeLeft <= 0) {
            clearInterval(gameState.timer);
            handleTimeout();
        }
    }, 1000);
}

// Handle Timeout
function handleTimeout() {
    const question = gameState.currentQuestion;
    
    if (!question) {
        return;
    }
    
    // Disable all options
    const options = document.querySelectorAll('.option');
    options.forEach(opt => opt.classList.add('disabled'));
    
    // Notify server about timeout
    socket.emit('player-timeout', {
        questionId: question.id
    });
}

// Handle Answer
function handleAnswer(selectedIndex) {
    // Stop timer
    if (gameState.timer) {
        clearInterval(gameState.timer);
    }
    
    const question = gameState.currentQuestion;
    const options = document.querySelectorAll('.option');
    
    // Disable all options
    options.forEach(opt => opt.classList.add('disabled'));
    
    // Mark selected option
    options[selectedIndex].classList.add('selected');
    
    // Send answer to server
    socket.emit('player-answer', {
        questionId: question.id,
        answerIndex: selectedIndex,
        timeRemaining: gameState.timeLeft
    });
    
    // Show visual feedback while waiting for server response
    // Server will send back the correct answer
    setTimeout(() => {
        // Simulate feedback (server will handle actual logic)
        // This is just for immediate visual feedback
    }, 100);
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
    
    gameState = {
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
        isConnected: socket.connected
    };
    
    showPage('registration');
    
    // Clear form
    document.getElementById('registration-form').reset();
}

